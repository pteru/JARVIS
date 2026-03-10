"""
Draw-in prediction - Version 6.

Key breakthrough: fit warp from CORNER CURVES (not alpha), which gives
much better warp estimates. Then use exact sigmoid model for prediction.
Falls back to shape template when warp fit is unreliable.
"""

import numpy as np
from scipy.signal import savgol_filter
from scipy.optimize import minimize
from typing import Dict
from data_model import N_PTS, SAME_SIDE_CORNERS


def _s_norm(x, k):
    """Normalized sigmoid."""
    sig = lambda v: 1.0 / (1.0 + np.exp(-np.clip(v, -500, 500)))
    s0 = sig(-k * 0.5)
    s1 = sig(k * 0.5)
    d = s1 - s0
    if d < 1e-15:
        return np.clip(x, 0, 1)
    return (sig(k * (x - 0.5)) - s0) / d


def _smooth_alpha(alpha, window=31):
    n = len(alpha)
    w = min(window, n // 2 * 2 - 1)
    if w < 5:
        w = 5
    if w % 2 == 0:
        w += 1
    s = savgol_filter(alpha, w, 3)
    s = np.maximum.accumulate(s)
    s = np.clip(s, 0, 1)
    if s[-1] > s[0] + 1e-10:
        s = (s - s[0]) / (s[-1] - s[0])
    return s


def _resample(alpha, values, grid):
    a = np.maximum.accumulate(alpha) + np.arange(len(alpha)) * 1e-12
    return np.interp(grid, a, values)


def _fit_warp_from_corners(corner_curves, corner_dis, n_cp=3, reg_weight=2.0):
    """Fit shared warp + per-corner k from corner curves.

    Uses fewer control points (3) and strong regularization for noise robustness.
    """
    t = np.linspace(0, 1, N_PTS)
    cp_pos = np.linspace(0, 1, n_cp)

    corners = list(corner_curves.keys())
    norms = [(corner_curves[c] / corner_dis[c]) for c in corners]

    def model(params):
        cp_vals = params[:n_cp]
        ks = params[n_cp:]
        spd = np.interp(t, cp_pos, cp_vals)
        spd = np.maximum(spd, 0.01)
        cum = np.cumsum(spd)
        warp = cum / cum[-1]
        preds = [_s_norm(warp, k) for k in ks]
        return warp, preds, np.mean(ks)

    def objective(params):
        _, preds, _ = model(params)
        err = sum(np.sum((p - n) ** 2) for p, n in zip(preds, norms))
        reg = reg_weight * np.sum((params[:n_cp] - 1.0) ** 2)
        return err + reg

    n_corners = len(corners)
    x0 = np.ones(n_cp + n_corners)
    x0[n_cp:] = 12.0
    bounds = [(0.1, 5.0)] * n_cp + [(2.0, 50.0)] * n_corners

    result = minimize(objective, x0, bounds=bounds, method='L-BFGS-B',
                      options={'maxiter': 300})
    warp, preds, k_corner_avg = model(result.x)

    # Compute fit quality
    fit_err = sum(np.mean((p - n) ** 2) for p, n in zip(preds, norms)) / n_corners
    return warp, k_corner_avg, fit_err


def warp_sigmoid_factory(train_data: Dict, params) -> callable:
    """
    Exact physics model: middle(t) = D * s_norm(warp(t), k_m)
    Warp recovered from corners. k_m estimated from training relationship.
    D estimated via Bayesian combination of corner ratio + observed data.
    """

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        D_ratios = []
        k_m_values = []
        k_c_values = []

        for s in strokes:
            avg_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(s['total_di'] / avg_di)

            # Fit warp from training corners to get k_c
            _, k_c, _ = _fit_warp_from_corners(
                s['corner_curves'], s['corner_dis'], n_cp=3, reg_weight=2.0)
            k_c_values.append(k_c)
            k_m_values.append(s['steep'])

        D_ratios = np.array(D_ratios)
        k_m_values = np.array(k_m_values)
        k_c_values = np.array(k_c_values)

        # k_m = slope * k_c + intercept
        if len(k_c_values) > 2 and np.std(k_c_values) > 0.01:
            A = np.vstack([k_c_values, np.ones(len(k_c_values))]).T
            k_coef, _, _, _ = np.linalg.lstsq(A, k_m_values, rcond=None)
        else:
            k_coef = [1.0, 0.0]

        sensor_models[ms_name] = {
            'D_ratio_mean': float(np.mean(D_ratios)),
            'D_ratio_std': float(max(np.std(D_ratios), 0.005)),
            'k_coef': k_coef,
            'k_m_mean': float(np.mean(k_m_values)),
            'k_m_std': float(max(np.std(k_m_values), 0.1)),
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

        # Recover warp and k_c from test corners
        warp, k_c, fit_err = _fit_warp_from_corners(
            corner_curves, corner_dis, n_cp=3, reg_weight=2.0)

        # Estimate k_m from k_c
        k_m_prior = model['k_coef'][0] * k_c + model['k_coef'][1]
        k_m_prior = max(k_m_prior, 2.0)
        k_m_std = model['k_m_std']

        # D prior
        avg_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_di
        D_prior_std = model['D_ratio_std'] * avg_di

        # Fit D and k_m jointly to observed data
        warp_obs = warp[:cutoff_idx]

        def objective(x):
            D, k_m = x
            pred = D * _s_norm(warp_obs, k_m)
            data_fit = np.sum((pred - values_observed) ** 2)
            reg_D = ((D - D_prior) / max(D_prior_std, 0.1)) ** 2
            reg_k = ((k_m - k_m_prior) / max(k_m_std, 0.1)) ** 2
            frac = cutoff_idx / N_PTS
            pw = max(0.3, (1.0 - frac) * 2.0)
            return data_fit + pw * (reg_D + 2.0 * reg_k)

        res = minimize(objective, [D_prior, k_m_prior],
                      bounds=[(D_prior * 0.5, D_prior * 2.0),
                              (max(2, k_m_prior * 0.5), k_m_prior * 2.0)],
                      method='L-BFGS-B')
        D_fit, k_m_fit = res.x

        predicted = D_fit * _s_norm(warp, k_m_fit)

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


def hybrid_warp_template_factory(train_data: Dict, params) -> callable:
    """
    Hybrid: run both warp-sigmoid and template approaches.
    Weight by visible-portion fit quality.
    This handles both low-noise (warp excels) and high-noise (template excels).
    """

    alpha_grid = np.linspace(0, 1, N_PTS)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        resampled_shapes = []
        D_ratios = []
        k_m_values = []
        k_c_values = []

        for s in strokes:
            alpha = np.array(s['alpha'])
            alpha_s = _smooth_alpha(alpha, window=31)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample(alpha_s, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_di)

            _, k_c, _ = _fit_warp_from_corners(
                s['corner_curves'], s['corner_dis'], n_cp=3, reg_weight=2.0)
            k_c_values.append(k_c)
            k_m_values.append(s['steep'])

        shapes_arr = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)
        k_m_values = np.array(k_m_values)
        k_c_values = np.array(k_c_values)

        avg_shape = np.median(shapes_arr, axis=0)
        avg_shape[0] = 0.0
        avg_shape[-1] = 1.0
        avg_shape = np.maximum.accumulate(avg_shape)
        if avg_shape[-1] > 0:
            avg_shape /= avg_shape[-1]

        if len(k_c_values) > 2 and np.std(k_c_values) > 0.01:
            A = np.vstack([k_c_values, np.ones(len(k_c_values))]).T
            k_coef, _, _, _ = np.linalg.lstsq(A, k_m_values, rcond=None)
        else:
            k_coef = [1.0, 0.0]

        sensor_models[ms_name] = {
            'avg_shape': avg_shape,
            'alpha_grid': alpha_grid,
            'D_ratio_mean': float(np.mean(D_ratios)),
            'D_ratio_std': float(max(np.std(D_ratios), 0.005)),
            'k_coef': k_coef,
            'k_m_mean': float(np.mean(k_m_values)),
            'k_m_std': float(max(np.std(k_m_values), 0.1)),
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
        avg_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_di
        D_prior_std = model['D_ratio_std'] * avg_di

        # --- Method A: Template shape + Bayesian D ---
        alpha_smooth = _smooth_alpha(alpha_full, window=31)
        shape_A = np.interp(alpha_smooth, model['alpha_grid'], model['avg_shape'])
        shape_obs_A = shape_A[:cutoff_idx]
        ss_A = np.sum(shape_obs_A ** 2)
        if ss_A > 1e-10 and cutoff_idx > 5:
            D_mle_A = np.sum(values_observed * shape_obs_A) / ss_A
            res_A = values_observed - D_mle_A * shape_obs_A
            nv_A = np.mean(res_A ** 2)
            D_var_A = nv_A / max(ss_A, 1e-10)
        else:
            D_mle_A = D_prior
            D_var_A = D_prior_std ** 2 * 100
        pp = 1.0 / max(D_prior_std ** 2, 1e-10)
        lp_A = 1.0 / max(D_var_A, 1e-10)
        D_A = (pp * D_prior + lp_A * D_mle_A) / (pp + lp_A)
        pred_A = D_A * shape_A
        err_A = np.mean((pred_A[:cutoff_idx] - values_observed) ** 2)

        # --- Method B: Warp + sigmoid ---
        warp, k_c, _ = _fit_warp_from_corners(
            corner_curves, corner_dis, n_cp=3, reg_weight=2.0)
        k_m_prior = model['k_coef'][0] * k_c + model['k_coef'][1]
        k_m_prior = max(k_m_prior, 2.0)
        warp_obs = warp[:cutoff_idx]

        def obj_B(x):
            D, k_m = x
            pred = D * _s_norm(warp_obs, k_m)
            data_fit = np.sum((pred - values_observed) ** 2)
            reg_D = ((D - D_prior) / max(D_prior_std, 0.1)) ** 2
            reg_k = ((k_m - k_m_prior) / max(model['k_m_std'], 0.1)) ** 2
            frac = cutoff_idx / N_PTS
            pw = max(0.3, (1.0 - frac) * 2.0)
            return data_fit + pw * (reg_D + 2.0 * reg_k)

        res_B = minimize(obj_B, [D_prior, k_m_prior],
                        bounds=[(D_prior * 0.5, D_prior * 2.0),
                                (max(2, k_m_prior * 0.5), k_m_prior * 2.0)],
                        method='L-BFGS-B')
        D_B, k_B = res_B.x
        pred_B = D_B * _s_norm(warp, k_B)
        err_B = np.mean((pred_B[:cutoff_idx] - values_observed) ** 2)

        # Weighted combination
        w_A = 1.0 / (err_A + 1e-8)
        w_B = 1.0 / (err_B + 1e-8)
        total = w_A + w_B
        predicted = (w_A * pred_A + w_B * pred_B) / total

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


ALGORITHMS_V6 = {
    'warp_sigmoid': warp_sigmoid_factory,
    'hybrid_warp_template': hybrid_warp_template_factory,
}
