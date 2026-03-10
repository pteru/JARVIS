"""
Draw-in prediction algorithms - Version 2.

Key insight: When parameterized by alpha (stroke progress from corners),
the normalized middle curve y/D is nearly identical across strokes.
The main variation is amplitude D, estimable from corner DI ratio.
"""

import numpy as np
from scipy.optimize import minimize_scalar, minimize
from typing import Dict, List, Any
from data_model import N_PTS, s_curve, SAME_SIDE_CORNERS

N_ALPHA = 200  # regular alpha grid for shape resampling


def _resample_to_alpha_grid(alpha, values, alpha_grid):
    """Resample values from irregular alpha to regular alpha grid."""
    # Ensure alpha is monotonically increasing (noise can cause non-monotonicity)
    # Use a cumulative max to enforce monotonicity
    alpha_mono = np.maximum.accumulate(alpha)
    # Add tiny increments to ensure strict monotonicity for interp
    eps = np.arange(len(alpha_mono)) * 1e-12
    alpha_mono = alpha_mono + eps
    return np.interp(alpha_grid, alpha_mono, values)


def _smooth_shape(shape, window=5):
    """Light smoothing of shape with endpoint preservation."""
    if len(shape) < window:
        return shape
    kernel = np.ones(window) / window
    smoothed = np.convolve(shape, kernel, mode='same')
    # Preserve endpoints
    smoothed[0] = shape[0]
    smoothed[-1] = shape[-1]
    return smoothed


# =============================================================================
# Algorithm A: Alpha-Space Shape Model with Bayesian D Estimation
# =============================================================================

def alpha_shape_bayesian_factory(train_data: Dict, params) -> callable:
    """
    Core approach:
    1. Resample all training normalized curves to common alpha grid
    2. Average to get canonical shape f(alpha)
    3. Estimate D from corner ratio (prior) + observed data (likelihood)
    4. Predict: middle(alpha) = D * f(alpha)
    """

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
            values = np.array(s['values'])
            D = s['total_di']

            # Normalized shape
            shape = values / D

            # Resample to common alpha grid
            resampled = _resample_to_alpha_grid(alpha, shape, alpha_grid)
            resampled_shapes.append(resampled)

            # D ratio (middle / corner avg)
            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

        resampled_shapes = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)

        # Canonical shape: median (more robust than mean with noise)
        avg_shape = np.median(resampled_shapes, axis=0)

        # Ensure monotonicity and endpoints
        avg_shape[0] = 0.0
        avg_shape[-1] = 1.0
        avg_shape = np.maximum.accumulate(avg_shape)
        # Re-normalize to [0, 1]
        if avg_shape[-1] > 0:
            avg_shape = avg_shape / avg_shape[-1]

        # Smooth slightly to reduce noise in shape
        avg_shape = _smooth_shape(avg_shape, window=5)
        avg_shape[0] = 0.0
        avg_shape[-1] = 1.0

        sensor_models[ms_name] = {
            'avg_shape': avg_shape,
            'alpha_grid': alpha_grid,
            'D_ratio_mean': np.mean(D_ratios),
            'D_ratio_std': max(np.std(D_ratios), 0.01),
            'resampled_shapes': resampled_shapes,
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            pred[cutoff_idx:] = values_observed[-1]
            return pred

        corners = SAME_SIDE_CORNERS[ms_name]

        # Get canonical shape at test alpha values
        shape_full = np.interp(alpha_full, model['alpha_grid'], model['avg_shape'])

        # --- D Estimation ---
        # Prior from corner DI ratio
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # Likelihood from observed data
        shape_obs = shape_full[:cutoff_idx]
        ss_shape = np.sum(shape_obs ** 2)

        if ss_shape > 1e-10:
            # Weighted LS: weight later points more (higher SNR)
            w = np.linspace(0.3, 1.0, cutoff_idx) ** 2
            D_mle = np.sum(w * values_observed * shape_obs) / np.sum(w * shape_obs ** 2)

            # Estimate noise from residuals
            residual = values_observed - D_mle * shape_obs
            noise_var = np.mean(residual ** 2)
            # D_mle variance
            D_mle_var = noise_var / max(np.sum(w * shape_obs ** 2), 1e-10)
        else:
            D_mle = D_prior
            D_mle_var = D_prior_std ** 2 * 100  # very uncertain

        # Bayesian posterior
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


# =============================================================================
# Algorithm B: Alpha-Shape + Gamma Correction
# =============================================================================

def alpha_shape_gamma_factory(train_data: Dict, params) -> callable:
    """
    Like Algorithm A, but adds a gamma correction:
    middle(alpha) = D * f(alpha^gamma)

    gamma captures steepness difference between middle and corner sensors.
    gamma is estimated from the observed portion of the test stroke.
    """

    alpha_grid = np.linspace(0, 1, N_ALPHA)

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        resampled_shapes = []
        D_ratios = []
        gammas = []  # gamma values from training

        for s in strokes:
            alpha = np.array(s['alpha'])
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample_to_alpha_grid(alpha, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

        resampled_shapes = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)

        avg_shape = np.median(resampled_shapes, axis=0)
        avg_shape[0] = 0.0
        avg_shape[-1] = 1.0
        avg_shape = np.maximum.accumulate(avg_shape)
        if avg_shape[-1] > 0:
            avg_shape = avg_shape / avg_shape[-1]
        avg_shape = _smooth_shape(avg_shape, window=5)
        avg_shape[0] = 0.0
        avg_shape[-1] = 1.0

        sensor_models[ms_name] = {
            'avg_shape': avg_shape,
            'alpha_grid': alpha_grid,
            'D_ratio_mean': np.mean(D_ratios),
            'D_ratio_std': max(np.std(D_ratios), 0.01),
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            pred[cutoff_idx:] = values_observed[-1]
            return pred

        corners = SAME_SIDE_CORNERS[ms_name]

        # D estimation (same as Algorithm A)
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # Joint optimization of D and gamma on observed data
        def objective(x):
            D, gamma = x
            # Apply gamma warp
            alpha_warped = np.clip(alpha_observed, 0, 1) ** gamma
            shape_obs = np.interp(alpha_warped, model['alpha_grid'], model['avg_shape'])
            pred_obs = D * shape_obs

            data_fit = np.sum((pred_obs - values_observed) ** 2)
            # Regularize gamma toward 1
            reg_gamma = 100.0 * (gamma - 1.0) ** 2
            # Regularize D toward prior
            reg_D = ((D - D_prior) / max(D_prior_std, 0.1)) ** 2
            # Weight reg more when less data
            frac_seen = cutoff_idx / N_PTS
            pw = max(0.3, (1.0 - frac_seen) * 3.0)
            return data_fit + pw * reg_D + reg_gamma

        result = minimize(objective, [D_prior, 1.0],
                         bounds=[(D_prior * 0.3, D_prior * 3.0), (0.7, 1.5)],
                         method='L-BFGS-B')
        D_fit, gamma_fit = result.x

        # Full prediction
        alpha_warped_full = np.clip(alpha_full, 0, 1) ** gamma_fit
        shape_full = np.interp(alpha_warped_full, model['alpha_grid'], model['avg_shape'])
        predicted = D_fit * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


# =============================================================================
# Algorithm C: Corner-Weighted Template Ensemble + Bayesian D
# =============================================================================

def corner_weighted_template_factory(train_data: Dict, params) -> callable:
    """
    Instead of a single average shape, weight training shapes by corner
    similarity to the test stroke. This adapts the shape to the specific
    stroke's characteristics (speed profile, steepness).
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
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample_to_alpha_grid(alpha, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

            # Corner profile for matching (resample to regular grid too)
            cp = []
            for c in corners:
                corner_norm = s['corner_curves'][c] / s['corner_dis'][c]
                cp.append(_resample_to_alpha_grid(alpha, corner_norm, alpha_grid))
            corner_profiles.append(np.concatenate(cp))

        resampled_shapes = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)
        corner_profiles = np.array(corner_profiles)

        sensor_models[ms_name] = {
            'resampled_shapes': resampled_shapes,
            'alpha_grid': alpha_grid,
            'D_ratios': D_ratios,
            'D_ratio_mean': np.mean(D_ratios),
            'D_ratio_std': max(np.std(D_ratios), 0.01),
            'corner_profiles': corner_profiles,
            'strokes': strokes,
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            pred[cutoff_idx:] = values_observed[-1]
            return pred

        corners = SAME_SIDE_CORNERS[ms_name]

        # Build test corner profile (on regular alpha grid)
        # First need alpha for the test stroke -> we use alpha_full
        test_cp = []
        for c in corners:
            corner_norm = corner_curves[c] / corner_dis[c]
            test_cp.append(_resample_to_alpha_grid(alpha_full, corner_norm, model['alpha_grid']))
        test_cp = np.concatenate(test_cp)

        # Compute weights based on corner similarity
        diffs = model['corner_profiles'] - test_cp[np.newaxis, :]
        distances = np.sqrt(np.mean(diffs ** 2, axis=1))

        # Temperature-scaled softmax
        temp = max(np.median(distances) * 0.3, 1e-8)
        weights = np.exp(-distances / temp)
        weights /= weights.sum()

        # Weighted average shape
        predicted_shape = np.average(model['resampled_shapes'], weights=weights, axis=0)

        # Weighted D ratio
        D_ratio_weighted = np.average(model['D_ratios'], weights=weights)

        # D estimation
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = D_ratio_weighted * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # Shape at test alpha
        shape_full = np.interp(alpha_full, model['alpha_grid'], predicted_shape)

        # D from observed data
        shape_obs = shape_full[:cutoff_idx]
        ss = np.sum(shape_obs ** 2)
        if ss > 1e-10:
            w = np.linspace(0.3, 1.0, cutoff_idx) ** 2
            D_mle = np.sum(w * values_observed * shape_obs) / np.sum(w * shape_obs ** 2)
            residual = values_observed - D_mle * shape_obs
            noise_var = np.mean(residual ** 2)
            D_mle_var = noise_var / max(np.sum(w * shape_obs ** 2), 1e-10)
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
# Algorithm D: Combined - Corner-Weighted Templates + Gamma + Bayesian D
# =============================================================================

def combined_factory(train_data: Dict, params) -> callable:
    """
    Best of all worlds:
    1. Corner-weighted template shapes (adapt to stroke)
    2. Gamma correction (adapt to steepness)
    3. Bayesian D estimation (robust amplitude)
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
            values = np.array(s['values'])
            D = s['total_di']

            shape = values / D
            resampled = _resample_to_alpha_grid(alpha, shape, alpha_grid)
            resampled_shapes.append(resampled)

            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            D_ratios.append(D / avg_corner_di)

            cp = []
            for c in corners:
                corner_norm = s['corner_curves'][c] / s['corner_dis'][c]
                cp.append(_resample_to_alpha_grid(alpha, corner_norm, alpha_grid))
            corner_profiles.append(np.concatenate(cp))

        resampled_shapes = np.array(resampled_shapes)
        D_ratios = np.array(D_ratios)
        corner_profiles = np.array(corner_profiles)

        sensor_models[ms_name] = {
            'resampled_shapes': resampled_shapes,
            'alpha_grid': alpha_grid,
            'D_ratios': D_ratios,
            'D_ratio_mean': np.mean(D_ratios),
            'D_ratio_std': max(np.std(D_ratios), 0.01),
            'corner_profiles': corner_profiles,
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            pred[cutoff_idx:] = values_observed[-1]
            return pred

        corners = SAME_SIDE_CORNERS[ms_name]

        # Corner-weighted shape
        test_cp = []
        for c in corners:
            corner_norm = corner_curves[c] / corner_dis[c]
            test_cp.append(_resample_to_alpha_grid(alpha_full, corner_norm, model['alpha_grid']))
        test_cp = np.concatenate(test_cp)

        diffs = model['corner_profiles'] - test_cp[np.newaxis, :]
        distances = np.sqrt(np.mean(diffs ** 2, axis=1))
        temp = max(np.median(distances) * 0.3, 1e-8)
        weights = np.exp(-distances / temp)
        weights /= weights.sum()

        predicted_shape = np.average(model['resampled_shapes'], weights=weights, axis=0)
        D_ratio_weighted = np.average(model['D_ratios'], weights=weights)

        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = D_ratio_weighted * avg_corner_di
        D_prior_std = model['D_ratio_std'] * avg_corner_di

        # Joint optimization: D and gamma
        def objective(x):
            D, gamma = x
            alpha_w = np.clip(alpha_observed, 0, 1) ** gamma
            shape_obs = np.interp(alpha_w, model['alpha_grid'], predicted_shape)
            pred_obs = D * shape_obs

            # Weighted data fit (emphasize later, higher-SNR points)
            w = np.linspace(0.3, 1.0, cutoff_idx) ** 2
            data_fit = np.sum(w * (pred_obs - values_observed) ** 2)

            reg_gamma = 50.0 * (gamma - 1.0) ** 2
            reg_D = ((D - D_prior) / max(D_prior_std, 0.1)) ** 2

            frac_seen = cutoff_idx / N_PTS
            pw = max(0.3, (1.0 - frac_seen) * 3.0)
            return data_fit + pw * reg_D + reg_gamma

        result = minimize(objective, [D_prior, 1.0],
                         bounds=[(D_prior * 0.3, D_prior * 3.0), (0.7, 1.5)],
                         method='L-BFGS-B')
        D_fit, gamma_fit = result.x

        alpha_w_full = np.clip(alpha_full, 0, 1) ** gamma_fit
        shape_full = np.interp(alpha_w_full, model['alpha_grid'], predicted_shape)
        predicted = D_fit * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


# =============================================================================
# Algorithm E: Direct Corner-to-Middle Mapping (no alpha)
# =============================================================================

def direct_corner_mapping_factory(train_data: Dict, params) -> callable:
    """
    Skip alpha entirely. Learn a direct mapping from corner curves to
    middle curve. Since corners are complete, no extrapolation needed.

    Method: express middle curve as linear combination of corner curves
    plus a time-varying offset.
    """

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        # Build regression: middle[t] = sum_c(w_c * corner_c[t]) + w0
        # For each time step t, we learn weights
        # But that's N_PTS * (n_corners + 1) parameters — too many.
        # Instead, learn a single set of weights per sensor.

        # Actually, model: middle_curve = a * corner1 + b * corner3 + c
        # where a, b, c are scalars (or slowly varying)

        # Build feature matrix [corner1/d1, corner3/d3, 1] for all time steps, all strokes
        n = len(strokes)
        X_list = []
        y_list = []

        for s in strokes:
            for t in range(N_PTS):
                features = []
                for c in corners:
                    features.append(s['corner_curves'][c][t] / s['corner_dis'][c])
                features.append(1.0)  # bias
                X_list.append(features)
                y_list.append(s['values'][t])

        X = np.array(X_list)
        y = np.array(y_list)

        # Ridge regression
        lam = 1.0
        XtX = X.T @ X + lam * np.eye(X.shape[1])
        Xty = X.T @ y
        weights = np.linalg.solve(XtX, Xty)

        sensor_models[ms_name] = {
            'weights': weights,
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            pred[cutoff_idx:] = values_observed[-1]
            return pred

        corners = SAME_SIDE_CORNERS[ms_name]
        w = model['weights']

        # Predict full curve from corner curves
        predicted = np.zeros(N_PTS)
        for t in range(N_PTS):
            features = []
            for c in corners:
                features.append(corner_curves[c][t] / corner_dis[c])
            features.append(1.0)
            predicted[t] = np.dot(features, w)

        predicted = np.maximum(0, predicted)

        # Scale prediction to match observed portion
        pred_obs = predicted[:cutoff_idx]
        if np.sum(pred_obs ** 2) > 1e-10:
            scale = np.sum(values_observed * pred_obs) / np.sum(pred_obs ** 2)
            scale = np.clip(scale, 0.8, 1.2)
            predicted *= scale

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


# =============================================================================
# Algorithm F: Per-Point Corner Regression (time-varying weights)
# =============================================================================

def per_point_regression_factory(train_data: Dict, params) -> callable:
    """
    For each alpha-grid point, learn a regression from corner values to
    middle value. This captures the full nonlinear relationship.
    """

    alpha_grid = np.linspace(0, 1, N_ALPHA)

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]
        n_corners = len(corners)

        # For each alpha grid point, collect (corner_values, middle_value) pairs
        # Resample everything to alpha grid first
        corner_data = []  # (n_strokes, n_corners, N_ALPHA)
        middle_data = []  # (n_strokes, N_ALPHA)

        for s in strokes:
            alpha = np.array(s['alpha'])

            # Resample middle
            mid_resampled = _resample_to_alpha_grid(alpha, s['values'], alpha_grid)
            middle_data.append(mid_resampled)

            # Resample corners
            corner_resampled = []
            for c in corners:
                cr = _resample_to_alpha_grid(alpha, s['corner_curves'][c], alpha_grid)
                corner_resampled.append(cr)
            corner_data.append(corner_resampled)

        corner_data = np.array(corner_data)  # (n_strokes, n_corners, N_ALPHA)
        middle_data = np.array(middle_data)  # (n_strokes, N_ALPHA)

        # For each alpha point, fit regression: middle = w0 + w1*c1 + w2*c2
        # Use all training strokes
        n = len(strokes)
        weights_per_point = np.zeros((N_ALPHA, n_corners + 1))

        for ai in range(N_ALPHA):
            X = np.column_stack([
                corner_data[:, ci, ai] for ci in range(n_corners)
            ] + [np.ones(n)])
            y = middle_data[:, ai]

            # Ridge regression with moderate regularization
            lam = 0.1
            XtX = X.T @ X + lam * np.eye(X.shape[1])
            Xty = X.T @ y
            weights_per_point[ai] = np.linalg.solve(XtX, Xty)

        sensor_models[ms_name] = {
            'weights': weights_per_point,
            'alpha_grid': alpha_grid,
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            pred[cutoff_idx:] = values_observed[-1]
            return pred

        corners = SAME_SIDE_CORNERS[ms_name]

        # Resample test corner curves to alpha grid
        test_corners = []
        for c in corners:
            cr = _resample_to_alpha_grid(alpha_full, corner_curves[c], model['alpha_grid'])
            test_corners.append(cr)

        # Predict at each alpha grid point
        pred_on_grid = np.zeros(N_ALPHA)
        for ai in range(N_ALPHA):
            features = [tc[ai] for tc in test_corners] + [1.0]
            pred_on_grid[ai] = np.dot(features, model['weights'][ai])

        pred_on_grid = np.maximum(0, pred_on_grid)

        # Resample back to test alpha
        predicted = np.interp(alpha_full, model['alpha_grid'], pred_on_grid)

        # Scale to match observed portion
        pred_obs = predicted[:cutoff_idx]
        if np.sum(pred_obs ** 2) > 1e-10 and len(values_observed) > 5:
            # Use only the latter half of observed data for scaling (higher SNR)
            half = max(cutoff_idx // 2, 1)
            scale = np.sum(values_observed[half:] * pred_obs[half:]) / \
                    np.sum(pred_obs[half:] ** 2)
            scale = np.clip(scale, 0.85, 1.15)
            predicted *= scale

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


# =============================================================================
# Algorithm G: Hybrid Shape-Template + Per-Point Regression
# =============================================================================

def hybrid_factory(train_data: Dict, params) -> callable:
    """
    Combine shape-based approach with per-point regression.
    Use per-point regression as primary (it handles speed variation naturally),
    fall back to shape model when regression is unreliable.
    """

    # Build both sub-algorithms
    shape_pred = alpha_shape_bayesian_factory(train_data, params)
    regression_pred = per_point_regression_factory(train_data, params)

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        kw = dict(ms_name=ms_name, alpha_observed=alpha_observed,
                  values_observed=values_observed, cutoff_idx=cutoff_idx,
                  alpha_full=alpha_full, corner_curves=corner_curves,
                  corner_dis=corner_dis)

        pred_shape = shape_pred(**kw)
        pred_reg = regression_pred(**kw)

        # Score each on visible portion
        err_shape = np.mean((pred_shape[:cutoff_idx] - values_observed) ** 2)
        err_reg = np.mean((pred_reg[:cutoff_idx] - values_observed) ** 2)

        # Weighted combination (favor the one with better visible fit)
        w_shape = 1.0 / (err_shape + 1e-6)
        w_reg = 1.0 / (err_reg + 1e-6)
        total = w_shape + w_reg

        output = (w_shape * pred_shape + w_reg * pred_reg) / total
        output[:cutoff_idx] = values_observed

        return output

    return predict


# =============================================================================
# Algorithm Registry
# =============================================================================

ALGORITHMS_V2 = {
    'alpha_shape_bayesian': alpha_shape_bayesian_factory,
    'alpha_shape_gamma': alpha_shape_gamma_factory,
    'corner_weighted_template': corner_weighted_template_factory,
    'combined_D_gamma_template': combined_factory,
    'direct_corner_mapping': direct_corner_mapping_factory,
    'per_point_regression': per_point_regression_factory,
    'hybrid_shape_regression': hybrid_factory,
}
