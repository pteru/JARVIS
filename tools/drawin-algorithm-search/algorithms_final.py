"""
Draw-in prediction - Final algorithm.

Adaptive alpha smoothing + Bayesian D estimation.
The smoothing window adapts to estimated noise level.
"""

import numpy as np
from scipy.signal import savgol_filter
from typing import Dict
from data_model import N_PTS, SAME_SIDE_CORNERS


def _smooth_alpha(alpha, window=31, polyorder=3):
    """Smooth noisy alpha."""
    n = len(alpha)
    w = min(window, n // 2 * 2 - 1)
    if w < 5:
        w = 5
    if w % 2 == 0:
        w += 1
    smoothed = savgol_filter(alpha, window_length=w, polyorder=polyorder)
    smoothed = np.maximum.accumulate(smoothed)
    smoothed = np.clip(smoothed, 0, 1)
    if smoothed[-1] > smoothed[0] + 1e-10:
        smoothed = (smoothed - smoothed[0]) / (smoothed[-1] - smoothed[0])
    return smoothed


def _resample(alpha, values, grid):
    """Resample to regular grid."""
    a = np.maximum.accumulate(alpha) + np.arange(len(alpha)) * 1e-12
    return np.interp(grid, a, values)


def _estimate_noise_level(alpha):
    """Estimate noise level in alpha from local variability."""
    # Use second differences to estimate noise (robust to smooth trends)
    if len(alpha) < 5:
        return 0.01
    d2 = np.diff(alpha, n=2)
    # MAD of second differences
    mad = np.median(np.abs(d2 - np.median(d2)))
    # Convert MAD to std (for Gaussian: std ≈ 1.4826 * MAD)
    # For second differences of noise with std σ: std(d2) = sqrt(6) * σ
    noise_std = 1.4826 * mad / np.sqrt(6)
    return max(noise_std, 0.001)


def final_algorithm_factory(train_data: Dict, params) -> callable:
    """
    Final optimized algorithm:
    1. Adaptive alpha smoothing based on estimated noise level
    2. Robust shape from training (median)
    3. Bayesian D with IRLS for robustness
    """

    alpha_grid = np.linspace(0, 1, N_PTS)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        resampled_shapes = []
        D_ratios = []

        for s in strokes:
            alpha = np.array(s['alpha'])
            # Adaptive smoothing for training
            noise_est = _estimate_noise_level(alpha)
            # Higher noise → wider window
            window = max(11, min(71, int(noise_est * 2000) * 2 + 11))
            if window % 2 == 0:
                window += 1

            alpha_s = _smooth_alpha(alpha, window=window, polyorder=3)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample(alpha_s, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

        shapes_arr = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)

        # Robust average shape
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

        # Adaptive alpha smoothing for test stroke
        noise_est = _estimate_noise_level(alpha_full)
        window = max(11, min(71, int(noise_est * 2000) * 2 + 11))
        if window % 2 == 0:
            window += 1
        alpha_smooth = _smooth_alpha(alpha_full, window=window, polyorder=3)

        # Shape at smooth alpha
        shape_full = np.interp(alpha_smooth, model['alpha_grid'], model['avg_shape'])

        # D estimation
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        shape_obs = shape_full[:cutoff_idx]
        ss = np.sum(shape_obs ** 2)

        if ss > 1e-10 and cutoff_idx > 5:
            # IRLS D estimation
            D_mle = np.sum(values_observed * shape_obs) / ss
            residuals = values_observed - D_mle * shape_obs
            mad = max(np.median(np.abs(residuals)), 0.1)
            threshold = 2.0 * mad
            w = np.where(np.abs(residuals) < threshold, 1.0,
                         threshold / (np.abs(residuals) + 1e-10))

            wss = np.sum(w * shape_obs ** 2)
            if wss > 1e-10:
                D_mle = np.sum(w * values_observed * shape_obs) / wss
                res2 = values_observed - D_mle * shape_obs
                noise_var = np.sum(w * res2 ** 2) / max(np.sum(w) - 1, 1)
                D_mle_var = noise_var / max(wss, 1e-10)
            else:
                D_mle_var = D_prior_std ** 2 * 10
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


ALGORITHMS_FINAL = {
    'final': final_algorithm_factory,
}
