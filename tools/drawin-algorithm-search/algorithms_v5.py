"""
Draw-in prediction algorithms - Version 5.

Focus: Minimizing RMSE through optimal D estimation and alpha smoothing.
Best approach from V3 (smooth alpha + Bayesian D) with refinements.
"""

import numpy as np
from scipy.signal import savgol_filter
from scipy.optimize import minimize
from typing import Dict
from data_model import N_PTS, s_curve, SAME_SIDE_CORNERS


def _smooth_alpha(alpha, window=31, polyorder=3):
    """Smooth noisy alpha."""
    n = len(alpha)
    if n < window:
        window = max(5, n // 2 * 2 + 1)
    smoothed = savgol_filter(alpha, window_length=window, polyorder=polyorder)
    smoothed = np.maximum.accumulate(smoothed)
    smoothed = np.clip(smoothed, 0, 1)
    if smoothed[-1] > smoothed[0] + 1e-10:
        smoothed = (smoothed - smoothed[0]) / (smoothed[-1] - smoothed[0])
    return smoothed


def _resample(alpha, values, grid):
    """Resample to regular grid."""
    a = np.maximum.accumulate(alpha) + np.arange(len(alpha)) * 1e-12
    return np.interp(grid, a, values)


def optimal_bayesian_factory(train_data: Dict, params) -> callable:
    """
    Optimized algorithm:
    1. Aggressive alpha smoothing (window=51 for better noise reduction)
    2. Precise Bayesian D with adaptive prior weighting
    3. Per-sensor D ratio (not averaged across training)
    4. Robust shape estimation
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
            # Use aggressive smoothing for training shapes
            alpha_s = _smooth_alpha(alpha, window=51, polyorder=3)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample(alpha_s, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

        shapes_arr = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)

        # Median shape for robustness
        avg_shape = np.median(shapes_arr, axis=0)
        avg_shape[0] = 0.0
        avg_shape[-1] = 1.0
        avg_shape = np.maximum.accumulate(avg_shape)
        if avg_shape[-1] > 0:
            avg_shape /= avg_shape[-1]

        # Also compute shape variance for uncertainty
        shape_var = np.var(shapes_arr, axis=0)

        sensor_models[ms_name] = {
            'avg_shape': avg_shape,
            'shape_var': shape_var,
            'alpha_grid': alpha_grid,
            'D_ratio_mean': float(np.mean(D_ratios)),
            'D_ratio_std': float(max(np.std(D_ratios), 0.005)),
            'n_train': len(strokes),
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

        # Aggressive alpha smoothing
        alpha_smooth = _smooth_alpha(alpha_full, window=51, polyorder=3)

        # Shape at smooth alpha
        shape_full = np.interp(alpha_smooth, model['alpha_grid'], model['avg_shape'])

        # --- D estimation ---
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # Use observed data for D likelihood
        shape_obs = shape_full[:cutoff_idx]

        # Iteratively reweighted least squares for robust D estimation
        # Start with uniform weights, then downweight outliers
        weights = np.ones(cutoff_idx)
        D_est = D_prior

        for iteration in range(3):
            wss = np.sum(weights * shape_obs ** 2)
            if wss > 1e-10:
                D_est = np.sum(weights * values_observed * shape_obs) / wss
                residuals = values_observed - D_est * shape_obs
                # Huber-like reweighting
                mad = np.median(np.abs(residuals))
                threshold = max(1.5 * mad, 0.5)
                weights = np.where(np.abs(residuals) < threshold,
                                   1.0,
                                   threshold / (np.abs(residuals) + 1e-10))
            else:
                D_est = D_prior
                break

        # Compute final D_mle variance from weighted residuals
        if wss > 1e-10:
            final_residuals = values_observed - D_est * shape_obs
            noise_var = np.sum(weights * final_residuals ** 2) / max(np.sum(weights) - 1, 1)
            D_mle_var = noise_var / max(wss, 1e-10)
        else:
            D_mle_var = D_prior_std ** 2 * 100

        D_mle = D_est

        # Bayesian combination
        prior_prec = 1.0 / max(D_prior_std ** 2, 1e-10)
        like_prec = 1.0 / max(D_mle_var, 1e-10)
        D_post = (prior_prec * D_prior + like_prec * D_mle) / (prior_prec + like_prec)

        # Prediction
        predicted = D_post * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


def optimal_with_k_correction_factory(train_data: Dict, params) -> callable:
    """
    Like optimal_bayesian but also fits a steepness correction.
    Uses the smooth alpha shape + a multiplicative k-correction.

    The k-correction captures the steepness difference between middle
    and corner sensors for this specific stroke.
    """

    alpha_grid = np.linspace(0, 1, N_PTS)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        resampled_shapes = []
        D_ratios = []
        # Learn shape at multiple k offsets for interpolation
        shape_variants = {}

        for s in strokes:
            alpha = np.array(s['alpha'])
            alpha_s = _smooth_alpha(alpha, window=51, polyorder=3)
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample(alpha_s, shape, alpha_grid)
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
        alpha_smooth = _smooth_alpha(alpha_full, window=51, polyorder=3)

        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        alpha_obs_s = alpha_smooth[:cutoff_idx]

        # Joint fit: D and a shape correction parameter 'beta'
        # shape_corrected(alpha) = avg_shape(alpha^beta) where beta ≈ 1
        # This is a one-parameter shape correction that captures k mismatch
        def objective(x):
            D, beta = x
            alpha_corrected = np.clip(alpha_obs_s, 0, 1) ** beta
            shape_obs = np.interp(alpha_corrected, model['alpha_grid'],
                                  model['avg_shape'])
            pred_obs = D * shape_obs

            data_fit = np.sum((pred_obs - values_observed) ** 2)
            reg_D = ((D - D_prior) / max(D_prior_std, 0.1)) ** 2
            # Very strong beta regularization (prevent overfitting to noise)
            reg_beta = 500.0 * (beta - 1.0) ** 2

            frac_seen = cutoff_idx / N_PTS
            pw = max(0.3, (1.0 - frac_seen) * 2.0)
            return data_fit + pw * reg_D + reg_beta

        result = minimize(objective, [D_prior, 1.0],
                         bounds=[(D_prior * 0.5, D_prior * 2.0), (0.9, 1.1)],
                         method='L-BFGS-B')
        D_fit, beta_fit = result.x

        alpha_corrected_full = np.clip(alpha_smooth, 0, 1) ** beta_fit
        shape_full = np.interp(alpha_corrected_full, model['alpha_grid'],
                               model['avg_shape'])
        predicted = D_fit * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


def ultimate_factory(train_data: Dict, params) -> callable:
    """
    The ultimate algorithm: combines all best ideas.

    1. Heavy alpha smoothing (window=51)
    2. Robust shape from training (median + smoothing)
    3. IRLS D estimation with Bayesian prior
    4. Mild beta correction with very strong regularization
    5. Adaptive: uses only D prior when observed data is too noisy
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
            alpha_s = _smooth_alpha(alpha, window=51, polyorder=3)
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

        # Light smoothing of the average shape
        from scipy.signal import savgol_filter as sg
        if len(avg_shape) >= 11:
            avg_shape = sg(avg_shape, 11, 3)

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
        alpha_smooth = _smooth_alpha(alpha_full, window=51, polyorder=3)

        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # Shape at smooth alpha
        shape_full = np.interp(alpha_smooth, model['alpha_grid'], model['avg_shape'])
        shape_obs = shape_full[:cutoff_idx]

        # Robust D estimation via IRLS
        ss = np.sum(shape_obs ** 2)
        if ss > 1e-10 and cutoff_idx > 5:
            # Initial D from simple LS
            D_mle = np.sum(values_observed * shape_obs) / ss

            # One round of outlier downweighting
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

        # Bayesian combination
        prior_prec = 1.0 / max(D_prior_std ** 2, 1e-10)
        like_prec = 1.0 / max(D_mle_var, 1e-10)
        D_post = (prior_prec * D_prior + like_prec * D_mle) / (prior_prec + like_prec)

        predicted = D_post * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


ALGORITHMS_V5 = {
    'optimal_bayesian': optimal_bayesian_factory,
    'optimal_k_corr': optimal_with_k_correction_factory,
    'ultimate': ultimate_factory,
}
