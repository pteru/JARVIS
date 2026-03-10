"""
Draw-in prediction algorithms - Version 3.

Key improvements over V2:
1. Alpha smoothing (Savitzky-Golay) to reduce corner noise propagation
2. Precise Bayesian D estimation with corner ratio prior
3. Parametric warp recovery for best alpha accuracy
"""

import numpy as np
from scipy.signal import savgol_filter
from scipy.optimize import minimize
from typing import Dict
from data_model import N_PTS, s_curve, SAME_SIDE_CORNERS

N_ALPHA = 200


def _smooth_alpha(alpha, window=31, polyorder=3):
    """Smooth noisy alpha using Savitzky-Golay filter + monotonicity enforcement."""
    if len(alpha) < window:
        window = max(5, len(alpha) // 2 * 2 + 1)
    smoothed = savgol_filter(alpha, window_length=window, polyorder=polyorder)
    # Enforce monotonicity
    smoothed = np.maximum.accumulate(smoothed)
    # Clamp to [0, 1]
    smoothed = np.clip(smoothed, 0, 1)
    # Normalize endpoints
    if smoothed[-1] > smoothed[0]:
        smoothed = (smoothed - smoothed[0]) / (smoothed[-1] - smoothed[0])
    return smoothed


def _resample_to_grid(alpha, values, alpha_grid):
    """Resample values from irregular alpha to regular grid."""
    alpha_mono = np.maximum.accumulate(alpha)
    eps = np.arange(len(alpha_mono)) * 1e-12
    alpha_mono = alpha_mono + eps
    return np.interp(alpha_grid, alpha_mono, values)


def _fit_warp_parametric(alpha_noisy, n_cp=5):
    """Fit parametric warp model to noisy alpha for maximum smoothing.

    Model: alpha = s_norm(warp(t), k_eff)
    where warp(t) = cumulative_normalized(interp(t, cp_positions, cp_values))
    """
    t = np.linspace(0, 1, len(alpha_noisy))
    cp_positions = np.linspace(0, 1, n_cp)

    def s_norm(x, k):
        sig = lambda v: 1.0 / (1.0 + np.exp(-v))
        s0 = sig(-k * 0.5)
        s1 = sig(k * 0.5)
        return (sig(k * (x - 0.5)) - s0) / (s1 - s0)

    def alpha_model(params):
        cp_vals = params[:n_cp]
        k = params[n_cp]
        spd = np.interp(t, cp_positions, cp_vals)
        spd = np.maximum(spd, 0.01)
        cum = np.cumsum(spd)
        warp = cum / cum[-1]
        return s_norm(warp, k)

    def objective(params):
        model = alpha_model(params)
        data_fit = np.sum((model - alpha_noisy) ** 2)
        # Regularize cp toward 1 (uniform speed)
        reg_cp = 0.1 * np.sum((params[:n_cp] - 1.0) ** 2)
        return data_fit + reg_cp

    # Initial guess
    x0 = np.ones(n_cp + 1)
    x0[n_cp] = 12.0  # typical steepness

    bounds = [(0.01, 10.0)] * n_cp + [(2.0, 50.0)]
    result = minimize(objective, x0, bounds=bounds, method='L-BFGS-B',
                      options={'maxiter': 200})
    return alpha_model(result.x)


# =============================================================================
# Algorithm: Smooth Alpha + Bayesian D (savgol)
# =============================================================================

def smooth_alpha_bayesian_factory(train_data: Dict, params) -> callable:
    """Best V3 algorithm: smooth alpha + precise Bayesian D estimation."""

    alpha_grid = np.linspace(0, 1, N_ALPHA)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        resampled_shapes = []
        D_ratios = []

        for s in strokes:
            alpha = np.array(s['alpha'])
            alpha_s = _smooth_alpha(alpha)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample_to_grid(alpha_s, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

        shapes_arr = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)

        # Median shape (robust to outliers)
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

        # Smooth test alpha
        alpha_smooth = _smooth_alpha(alpha_full)

        # Shape at smooth alpha
        shape_full = np.interp(alpha_smooth, model['alpha_grid'], model['avg_shape'])

        # D estimation - prior from corner ratio
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # D from observed data (weighted LS)
        shape_obs = shape_full[:cutoff_idx]
        ss = np.sum(shape_obs ** 2)

        if ss > 1e-10 and cutoff_idx > 5:
            D_mle = np.sum(values_observed * shape_obs) / ss
            residual = values_observed - D_mle * shape_obs
            noise_var = np.mean(residual ** 2)
            D_mle_var = noise_var / max(ss, 1e-10)
        else:
            D_mle = D_prior
            D_mle_var = D_prior_std ** 2 * 100

        # Bayesian posterior
        prior_prec = 1.0 / max(D_prior_std ** 2, 1e-10)
        like_prec = 1.0 / max(D_mle_var, 1e-10)
        D_post = (prior_prec * D_prior + like_prec * D_mle) / (prior_prec + like_prec)

        predicted = D_post * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


# =============================================================================
# Algorithm: Parametric Warp + Bayesian D
# =============================================================================

def parametric_warp_bayesian_factory(train_data: Dict, params) -> callable:
    """Use parametric warp fitting for maximum alpha accuracy."""

    alpha_grid = np.linspace(0, 1, N_ALPHA)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        resampled_shapes = []
        D_ratios = []

        for s in strokes:
            alpha = np.array(s['alpha'])
            alpha_s = _fit_warp_parametric(alpha)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample_to_grid(alpha_s, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

        shapes_arr = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)

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

        # Parametric warp fit for maximum alpha accuracy
        alpha_smooth = _fit_warp_parametric(alpha_full)

        shape_full = np.interp(alpha_smooth, model['alpha_grid'], model['avg_shape'])

        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        shape_obs = shape_full[:cutoff_idx]
        ss = np.sum(shape_obs ** 2)

        if ss > 1e-10 and cutoff_idx > 5:
            D_mle = np.sum(values_observed * shape_obs) / ss
            residual = values_observed - D_mle * shape_obs
            noise_var = np.mean(residual ** 2)
            D_mle_var = noise_var / max(ss, 1e-10)
        else:
            D_mle = D_prior
            D_mle_var = D_prior_std ** 2 * 100

        prior_prec = 1.0 / max(D_prior_std ** 2, 1e-10)
        like_prec = 1.0 / max(D_mle_var, 1e-10)
        D_post = (prior_prec * D_prior + like_prec * D_mle) / (prior_prec + like_prec)

        predicted = D_post * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


# =============================================================================
# Algorithm: Smooth Alpha + Joint D,gamma fit + Corner-weighted shape
# =============================================================================

def smooth_joint_factory(train_data: Dict, params) -> callable:
    """
    Smooth alpha + corner-weighted shape + joint D,gamma estimation.
    Gamma correction handles steepness mismatch between middle and corners.
    """

    alpha_grid = np.linspace(0, 1, N_ALPHA)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        resampled_shapes = []
        D_ratios = []
        corner_profiles = []

        for s in strokes:
            alpha = np.array(s['alpha'])
            alpha_s = _smooth_alpha(alpha)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample_to_grid(alpha_s, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

            # Corner profile for matching
            cp = []
            for c in corners:
                cn = s['corner_curves'][c] / s['corner_dis'][c]
                cp.append(_resample_to_grid(alpha_s, cn, alpha_grid))
            corner_profiles.append(np.concatenate(cp))

        shapes_arr = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)
        corner_profiles = np.array(corner_profiles)

        avg_shape = np.median(shapes_arr, axis=0)
        avg_shape[0] = 0.0
        avg_shape[-1] = 1.0
        avg_shape = np.maximum.accumulate(avg_shape)
        if avg_shape[-1] > 0:
            avg_shape /= avg_shape[-1]

        sensor_models[ms_name] = {
            'shapes': shapes_arr,
            'avg_shape': avg_shape,
            'alpha_grid': alpha_grid,
            'D_ratios': D_ratios,
            'D_ratio_mean': float(np.mean(D_ratios)),
            'D_ratio_std': float(max(np.std(D_ratios), 0.005)),
            'corner_profiles': corner_profiles,
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
        alpha_smooth = _smooth_alpha(alpha_full)

        # Corner-weighted shape selection
        test_cp = []
        for c in corners:
            cn = corner_curves[c] / corner_dis[c]
            test_cp.append(_resample_to_grid(alpha_smooth, cn, model['alpha_grid']))
        test_cp = np.concatenate(test_cp)

        diffs = model['corner_profiles'] - test_cp[np.newaxis, :]
        distances = np.sqrt(np.mean(diffs ** 2, axis=1))
        temp = max(np.median(distances) * 0.3, 1e-8)
        weights = np.exp(-distances / temp)
        weights /= weights.sum()

        pred_shape = np.average(model['shapes'], weights=weights, axis=0)
        D_ratio_w = np.average(model['D_ratios'], weights=weights)

        # D prior
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = D_ratio_w * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # Joint D, gamma fit on observed data
        alpha_obs_smooth = alpha_smooth[:cutoff_idx]

        def objective(x):
            D, gamma = x
            alpha_w = np.clip(alpha_obs_smooth, 0, 1) ** gamma
            shape_obs = np.interp(alpha_w, model['alpha_grid'], pred_shape)
            pred_obs = D * shape_obs

            data_fit = np.sum((pred_obs - values_observed) ** 2)
            reg_D = ((D - D_prior) / max(D_prior_std, 0.1)) ** 2
            reg_gamma = 200.0 * (gamma - 1.0) ** 2  # strong gamma regularization
            frac_seen = cutoff_idx / N_PTS
            pw = max(0.5, (1.0 - frac_seen) * 3.0)
            return data_fit + pw * reg_D + reg_gamma

        result = minimize(objective, [D_prior, 1.0],
                         bounds=[(D_prior * 0.5, D_prior * 2.0), (0.85, 1.15)],
                         method='L-BFGS-B')
        D_fit, gamma_fit = result.x

        alpha_w_full = np.clip(alpha_smooth, 0, 1) ** gamma_fit
        shape_full = np.interp(alpha_w_full, model['alpha_grid'], pred_shape)
        predicted = D_fit * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


ALGORITHMS_V3 = {
    'smooth_bayesian': smooth_alpha_bayesian_factory,
    'parametric_warp': parametric_warp_bayesian_factory,
    'smooth_joint': smooth_joint_factory,
}
