"""
Draw-in prediction - Version 11 (Refined Shape Selection).

Refines V7 shape selection with:
1. Denoised values for shape scoring (better SNR)
2. Adaptive temperature based on data quantity + noise
3. Better D estimation weighting (emphasize high-signal region)
"""

import numpy as np
from scipy.signal import savgol_filter
from typing import Dict
from data_model import N_PTS, SAME_SIDE_CORNERS


def _smooth_alpha(alpha, window=31):
    n = len(alpha)
    w = min(window, n // 2 * 2 - 1)
    w = max(w, 5)
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


def _denoise(values, window=21):
    n = len(values)
    w = min(window, n // 2 * 2 - 1)
    w = max(w, 5)
    if w % 2 == 0:
        w += 1
    return savgol_filter(values, w, min(3, w - 1))


def refined_shape_selection_factory(train_data: Dict, params) -> callable:
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

        # Denoise observed values for better shape scoring
        if cutoff_idx > 15:
            values_score = _denoise(values_observed, window=15)
        else:
            values_score = values_observed

        # Score each training shape
        D_fits = np.zeros(n_shapes)
        D_fits_raw = np.zeros(n_shapes)
        rss_denoised = np.zeros(n_shapes)
        rss_raw = np.zeros(n_shapes)

        for i in range(n_shapes):
            shape_at = np.interp(alpha_smooth, model['alpha_grid'], shapes[i])
            so = shape_at[:cutoff_idx]
            ss = np.sum(so ** 2)
            if ss > 1e-10:
                # D from denoised (for scoring)
                D_fits[i] = np.sum(values_score * so) / ss
                rss_denoised[i] = np.sum((values_score - D_fits[i] * so) ** 2)
                # D from raw (for estimation)
                D_fits_raw[i] = np.sum(values_observed * so) / ss
                rss_raw[i] = np.sum((values_observed - D_fits_raw[i] * so) ** 2)
            else:
                D_fits[i] = D_prior
                D_fits_raw[i] = D_prior
                rss_denoised[i] = 1e10
                rss_raw[i] = 1e10

        # Weights from denoised RSS (better shape discrimination)
        rss_min = np.min(rss_denoised)
        # Adaptive temperature: normalize by number of points and noise
        temp = max(rss_min * 0.5, np.median(rss_denoised) * 0.1) + 1e-10
        log_w = -(rss_denoised - rss_min) / temp
        log_w = np.clip(log_w, -50, 0)
        weights = np.exp(log_w)
        weights /= weights.sum()

        # Noise estimation from best raw fit
        best_idx = np.argmin(rss_raw)
        best_shape_at = np.interp(alpha_smooth, model['alpha_grid'],
                                  shapes[best_idx])
        best_res = values_observed - D_fits_raw[best_idx] * best_shape_at[:cutoff_idx]
        noise_est = np.sqrt(np.mean(best_res ** 2))
        signal_at_cutoff = max(np.mean(values_observed[-10:]) if cutoff_idx > 10
                               else np.max(values_observed), 1.0)
        noise_ratio = noise_est / signal_at_cutoff

        # Blend with median at high noise
        median_weight = np.clip(noise_ratio * 5.0, 0.0, 0.7)
        selected_shape = np.average(shapes, weights=weights, axis=0)
        blended_shape = (1 - median_weight) * selected_shape + \
                        median_weight * model['med_shape']
        shape_full = np.interp(alpha_smooth, model['alpha_grid'], blended_shape)

        # D estimation with IRLS on raw values
        shape_obs = shape_full[:cutoff_idx]
        ss = np.sum(shape_obs ** 2)

        if ss > 1e-10 and cutoff_idx > 5:
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
                D_mle = D_prior
                D_mle_var = D_prior_std ** 2 * 10
        else:
            D_mle = D_prior
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


ALGORITHMS_V11 = {
    'refined_shape_sel': refined_shape_selection_factory,
}
