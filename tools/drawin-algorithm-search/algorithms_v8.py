"""
Draw-in prediction - Version 8 (PCA Shape Correction).

Key insight: shape variation from k_m/k_c is ~1D (captured by PC1).
Project observed residual onto PC1 to estimate shape correction.
SNR for PC projection is much higher than RSS-based shape selection.
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


def pca_shape_factory(train_data: Dict, params) -> callable:
    """
    1. Compute mean shape and PCA of shape variation from training
    2. For test: fit D and PC coefficients from observed data
    3. Reconstruct shape: mean + sum(c_i * PC_i)
    4. Bayesian D estimation
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

        # Mean shape
        mean_shape = np.mean(all_shapes, axis=0)
        mean_shape[0] = 0.0

        # PCA of shape deviations
        deviations = all_shapes - mean_shape[np.newaxis, :]
        if len(deviations) > 2:
            U, S, Vt = np.linalg.svd(deviations, full_matrices=False)
            # Keep top-K PCs (usually 1-3 explain most variance)
            n_pc = min(3, len(S))
            pcs = Vt[:n_pc]  # (n_pc, N_PTS)
            pc_stds = S[:n_pc] / np.sqrt(len(strokes) - 1)
        else:
            pcs = np.zeros((1, N_PTS))
            pc_stds = np.array([1.0])
            n_pc = 0

        # Ensure mean shape is valid
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
        alpha_smooth = _smooth_alpha(alpha_full, window=31)

        avg_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['D_ratio_mean'] * avg_di
        D_prior_std = model['D_ratio_std'] * avg_di

        # Get shapes at test alpha
        mean_at_alpha = np.interp(alpha_smooth, model['alpha_grid'],
                                  model['mean_shape'])
        pcs_at_alpha = np.array([
            np.interp(alpha_smooth, model['alpha_grid'], pc)
            for pc in model['pcs']
        ])  # (n_pc, N_PTS)

        n_pc = model['n_pc']

        # Extract observed portion
        mean_obs = mean_at_alpha[:cutoff_idx]

        if n_pc > 0 and cutoff_idx > 10:
            pcs_obs = pcs_at_alpha[:, :cutoff_idx]  # (n_pc, cutoff_idx)

            # Joint fit: y_obs = D * (mean + sum(c_i * pc_i))
            # Rearrange: y_obs = D*mean + D*c1*pc1 + D*c2*pc2 + ...
            # With D ≈ D_prior, linearize: y_obs ≈ D*(mean + sum(c_i*pc_i))
            # Fit D and c_i jointly

            # Build design matrix: columns are mean_obs, pc1_obs, pc2_obs, ...
            # Model: y = D * mean + D * c1 * pc1 + D * c2 * pc2
            # Let x = [D, D*c1, D*c2, ...], columns = [mean, pc1, pc2, ...]

            X = np.column_stack([mean_obs] + [pcs_obs[i] for i in range(n_pc)])
            # Ridge regression with prior on coefficients
            # Prior: D ≈ D_prior, c_i ≈ 0 (shape close to mean)
            n_params = 1 + n_pc
            # Regularization: D toward D_prior, c_i toward 0
            reg_weights = np.zeros(n_params)
            reg_weights[0] = 1.0 / max(D_prior_std ** 2, 0.01)
            for i in range(n_pc):
                # Prior on D*c_i: std ≈ D_prior * pc_std_i
                pc_prior_std = D_prior * model['pc_stds'][i] / max(np.sqrt(len(model['pcs'])), 1)
                reg_weights[1 + i] = 1.0 / max(pc_prior_std ** 2, 0.01)

            # Weighted least squares + ridge
            XtX = X.T @ X + np.diag(reg_weights)
            prior_target = np.zeros(n_params)
            prior_target[0] = D_prior
            Xty = X.T @ values_observed + reg_weights * prior_target

            try:
                coeffs = np.linalg.solve(XtX, Xty)
            except np.linalg.LinAlgError:
                coeffs = np.zeros(n_params)
                coeffs[0] = D_prior

            D_fit = coeffs[0]
            dc_fits = coeffs[1:]  # D*c_i values
            c_fits = dc_fits / max(D_fit, 1.0)

            # Clamp c values to reasonable range
            for i in range(n_pc):
                max_c = 3.0 * model['pc_stds'][i]
                c_fits[i] = np.clip(c_fits[i], -max_c, max_c)

            # Reconstruct shape
            shape_corrected = mean_at_alpha + sum(
                c_fits[i] * pcs_at_alpha[i] for i in range(n_pc))

        else:
            shape_corrected = mean_at_alpha
            D_fit = D_prior

        # Ensure shape is valid
        shape_corrected = np.clip(shape_corrected, 0, 1.5)

        # Refine D using the corrected shape
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

        # Bayesian D
        pp = 1.0 / max(D_prior_std ** 2, 1e-10)
        lp = 1.0 / max(D_mle_var, 1e-10)
        D_post = (pp * D_prior + lp * D_mle) / (pp + lp)

        predicted = D_post * shape_corrected

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]
        return output

    return predict


ALGORITHMS_V8 = {
    'pca_shape': pca_shape_factory,
}
