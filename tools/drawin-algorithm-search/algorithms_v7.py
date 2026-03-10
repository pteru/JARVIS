"""
Draw-in prediction - Version 7.

Key insight: Don't use the MEAN training shape. Instead, select/weight
training shapes by how well they fit the OBSERVED portion. This naturally
picks shapes with the right k_m/k_c ratio for the test stroke.

With noise, all shapes score similarly → falls back to mean (robust).
Without noise, best-matching shape wins → eliminates shape error.
"""

import numpy as np
from scipy.signal import savgol_filter
from typing import Dict
from data_model import N_PTS, SAME_SIDE_CORNERS


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


def shape_selection_factory(train_data: Dict, params) -> callable:
    """
    1. Store all training shapes (resampled to alpha grid)
    2. For test: fit D * shape_i to observed data for each training shape
    3. Weight shapes by fit quality (exponential of -RSS)
    4. Use weighted average shape for full prediction
    5. D from Bayesian combination of prior + best-fit D values
    """

    alpha_grid = np.linspace(0, 1, N_PTS)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        all_shapes = []
        D_ratios = []

        for s in strokes:
            alpha = np.array(s['alpha'])
            alpha_s = _smooth_alpha(alpha, window=31)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample(alpha_s, shape, alpha_grid)
            all_shapes.append(resampled)

            avg_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_di)

        all_shapes = np.array(all_shapes)
        D_ratios = np.array(D_ratios)

        # Also compute median shape as fallback
        med_shape = np.median(all_shapes, axis=0)
        med_shape[0] = 0.0
        med_shape[-1] = 1.0
        med_shape = np.maximum.accumulate(med_shape)
        if med_shape[-1] > 0:
            med_shape /= med_shape[-1]

        sensor_models[ms_name] = {
            'all_shapes': all_shapes,
            'med_shape': med_shape,
            'alpha_grid': alpha_grid,
            'D_ratio_mean': float(np.mean(D_ratios)),
            'D_ratio_std': float(max(np.std(D_ratios), 0.005)),
            'D_ratios': D_ratios,
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
        alpha_smooth = _smooth_alpha(alpha_full, window=31)

        avg_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_di
        D_prior_std = model['D_ratio_std'] * avg_di

        # For each training shape, compute D_fit and RSS on observed data
        shapes = model['all_shapes']
        n_shapes = len(shapes)
        D_fits = np.zeros(n_shapes)
        rss_values = np.zeros(n_shapes)

        for i in range(n_shapes):
            shape_at_alpha = np.interp(alpha_smooth, model['alpha_grid'], shapes[i])
            shape_obs = shape_at_alpha[:cutoff_idx]
            ss = np.sum(shape_obs ** 2)

            if ss > 1e-10:
                D_fit = np.sum(values_observed * shape_obs) / ss
                D_fits[i] = D_fit
                rss = np.sum((values_observed - D_fit * shape_obs) ** 2)
                rss_values[i] = rss
            else:
                D_fits[i] = D_prior
                rss_values[i] = 1e10

        # Compute weights from RSS (softmax-like)
        # Lower RSS = better fit = higher weight
        rss_min = np.min(rss_values)
        # Temperature: normalize by cutoff_idx (more data → more discriminative)
        temp = max(rss_min * 0.5, np.median(rss_values) * 0.1) + 1e-10
        log_weights = -(rss_values - rss_min) / temp
        # Clip for numerical stability
        log_weights = np.clip(log_weights, -50, 0)
        weights = np.exp(log_weights)
        weights /= weights.sum()

        # Weighted average shape
        weighted_shape = np.average(shapes, weights=weights, axis=0)
        shape_full = np.interp(alpha_smooth, model['alpha_grid'], weighted_shape)

        # Weighted D from shape-specific fits
        D_mle = np.average(D_fits, weights=weights)

        # Estimate D_mle variance from the weighted residuals
        shape_obs_final = shape_full[:cutoff_idx]
        ss_final = np.sum(shape_obs_final ** 2)
        if ss_final > 1e-10:
            res_final = values_observed - D_mle * shape_obs_final
            noise_var = np.mean(res_final ** 2)
            D_mle_var = noise_var / max(ss_final, 1e-10)
        else:
            D_mle_var = D_prior_std ** 2 * 100

        # Bayesian combination
        pp = 1.0 / max(D_prior_std ** 2, 1e-10)
        lp = 1.0 / max(D_mle_var, 1e-10)
        D_post = (pp * D_prior + lp * D_mle) / (pp + lp)

        predicted = D_post * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


def shape_selection_robust_factory(train_data: Dict, params) -> callable:
    """
    Like shape_selection but with additional robustness:
    - IRLS for D estimation
    - Blend between shape-selected and median shape based on noise level
    """

    alpha_grid = np.linspace(0, 1, N_PTS)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        all_shapes = []
        D_ratios = []

        for s in strokes:
            alpha = np.array(s['alpha'])
            alpha_s = _smooth_alpha(alpha, window=31)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample(alpha_s, shape, alpha_grid)
            all_shapes.append(resampled)

            avg_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_di)

        all_shapes = np.array(all_shapes)
        D_ratios = np.array(D_ratios)

        med_shape = np.median(all_shapes, axis=0)
        med_shape[0] = 0.0
        med_shape[-1] = 1.0
        med_shape = np.maximum.accumulate(med_shape)
        if med_shape[-1] > 0:
            med_shape /= med_shape[-1]

        sensor_models[ms_name] = {
            'all_shapes': all_shapes,
            'med_shape': med_shape,
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
        alpha_smooth = _smooth_alpha(alpha_full, window=31)

        avg_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_di
        D_prior_std = model['D_ratio_std'] * avg_di

        shapes = model['all_shapes']
        n_shapes = len(shapes)

        # Score each training shape
        rss_values = np.zeros(n_shapes)
        D_fits = np.zeros(n_shapes)

        for i in range(n_shapes):
            shape_at = np.interp(alpha_smooth, model['alpha_grid'], shapes[i])
            so = shape_at[:cutoff_idx]
            ss = np.sum(so ** 2)
            if ss > 1e-10:
                D_fits[i] = np.sum(values_observed * so) / ss
                rss_values[i] = np.sum((values_observed - D_fits[i] * so) ** 2)
            else:
                D_fits[i] = D_prior
                rss_values[i] = 1e10

        # Weights
        rss_min = np.min(rss_values)
        temp = max(rss_min * 0.3, 1.0) + 1e-10
        log_w = -(rss_values - rss_min) / temp
        log_w = np.clip(log_w, -50, 0)
        weights = np.exp(log_w)
        weights /= weights.sum()

        # Estimate noise level from best-fit residuals
        best_idx = np.argmin(rss_values)
        best_shape_at = np.interp(alpha_smooth, model['alpha_grid'],
                                  shapes[best_idx])
        best_res = values_observed - D_fits[best_idx] * best_shape_at[:cutoff_idx]
        noise_est = np.sqrt(np.mean(best_res ** 2))

        # Blend between selected shape and median based on noise
        # High noise → more median (robust), low noise → more selected (accurate)
        # Noise relative to signal at cutoff
        signal_at_cutoff = max(np.mean(values_observed[-10:]) if cutoff_idx > 10
                               else np.max(values_observed), 1.0)
        noise_ratio = noise_est / signal_at_cutoff

        # Blend weight: 0 = all selected, 1 = all median
        median_weight = np.clip(noise_ratio * 5.0, 0.0, 0.7)

        selected_shape = np.average(shapes, weights=weights, axis=0)
        blended_shape = (1 - median_weight) * selected_shape + \
                        median_weight * model['med_shape']
        shape_full = np.interp(alpha_smooth, model['alpha_grid'], blended_shape)

        # D estimation with IRLS
        D_mle = np.average(D_fits, weights=weights)
        shape_obs = shape_full[:cutoff_idx]
        ss = np.sum(shape_obs ** 2)

        if ss > 1e-10 and cutoff_idx > 5:
            # One IRLS iteration
            D_est = np.sum(values_observed * shape_obs) / ss
            res = values_observed - D_est * shape_obs
            mad = max(np.median(np.abs(res)), 0.1)
            w = np.where(np.abs(res) < 2 * mad, 1.0,
                         2 * mad / (np.abs(res) + 1e-10))
            wss = np.sum(w * shape_obs ** 2)
            if wss > 1e-10:
                D_mle = np.sum(w * values_observed * shape_obs) / wss
                res2 = values_observed - D_mle * shape_obs
                nv = np.sum(w * res2 ** 2) / max(np.sum(w) - 1, 1)
                D_mle_var = nv / max(wss, 1e-10)
            else:
                D_mle_var = D_prior_std ** 2 * 10
        else:
            D_mle_var = D_prior_std ** 2 * 100

        pp = 1.0 / max(D_prior_std ** 2, 1e-10)
        lp = 1.0 / max(D_mle_var, 1e-10)
        D_post = (pp * D_prior + lp * D_mle) / (pp + lp)

        predicted = D_post * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


ALGORITHMS_V7 = {
    'shape_selection': shape_selection_factory,
    'shape_selection_robust': shape_selection_robust_factory,
}
