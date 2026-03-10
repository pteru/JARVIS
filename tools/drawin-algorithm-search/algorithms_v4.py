"""
Draw-in prediction algorithms - Version 4.

Key insight: Instead of learning a shape template, use the exact sigmoid model
with parameters (D, k) fitted from observed data + strong priors from corners.
The warp is recovered from corners via parametric fitting.
"""

import numpy as np
from scipy.signal import savgol_filter
from scipy.optimize import minimize
from typing import Dict
from data_model import N_PTS, s_curve, SAME_SIDE_CORNERS


def _s_norm(x, k):
    """Normalized sigmoid [0,1] -> [0,1]."""
    sig = lambda v: 1.0 / (1.0 + np.exp(-np.clip(v, -500, 500)))
    s0 = sig(-k * 0.5)
    s1 = sig(k * 0.5)
    denom = s1 - s0
    if denom < 1e-15:
        return x  # fallback to identity
    return (sig(k * (x - 0.5)) - s0) / denom


def _smooth_alpha(alpha, window=31, polyorder=3):
    """Smooth noisy alpha using Savitzky-Golay + monotonicity."""
    if len(alpha) < window:
        window = max(5, len(alpha) // 2 * 2 + 1)
    smoothed = savgol_filter(alpha, window_length=window, polyorder=polyorder)
    smoothed = np.maximum.accumulate(smoothed)
    smoothed = np.clip(smoothed, 0, 1)
    if smoothed[-1] > smoothed[0] + 1e-10:
        smoothed = (smoothed - smoothed[0]) / (smoothed[-1] - smoothed[0])
    return smoothed


def _fit_warp(alpha_noisy, n_cp=5):
    """Fit parametric warp + k to noisy alpha."""
    n = len(alpha_noisy)
    t = np.linspace(0, 1, n)
    cp_pos = np.linspace(0, 1, n_cp)

    def model(params):
        cp_vals = params[:n_cp]
        k = params[n_cp]
        spd = np.interp(t, cp_pos, cp_vals)
        spd = np.maximum(spd, 0.01)
        cum = np.cumsum(spd)
        warp = cum / cum[-1]
        return _s_norm(warp, k), warp

    def objective(params):
        alpha_model, _ = model(params)
        data_fit = np.sum((alpha_model - alpha_noisy) ** 2)
        reg = 0.1 * np.sum((params[:n_cp] - 1.0) ** 2)
        return data_fit + reg

    x0 = np.ones(n_cp + 1)
    x0[n_cp] = 12.0
    bounds = [(0.01, 10.0)] * n_cp + [(2.0, 50.0)]
    result = minimize(objective, x0, bounds=bounds, method='L-BFGS-B',
                      options={'maxiter': 200})
    _, warp = model(result.x)
    k_fitted = result.x[n_cp]
    return warp, k_fitted


def _resample(alpha, values, grid):
    """Resample to regular grid with monotonicity enforcement."""
    a = np.maximum.accumulate(alpha) + np.arange(len(alpha)) * 1e-12
    return np.interp(grid, a, values)


# =============================================================================
# Algorithm: Parametric Sigmoid with Warp Recovery (THE approach)
# =============================================================================

def parametric_sigmoid_factory(train_data: Dict, params) -> callable:
    """
    Use the exact physics model: middle(t) = D * s_norm(warp(t), k_m)

    1. Recover warp from corners (parametric fit)
    2. Estimate D from corner ratio (strong prior) + observed data (likelihood)
    3. Estimate k_m from corner k + training relationship
    4. Predict using sigmoid model with recovered warp
    """

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        D_ratios = []
        k_ratios = []  # k_middle / k_corner_avg

        for s in strokes:
            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(s['total_di'] / avg_corner_di)

            # Estimate corner k from alpha shape
            alpha = np.array(s['alpha'])
            _, k_corner = _fit_warp(alpha)

            k_ratios.append(s['steep'] / k_corner if k_corner > 0.1 else 1.0)

        D_ratios = np.array(D_ratios)
        k_ratios = np.array(k_ratios)

        sensor_models[ms_name] = {
            'D_ratio_mean': float(np.mean(D_ratios)),
            'D_ratio_std': float(max(np.std(D_ratios), 0.005)),
            'k_ratio_mean': float(np.mean(k_ratios)),
            'k_ratio_std': float(max(np.std(k_ratios), 0.01)),
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            if len(values_observed) > 0:
                pred[cutoff_idx:] = values_observed[-1]
            return pred

        corners = SAME_SIDE_CORNERS[ms_name]

        # Step 1: Recover warp from corners
        warp, k_corner = _fit_warp(alpha_full)

        # Step 2: Estimate k_middle from corner k
        k_prior = model['k_ratio_mean'] * k_corner
        k_prior_std = model['k_ratio_std'] * k_corner

        # Step 3: Estimate D from corner ratio
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # Step 4: Fit D and k to observed data with priors
        warp_obs = warp[:cutoff_idx]

        def objective(x):
            D, k = x
            pred = D * _s_norm(warp_obs, k)
            data_fit = np.sum((pred - values_observed) ** 2)

            reg_D = ((D - D_prior) / max(D_prior_std, 0.1)) ** 2
            reg_k = ((k - k_prior) / max(k_prior_std, 0.1)) ** 2

            # Weight prior more when less data visible
            frac_seen = cutoff_idx / N_PTS
            pw = max(0.5, (1.0 - frac_seen) * 2.0)
            return data_fit + pw * (reg_D + reg_k)

        result = minimize(objective, [D_prior, k_prior],
                         bounds=[(D_prior * 0.5, D_prior * 2.0),
                                 (max(1, k_prior * 0.5), k_prior * 2.0)],
                         method='L-BFGS-B')
        D_fit, k_fit = result.x

        # Step 5: Predict full curve
        predicted = D_fit * _s_norm(warp, k_fit)

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


# =============================================================================
# Algorithm: Hybrid — shape template + parametric, select best
# =============================================================================

def hybrid_v4_factory(train_data: Dict, params) -> callable:
    """
    Run both shape-template (smooth alpha + Bayesian D) and parametric sigmoid.
    Select the one with better visible fit.
    """

    alpha_grid = np.linspace(0, 1, 200)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        resampled_shapes = []
        D_ratios = []
        k_ratios = []

        for s in strokes:
            alpha = np.array(s['alpha'])
            alpha_s = _smooth_alpha(alpha)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample(alpha_s, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

            _, k_corner = _fit_warp(alpha)
            k_ratios.append(s['steep'] / k_corner if k_corner > 0.1 else 1.0)

        shapes_arr = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)
        k_ratios = np.array(k_ratios)

        avg_shape = np.median(shapes_arr, axis=0)
        avg_shape[0] = 0.0
        avg_shape[-1] = 1.0
        avg_shape = np.maximum.accumulate(avg_shape)
        if avg_shape[-1] > 0:
            avg_shape /= avg_shape[-1]

        sensor_models[ms_name] = {
            'avg_shape': avg_shape,
            'alpha_grid': alpha_grid,
            'D_ratio_mean': float(np.mean(D_ratios)),
            'D_ratio_std': float(max(np.std(D_ratios), 0.005)),
            'k_ratio_mean': float(np.mean(k_ratios)),
            'k_ratio_std': float(max(np.std(k_ratios), 0.01)),
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            if len(values_observed) > 0:
                pred[cutoff_idx:] = values_observed[-1]
            return pred

        corners = SAME_SIDE_CORNERS[ms_name]
        avg_corner_di = np.mean([corner_dis[c] for c in corners])

        # D and k priors
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # --- Method A: Shape template with smooth alpha ---
        alpha_smooth = _smooth_alpha(alpha_full)
        shape_full_A = np.interp(alpha_smooth, model['alpha_grid'], model['avg_shape'])
        shape_obs_A = shape_full_A[:cutoff_idx]
        ss_A = np.sum(shape_obs_A ** 2)
        if ss_A > 1e-10:
            D_mle_A = np.sum(values_observed * shape_obs_A) / ss_A
            res_A = values_observed - D_mle_A * shape_obs_A
            noise_var_A = np.mean(res_A ** 2)
            D_var_A = noise_var_A / max(ss_A, 1e-10)
        else:
            D_mle_A = D_prior
            D_var_A = D_prior_std ** 2 * 100
        prec_prior = 1.0 / max(D_prior_std ** 2, 1e-10)
        prec_A = 1.0 / max(D_var_A, 1e-10)
        D_A = (prec_prior * D_prior + prec_A * D_mle_A) / (prec_prior + prec_A)
        pred_A = D_A * shape_full_A
        err_A = np.mean((pred_A[:cutoff_idx] - values_observed) ** 2)

        # --- Method B: Parametric sigmoid with warp recovery ---
        warp, k_corner = _fit_warp(alpha_full)
        k_prior = model['k_ratio_mean'] * k_corner
        k_prior_std = model['k_ratio_std'] * k_corner
        warp_obs = warp[:cutoff_idx]

        def obj_B(x):
            D, k = x
            pred = D * _s_norm(warp_obs, k)
            data_fit = np.sum((pred - values_observed) ** 2)
            reg_D = ((D - D_prior) / max(D_prior_std, 0.1)) ** 2
            reg_k = ((k - k_prior) / max(k_prior_std, 0.1)) ** 2
            frac = cutoff_idx / N_PTS
            pw = max(0.5, (1.0 - frac) * 2.0)
            return data_fit + pw * (reg_D + reg_k)

        res_B = minimize(obj_B, [D_prior, k_prior],
                        bounds=[(D_prior * 0.5, D_prior * 2.0),
                                (max(1, k_prior * 0.5), k_prior * 2.0)],
                        method='L-BFGS-B')
        D_B, k_B = res_B.x
        pred_B_full = D_B * _s_norm(warp, k_B)
        err_B = np.mean((pred_B_full[:cutoff_idx] - values_observed) ** 2)

        # --- Select best or combine ---
        w_A = 1.0 / (err_A + 1e-8)
        w_B = 1.0 / (err_B + 1e-8)
        total = w_A + w_B

        predicted = (w_A * pred_A + w_B * pred_B_full) / total

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


ALGORITHMS_V4 = {
    'parametric_sigmoid': parametric_sigmoid_factory,
    'hybrid_v4': hybrid_v4_factory,
}
