"""
Draw-in prediction - Version 9 (Corner-K + Denoised Shape Selection).

Key ideas:
1. Estimate steepness k from corner curves to pre-filter training shapes
2. Denoise observed middle sensor before shape scoring
3. Adaptive blend: low noise → observation-based shape, high noise → corner-k-based
4. Robust D estimation with IRLS
"""

import numpy as np
from scipy.signal import savgol_filter
from scipy.optimize import minimize_scalar
from typing import Dict
from data_model import N_PTS, SAME_SIDE_CORNERS, s_curve


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


def _denoise_values(values, window=21):
    """Savgol-smooth observed values to reduce noise for shape scoring."""
    n = len(values)
    w = min(window, n // 2 * 2 - 1)
    w = max(w, 5)
    if w % 2 == 0:
        w += 1
    return savgol_filter(values, w, 3)


def _estimate_k_from_curve(values, D, n_pts):
    """Estimate steepness k from a complete S-curve.

    Fits s_curve(alpha_uniform, D_est, k) to the observed values.
    Uses the mid-region (20-80%) where k has most effect.
    """
    alpha_uniform = np.linspace(0, 1, n_pts)
    # Normalize
    norm = values / max(D, 1.0)
    # Focus on mid-region
    mid = (alpha_uniform > 0.15) & (alpha_uniform < 0.85)
    if np.sum(mid) < 10:
        return 12.0  # default

    def objective(k):
        predicted = s_curve(alpha_uniform, 1.0, k) if k > 0 else alpha_uniform
        return np.sum((norm[mid] - predicted[mid]) ** 2)

    result = minimize_scalar(objective, bounds=(2, 40), method='bounded')
    return result.x


def corner_k_shape_factory(train_data: Dict, params) -> callable:
    """
    1. For each training stroke, estimate k from corner curves
    2. Store training shapes indexed by estimated corner k
    3. At test time: estimate k from corners, weight shapes by k-similarity
    4. Also score shapes by fit to denoised observed data
    5. Blend k-based and observation-based weights by noise level
    """

    alpha_grid = np.linspace(0, 1, N_PTS)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        all_shapes = []
        D_ratios = []
        corner_k_estimates = []

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

            # Estimate k from corner curves
            k_estimates = []
            for c in corners:
                k_est = _estimate_k_from_curve(
                    s['corner_curves'][c], s['corner_dis'][c], N_PTS)
                k_estimates.append(k_est)
            corner_k_estimates.append(np.mean(k_estimates))

        all_shapes = np.array(all_shapes)
        D_ratios = np.array(D_ratios)
        corner_k_estimates = np.array(corner_k_estimates)

        # Median shape as fallback
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
            'corner_k': corner_k_estimates,
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

        # 1. Estimate k from test corner curves
        test_k_estimates = []
        for c in corners:
            k_est = _estimate_k_from_curve(corner_curves[c], corner_dis[c], N_PTS)
            test_k_estimates.append(k_est)
        test_k = np.mean(test_k_estimates)

        # 2. K-based weights (from corner similarity)
        k_diffs = np.abs(model['corner_k'] - test_k)
        k_std = max(np.std(model['corner_k']), 0.5)
        k_weights = np.exp(-0.5 * (k_diffs / k_std) ** 2)
        k_weights /= k_weights.sum()

        # 3. Observation-based weights (RSS on denoised data)
        D_fits = np.zeros(n_shapes)
        rss_values = np.zeros(n_shapes)

        # Denoise observed values for better shape scoring
        if cutoff_idx > 10:
            values_smooth = _denoise_values(values_observed)
        else:
            values_smooth = values_observed

        for i in range(n_shapes):
            shape_at = np.interp(alpha_smooth, model['alpha_grid'], shapes[i])
            so = shape_at[:cutoff_idx]
            ss = np.sum(so ** 2)
            if ss > 1e-10:
                D_fits[i] = np.sum(values_smooth * so) / ss
                rss_values[i] = np.sum((values_smooth - D_fits[i] * so) ** 2)
            else:
                D_fits[i] = D_prior
                rss_values[i] = 1e10

        rss_min = np.min(rss_values)
        temp = max(rss_min * 0.3, 1.0) + 1e-10
        log_w = -(rss_values - rss_min) / temp
        log_w = np.clip(log_w, -50, 0)
        obs_weights = np.exp(log_w)
        obs_weights /= obs_weights.sum()

        # 4. Estimate noise level
        best_idx = np.argmin(rss_values)
        best_shape_at = np.interp(alpha_smooth, model['alpha_grid'],
                                  shapes[best_idx])
        best_res = values_observed - D_fits[best_idx] * best_shape_at[:cutoff_idx]
        noise_est = np.sqrt(np.mean(best_res ** 2))
        signal_at_cutoff = max(np.mean(values_observed[-10:]) if cutoff_idx > 10
                               else np.max(values_observed), 1.0)
        noise_ratio = noise_est / signal_at_cutoff

        # 5. Blend: high noise → more k-based, low noise → more observation-based
        # noise_ratio < 0.05 → fully observation-based
        # noise_ratio > 0.3 → mostly k-based
        k_blend = np.clip((noise_ratio - 0.05) / 0.25, 0.0, 0.8)
        combined_weights = (1 - k_blend) * obs_weights + k_blend * k_weights
        combined_weights /= combined_weights.sum()

        # 6. Weighted shape
        selected_shape = np.average(shapes, weights=combined_weights, axis=0)

        # Also blend with median for robustness at very high noise
        median_weight = np.clip(noise_ratio * 3.0, 0.0, 0.5)
        blended_shape = (1 - median_weight) * selected_shape + \
                        median_weight * model['med_shape']
        shape_full = np.interp(alpha_smooth, model['alpha_grid'], blended_shape)

        # 7. D estimation with IRLS
        D_mle = np.average(D_fits, weights=combined_weights)
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

        pp = 1.0 / max(D_prior_std ** 2, 1e-10)
        lp = 1.0 / max(D_mle_var, 1e-10)
        D_post = (pp * D_prior + lp * D_mle) / (pp + lp)

        predicted = D_post * shape_full

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


def denoised_pca_factory(train_data: Dict, params) -> callable:
    """
    V8-style PCA but with denoised observations for fitting.
    Also uses larger Savgol window for alpha smoothing at high noise.
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

        mean_shape = np.mean(all_shapes, axis=0)
        mean_shape[0] = 0.0

        # PCA
        deviations = all_shapes - mean_shape[np.newaxis, :]
        if len(deviations) > 2:
            U, S, Vt = np.linalg.svd(deviations, full_matrices=False)
            n_pc = min(3, len(S))
            pcs = Vt[:n_pc]
            pc_stds = S[:n_pc] / np.sqrt(len(strokes) - 1)
        else:
            pcs = np.zeros((1, N_PTS))
            pc_stds = np.array([1.0])
            n_pc = 0

        mean_shape_clean = mean_shape.copy()
        mean_shape_clean[0] = 0.0
        mean_shape_clean[-1] = np.mean([s[-1] for s in all_shapes])
        mean_shape_clean = np.maximum.accumulate(mean_shape_clean)
        if mean_shape_clean[-1] > 0:
            mean_shape_clean /= mean_shape_clean[-1]

        sensor_models[ms_name] = {
            'mean_shape': mean_shape_clean,
            'pcs': pcs,
            'pc_stds': pc_stds,
            'n_pc': n_pc,
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
        alpha_smooth = _smooth_alpha(alpha_full, window=41)

        avg_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_di
        D_prior_std = model['D_ratio_std'] * avg_di

        mean_at_alpha = np.interp(alpha_smooth, model['alpha_grid'],
                                  model['mean_shape'])
        pcs_at_alpha = np.array([
            np.interp(alpha_smooth, model['alpha_grid'], pc)
            for pc in model['pcs']
        ])

        n_pc = model['n_pc']

        # Denoise observed values
        if cutoff_idx > 15:
            values_fit = _denoise_values(values_observed, window=31)
        else:
            values_fit = values_observed

        mean_obs = mean_at_alpha[:cutoff_idx]

        if n_pc > 0 and cutoff_idx > 10:
            pcs_obs = pcs_at_alpha[:, :cutoff_idx]

            X = np.column_stack([mean_obs] + [pcs_obs[i] for i in range(n_pc)])
            n_params = 1 + n_pc
            reg_weights = np.zeros(n_params)
            reg_weights[0] = 1.0 / max(D_prior_std ** 2, 0.01)
            for i in range(n_pc):
                pc_prior_std = D_prior * model['pc_stds'][i] / max(np.sqrt(len(model['pcs'])), 1)
                reg_weights[1 + i] = 1.0 / max(pc_prior_std ** 2, 0.01)

            # Use denoised values for PCA fit
            XtX = X.T @ X + np.diag(reg_weights)
            prior_target = np.zeros(n_params)
            prior_target[0] = D_prior
            Xty = X.T @ values_fit + reg_weights * prior_target

            try:
                coeffs = np.linalg.solve(XtX, Xty)
            except np.linalg.LinAlgError:
                coeffs = np.zeros(n_params)
                coeffs[0] = D_prior

            D_fit = coeffs[0]
            dc_fits = coeffs[1:]
            c_fits = dc_fits / max(D_fit, 1.0)

            for i in range(n_pc):
                max_c = 3.0 * model['pc_stds'][i]
                c_fits[i] = np.clip(c_fits[i], -max_c, max_c)

            shape_corrected = mean_at_alpha + sum(
                c_fits[i] * pcs_at_alpha[i] for i in range(n_pc))
        else:
            shape_corrected = mean_at_alpha
            D_fit = D_prior

        shape_corrected = np.clip(shape_corrected, 0, 1.5)

        # Refine D using corrected shape on ORIGINAL (not denoised) values
        shape_obs = shape_corrected[:cutoff_idx]
        ss = np.sum(shape_obs ** 2)
        if ss > 1e-10 and cutoff_idx > 5:
            D_mle = np.sum(values_observed * shape_obs) / ss
            res = values_observed - D_mle * shape_obs
            nv = np.mean(res ** 2)
            D_mle_var = nv / max(ss, 1e-10)
        else:
            D_mle = D_prior
            D_mle_var = D_prior_std ** 2 * 100

        pp = 1.0 / max(D_prior_std ** 2, 1e-10)
        lp = 1.0 / max(D_mle_var, 1e-10)
        D_post = (pp * D_prior + lp * D_mle) / (pp + lp)

        predicted = D_post * shape_corrected

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


def ultimate_v9_factory(train_data: Dict, params) -> callable:
    """
    Best combination: corner-k weighted shape selection + PCA refinement +
    denoised observations + IRLS D estimation.
    """
    alpha_grid = np.linspace(0, 1, N_PTS)
    sensor_models = {}

    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        corners = SAME_SIDE_CORNERS[ms_name]

        all_shapes = []
        D_ratios = []
        corner_k_estimates = []

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

            # Estimate k from corners
            k_ests = []
            for c in corners:
                k_ests.append(_estimate_k_from_curve(
                    s['corner_curves'][c], s['corner_dis'][c], N_PTS))
            corner_k_estimates.append(np.mean(k_ests))

        all_shapes = np.array(all_shapes)
        D_ratios = np.array(D_ratios)
        corner_k_estimates = np.array(corner_k_estimates)

        # Mean and PCA
        mean_shape = np.mean(all_shapes, axis=0)
        mean_shape[0] = 0.0
        deviations = all_shapes - mean_shape[np.newaxis, :]
        if len(deviations) > 2:
            U, S, Vt = np.linalg.svd(deviations, full_matrices=False)
            n_pc = min(2, len(S))
            pcs = Vt[:n_pc]
            pc_stds = S[:n_pc] / np.sqrt(len(strokes) - 1)
        else:
            pcs = np.zeros((1, N_PTS))
            pc_stds = np.array([1.0])
            n_pc = 0

        # Clean mean shape
        mean_shape_clean = mean_shape.copy()
        mean_shape_clean[0] = 0.0
        mean_shape_clean[-1] = np.mean([s[-1] for s in all_shapes])
        mean_shape_clean = np.maximum.accumulate(mean_shape_clean)
        if mean_shape_clean[-1] > 0:
            mean_shape_clean /= mean_shape_clean[-1]

        # Median shape
        med_shape = np.median(all_shapes, axis=0)
        med_shape[0] = 0.0
        med_shape[-1] = 1.0
        med_shape = np.maximum.accumulate(med_shape)
        if med_shape[-1] > 0:
            med_shape /= med_shape[-1]

        sensor_models[ms_name] = {
            'all_shapes': all_shapes,
            'mean_shape': mean_shape_clean,
            'med_shape': med_shape,
            'pcs': pcs,
            'pc_stds': pc_stds,
            'n_pc': n_pc,
            'alpha_grid': alpha_grid,
            'D_ratio_mean': float(np.mean(D_ratios)),
            'D_ratio_std': float(max(np.std(D_ratios), 0.005)),
            'corner_k': corner_k_estimates,
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

        # Estimate test k from corners
        test_k_ests = []
        for c in corners:
            test_k_ests.append(_estimate_k_from_curve(
                corner_curves[c], corner_dis[c], N_PTS))
        test_k = np.mean(test_k_ests)

        # K-based weights
        k_diffs = np.abs(model['corner_k'] - test_k)
        k_std = max(np.std(model['corner_k']), 0.5)
        k_weights = np.exp(-0.5 * (k_diffs / k_std) ** 2)
        k_weights /= k_weights.sum()

        # Observation-based weights with denoised values
        D_fits = np.zeros(n_shapes)
        rss_values = np.zeros(n_shapes)

        if cutoff_idx > 10:
            values_smooth = _denoise_values(values_observed)
        else:
            values_smooth = values_observed

        for i in range(n_shapes):
            shape_at = np.interp(alpha_smooth, model['alpha_grid'], shapes[i])
            so = shape_at[:cutoff_idx]
            ss = np.sum(so ** 2)
            if ss > 1e-10:
                D_fits[i] = np.sum(values_smooth * so) / ss
                rss_values[i] = np.sum((values_smooth - D_fits[i] * so) ** 2)
            else:
                D_fits[i] = D_prior
                rss_values[i] = 1e10

        rss_min = np.min(rss_values)
        temp = max(rss_min * 0.3, 1.0) + 1e-10
        log_w = -(rss_values - rss_min) / temp
        log_w = np.clip(log_w, -50, 0)
        obs_weights = np.exp(log_w)
        obs_weights /= obs_weights.sum()

        # Noise estimation
        best_idx = np.argmin(rss_values)
        best_shape_at = np.interp(alpha_smooth, model['alpha_grid'],
                                  shapes[best_idx])
        best_res = values_observed - D_fits[best_idx] * best_shape_at[:cutoff_idx]
        noise_est = np.sqrt(np.mean(best_res ** 2))
        signal_at_cutoff = max(np.mean(values_observed[-10:]) if cutoff_idx > 10
                               else np.max(values_observed), 1.0)
        noise_ratio = noise_est / signal_at_cutoff

        # Blend weights based on noise
        k_blend = np.clip((noise_ratio - 0.03) / 0.20, 0.0, 0.7)
        combined_weights = (1 - k_blend) * obs_weights + k_blend * k_weights
        combined_weights /= combined_weights.sum()

        # Weighted shape
        selected_shape = np.average(shapes, weights=combined_weights, axis=0)

        # PCA refinement on top of selected shape
        n_pc = model['n_pc']
        if n_pc > 0 and cutoff_idx > 15 and noise_ratio < 0.2:
            # Low noise: use PCA to refine the selected shape
            mean_at_alpha = np.interp(alpha_smooth, model['alpha_grid'],
                                      model['mean_shape'])
            pcs_at_alpha = np.array([
                np.interp(alpha_smooth, model['alpha_grid'], pc)
                for pc in model['pcs']
            ])

            # Fit PCA coefficients to explain residual from selected shape
            sel_at_alpha = np.interp(alpha_smooth, model['alpha_grid'],
                                     selected_shape)
            residual = values_smooth[:cutoff_idx] - D_prior * sel_at_alpha[:cutoff_idx]
            for i in range(n_pc):
                pc_obs = pcs_at_alpha[i, :cutoff_idx]
                pc_ss = np.sum(pc_obs ** 2)
                if pc_ss > 1e-10:
                    c_i = np.sum(residual * pc_obs) / (D_prior * pc_ss)
                    c_i = np.clip(c_i, -2 * model['pc_stds'][i],
                                  2 * model['pc_stds'][i])
                    selected_shape = selected_shape + c_i * model['pcs'][i]

        # Blend with median at very high noise
        median_weight = np.clip(noise_ratio * 2.5, 0.0, 0.4)
        blended_shape = (1 - median_weight) * selected_shape + \
                        median_weight * model['med_shape']
        shape_full = np.interp(alpha_smooth, model['alpha_grid'], blended_shape)

        # IRLS D estimation
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


ALGORITHMS_V9 = {
    'corner_k_shape': corner_k_shape_factory,
    'denoised_pca': denoised_pca_factory,
    'ultimate_v9': ultimate_v9_factory,
}
