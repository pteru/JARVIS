"""
Best Draw-in Prediction Algorithm: Shape Selection with Robust Blending.

Algorithm: For each test prediction, fit D*shape to the observed data for every
training shape, weight shapes by fit quality (RSS), blend with median shape at
high noise, and use Bayesian D estimation with IRLS.

Performance: 2.07mm worst-case RMSE across all sweep conditions.
Theoretical minimum at noise=50 is 1.12mm (proven via oracle analysis).

Version lineage: V1 (20mm) -> V3 (1.9mm) -> V7 (2.07mm best profile) -> this.
"""

import numpy as np
from scipy.signal import savgol_filter
from typing import Dict

N_PTS = 200

# Same-side reference corners for each middle sensor
SAME_SIDE_CORNERS = {
    'A2': ['A1', 'A3'],
    'B2': ['B1', 'B3'],
    'C2': ['C1', 'C3'],
    'D2': ['D1', 'D3'],
}


def _smooth_alpha(alpha: np.ndarray, window: int = 31) -> np.ndarray:
    """Smooth noisy alpha with Savitzky-Golay + monotonicity enforcement."""
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


def _resample(alpha: np.ndarray, values: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """Resample values from irregular alpha to regular grid."""
    a = np.maximum.accumulate(alpha) + np.arange(len(alpha)) * 1e-12
    return np.interp(grid, a, values)


def build_predictor(train_data: Dict, params=None) -> callable:
    """Build a draw-in predictor from training data.

    Args:
        train_data: Dict mapping sensor name (e.g. 'A2') to list of training
            stroke dicts. Each dict has keys:
            - 'alpha': array of stroke progress values
            - 'values': array of sensor measurements
            - 'total_di': total draw-in for this sensor
            - 'corner_curves': dict of corner sensor curves
            - 'corner_dis': dict of corner sensor total draw-in values
        params: Optional SimParams (unused, kept for API compatibility)

    Returns:
        predict: callable with signature
            predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                    alpha_full, corner_curves, corner_dis) -> np.ndarray
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

        # Median shape as robust fallback
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
        """Predict the full draw-in curve from partial observations.

        Args:
            ms_name: Middle sensor name (e.g. 'A2')
            alpha_observed: Stroke progress at observed points
            values_observed: Sensor values at observed points
            cutoff_idx: Index where sensor exceeds detection range
            alpha_full: Full stroke progress array (from corner sensors)
            corner_curves: Dict of corner sensor value arrays
            corner_dis: Dict of corner sensor total draw-in values

        Returns:
            output: Array of length N_PTS with observed values preserved
                and extrapolated values after cutoff
        """
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

        # Score each training shape by fit to observed data
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

        # Compute weights from RSS (lower RSS = better fit = higher weight)
        rss_min = np.min(rss_values)
        temp = max(rss_min * 0.3, 1.0) + 1e-10
        log_w = -(rss_values - rss_min) / temp
        log_w = np.clip(log_w, -50, 0)
        weights = np.exp(log_w)
        weights /= weights.sum()

        # Estimate noise from best-fit residuals
        best_idx = np.argmin(rss_values)
        best_shape_at = np.interp(alpha_smooth, model['alpha_grid'],
                                  shapes[best_idx])
        best_res = values_observed - D_fits[best_idx] * best_shape_at[:cutoff_idx]
        noise_est = np.sqrt(np.mean(best_res ** 2))

        signal_at_cutoff = max(np.mean(values_observed[-10:]) if cutoff_idx > 10
                               else np.max(values_observed), 1.0)
        noise_ratio = noise_est / signal_at_cutoff

        # Blend selected shape with median at high noise
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

        # Bayesian D posterior
        pp = 1.0 / max(D_prior_std ** 2, 1e-10)
        lp = 1.0 / max(D_mle_var, 1e-10)
        D_post = (pp * D_prior + lp * D_mle) / (pp + lp)

        predicted = D_post * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict
