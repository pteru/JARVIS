"""
Draw-in prediction algorithms.

Each algorithm is implemented as a factory function that takes training data
and returns a predictor callable.
"""

import numpy as np
from scipy.optimize import minimize, curve_fit
from scipy.interpolate import interp1d
from typing import Dict, List, Any, Optional
from data_model import N_PTS, s_curve, SAME_SIDE_CORNERS


# =============================================================================
# Algorithm 1: Parametric Sigmoid Fit with D/gamma correction (Baseline)
# =============================================================================

def sigmoid_fit_factory(train_data: Dict, params) -> callable:
    """Fit sigmoid model to training data, predict with D/gamma correction."""

    # For each middle sensor, learn average parameters from training
    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue

        # Collect fitted parameters from training strokes
        Ds = []
        ks = []
        for s in strokes:
            Ds.append(s['total_di'])
            ks.append(s['steep'])

        # Also fit s-curve to each training stroke to get empirical params
        fitted_params = []
        for s in strokes:
            alpha = s['alpha']
            values = s['values']
            try:
                D_init = values[-1] if values[-1] > 0 else s['total_di']
                k_init = s['steep']
                popt, _ = curve_fit(
                    lambda a, D, k: s_curve(a, D, k),
                    alpha, values,
                    p0=[D_init, k_init],
                    bounds=([0, 1], [500, 50]),
                    maxfev=2000
                )
                fitted_params.append(popt)
            except Exception:
                fitted_params.append([np.mean(Ds), np.mean(ks)])

        fitted_params = np.array(fitted_params)

        sensor_models[ms_name] = {
            'D_mean': np.mean(fitted_params[:, 0]),
            'D_std': max(np.std(fitted_params[:, 0]), 0.1),
            'k_mean': np.mean(fitted_params[:, 1]),
            'k_std': max(np.std(fitted_params[:, 1]), 0.1),
            'fitted_params': fitted_params,
            'train_strokes': strokes,
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            # Fallback: just extend last value
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            pred[cutoff_idx:] = values_observed[-1] if len(values_observed) > 0 else 0
            return pred

        D_prior = model['D_mean']
        k_prior = model['k_mean']

        # Fit D and k to observed portion with regularization toward prior
        def objective(x):
            D, k = x
            pred = s_curve(alpha_observed, D, k)
            data_fit = np.sum((pred - values_observed) ** 2)
            # Regularization toward prior
            reg_D = ((D - D_prior) / model['D_std']) ** 2
            reg_k = ((k - k_prior) / model['k_std']) ** 2
            return data_fit + 0.1 * reg_D + 0.5 * reg_k

        result = minimize(objective, [D_prior, k_prior],
                         bounds=[(1, 500), (1, 50)],
                         method='L-BFGS-B')
        D_fit, k_fit = result.x

        # Generate full prediction
        predicted = s_curve(alpha_full, D_fit, k_fit)

        # Splice: actual data up to cutoff, predicted after
        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]

        return output

    return predict


# =============================================================================
# Algorithm 2: Template Matching + Deformation
# =============================================================================

def template_matching_factory(train_data: Dict, params) -> callable:
    """Match test stroke to best training template, then warp."""

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue
        sensor_models[ms_name] = {
            'train_strokes': strokes,
        }

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            pred[cutoff_idx:] = values_observed[-1]
            return pred

        strokes = model['train_strokes']

        # Find best matching template based on corner sensor similarity
        best_score = np.inf
        best_idx = 0
        corners = SAME_SIDE_CORNERS[ms_name]

        for i, s in enumerate(strokes):
            score = 0
            for c in corners:
                if c in corner_curves and c in s['corner_curves']:
                    diff = corner_curves[c] - s['corner_curves'][c]
                    # Normalize by corner DI
                    norm = max(corner_dis.get(c, 1.0), 0.1)
                    score += np.sum((diff / norm) ** 2)
            if score < best_score:
                best_score = score
                best_idx = i

        template = strokes[best_idx]

        # Scale template to match observed portion
        # Find scale factor D_ratio
        template_at_cutoff = template['values'][:cutoff_idx]
        if len(template_at_cutoff) > 0 and np.max(template_at_cutoff) > 0:
            # Weighted least squares fit: values_observed ≈ scale * template_at_cutoff
            w = np.linspace(0.5, 1.5, cutoff_idx)  # weight later points more
            scale = np.sum(w * values_observed * template_at_cutoff) / \
                    max(np.sum(w * template_at_cutoff ** 2), 1e-10)
        else:
            scale = 1.0

        # Also fit a warp parameter: alpha -> alpha^gamma
        # Try a few gamma values and pick best
        best_gamma = 1.0
        best_fit_err = np.inf
        for gamma in np.linspace(0.7, 1.4, 15):
            warped_alpha = alpha_observed ** gamma
            # Interpolate template at warped alpha positions
            template_interp = np.interp(warped_alpha, template['alpha'], template['values'])
            err = np.sum((values_observed - scale * template_interp) ** 2)
            if err < best_fit_err:
                best_fit_err = err
                best_gamma = gamma

        # Generate prediction using best template + scale + warp
        warped_full = alpha_full ** best_gamma
        predicted = scale * np.interp(warped_full, template['alpha'], template['values'])

        # Splice
        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]

        return output

    return predict


# =============================================================================
# Algorithm 3: Bayesian Sigmoid with Corner-Informed Prior
# =============================================================================

def bayesian_sigmoid_factory(train_data: Dict, params) -> callable:
    """
    Fit sigmoid with strong Bayesian prior from training data.
    Use corner sensors to estimate D (amplitude) and gamma (shape warp).
    """

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue

        # Learn the relationship between corner DI and middle DI
        corner_dis_list = []
        middle_dis_list = []
        ks_list = []

        corners = SAME_SIDE_CORNERS[ms_name]

        for s in strokes:
            avg_corner_di = np.mean([s['corner_dis'][c] for c in corners])
            corner_dis_list.append(avg_corner_di)
            middle_dis_list.append(s['total_di'])
            ks_list.append(s['steep'])

        corner_dis_arr = np.array(corner_dis_list)
        middle_dis_arr = np.array(middle_dis_list)
        ks_arr = np.array(ks_list)

        # Linear regression: middle_DI = a * corner_DI + b
        if len(corner_dis_arr) > 1 and np.std(corner_dis_arr) > 1e-6:
            A = np.vstack([corner_dis_arr, np.ones(len(corner_dis_arr))]).T
            coef, _, _, _ = np.linalg.lstsq(A, middle_dis_arr, rcond=None)
            di_slope, di_intercept = coef
        else:
            di_slope = 0
            di_intercept = np.mean(middle_dis_arr)

        # Learn the relationship between corner gamma and middle gamma
        # (gamma derived from comparing alpha to normalized curve shape)

        sensor_models[ms_name] = {
            'di_slope': di_slope,
            'di_intercept': di_intercept,
            'D_mean': np.mean(middle_dis_arr),
            'D_std': max(np.std(middle_dis_arr), 0.5),
            'k_mean': np.mean(ks_arr),
            'k_std': max(np.std(ks_arr), 0.1),
            'train_strokes': strokes,
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

        # Estimate D from corner DI
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_from_corner = model['di_slope'] * avg_corner_di + model['di_intercept']

        # Use corner-estimated D as prior mean, but with tighter variance
        D_prior = D_from_corner
        D_prior_std = model['D_std']
        k_prior = model['k_mean']
        k_prior_std = model['k_std']

        # Fit D and k with Bayesian regularization
        def objective(x):
            D, k = x
            pred = s_curve(alpha_observed, D, k)
            # Data likelihood (sum of squared errors)
            data_fit = np.sum((pred - values_observed) ** 2)
            # Prior regularization
            reg_D = ((D - D_prior) / D_prior_std) ** 2
            reg_k = ((k - k_prior) / k_prior_std) ** 2

            # Weight regularization more when we have less data
            # (early cutoff → more prior influence)
            prior_weight = max(0.5, (N_PTS - cutoff_idx) / N_PTS * 5.0)

            return data_fit + prior_weight * (reg_D + reg_k)

        result = minimize(objective, [D_prior, k_prior],
                         bounds=[(D_prior * 0.5, D_prior * 2.0), (1, 50)],
                         method='L-BFGS-B')
        D_fit, k_fit = result.x

        predicted = s_curve(alpha_full, D_fit, k_fit)

        # Splice
        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]

        return output

    return predict


# =============================================================================
# Algorithm 4: Ensemble Weighted by Visible Fit
# =============================================================================

def ensemble_factory(train_data: Dict, params) -> callable:
    """Ensemble of sigmoid, template, and Bayesian - weighted by fit quality."""

    # Build sub-predictors
    sig_pred = sigmoid_fit_factory(train_data, params)
    tmpl_pred = template_matching_factory(train_data, params)
    bayes_pred = bayesian_sigmoid_factory(train_data, params)

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        kw = dict(ms_name=ms_name, alpha_observed=alpha_observed,
                  values_observed=values_observed, cutoff_idx=cutoff_idx,
                  alpha_full=alpha_full, corner_curves=corner_curves,
                  corner_dis=corner_dis)

        pred_sig = sig_pred(**kw)
        pred_tmpl = tmpl_pred(**kw)
        pred_bayes = bayes_pred(**kw)

        preds = [pred_sig, pred_tmpl, pred_bayes]

        # Score each on the visible portion
        weights = []
        for p in preds:
            err = np.sum((p[:cutoff_idx] - values_observed) ** 2)
            weights.append(1.0 / (err + 1e-6))

        weights = np.array(weights)
        weights /= weights.sum()

        output = sum(w * p for w, p in zip(weights, preds))
        # Force splice
        output[:cutoff_idx] = values_observed

        return output

    return predict


# =============================================================================
# Algorithm 5: Multi-Template Weighted Average
# =============================================================================

def multi_template_factory(train_data: Dict, params) -> callable:
    """
    Use ALL training templates weighted by similarity, with proper
    alpha-to-alpha mapping via sigmoid parameterization.
    """

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue

        # For each training stroke, fit sigmoid to get clean D, k
        fitted = []
        for s in strokes:
            try:
                popt, _ = curve_fit(
                    lambda a, D, k: s_curve(a, D, k),
                    s['alpha'], s['values'],
                    p0=[s['total_di'], s['steep']],
                    bounds=([0, 1], [500, 50]),
                    maxfev=2000
                )
                fitted.append({'D': popt[0], 'k': popt[1], 'stroke': s})
            except Exception:
                fitted.append({'D': s['total_di'], 'k': s['steep'], 'stroke': s})

        sensor_models[ms_name] = {'fitted': fitted, 'strokes': strokes}

    def predict(ms_name, alpha_observed, values_observed, cutoff_idx,
                alpha_full, corner_curves, corner_dis, **kwargs):
        model = sensor_models.get(ms_name)
        if model is None:
            pred = np.zeros(N_PTS)
            pred[:cutoff_idx] = values_observed
            pred[cutoff_idx:] = values_observed[-1]
            return pred

        fitted = model['fitted']
        corners = SAME_SIDE_CORNERS[ms_name]

        # Score each training stroke by corner similarity + observed data fit
        weighted_preds = []
        weights = []

        for f in fitted:
            s = f['stroke']

            # Corner similarity score
            corner_score = 0
            for c in corners:
                if c in corner_curves and c in s['corner_curves']:
                    diff = corner_curves[c] - s['corner_curves'][c]
                    norm = max(corner_dis.get(c, 1.0), 0.1)
                    corner_score += np.mean((diff / norm) ** 2)

            # Scale the template
            template_obs = np.interp(alpha_observed,
                                     s['alpha'], s['values'])
            if np.sum(template_obs ** 2) > 1e-10:
                scale = np.sum(values_observed * template_obs) / np.sum(template_obs ** 2)
            else:
                scale = 1.0
            scale = np.clip(scale, 0.5, 2.0)

            # Generate full prediction
            predicted = scale * np.interp(alpha_full, s['alpha'], s['values'])

            # Compute visible fit error
            vis_err = np.mean((predicted[:cutoff_idx] - values_observed) ** 2)

            weight = 1.0 / (corner_score + vis_err + 1e-6)
            weighted_preds.append(predicted)
            weights.append(weight)

        weights = np.array(weights)
        weights /= weights.sum()

        output = sum(w * p for w, p in zip(weights, weighted_preds))
        output[:cutoff_idx] = values_observed

        return output

    return predict


# =============================================================================
# Algorithm 6: Hierarchical Corner-to-Middle with Gamma Correction
# =============================================================================

def hierarchical_factory(train_data: Dict, params) -> callable:
    """
    Two-level approach:
    1. Use corner sensors to estimate stroke characteristics (D, gamma)
    2. Use parametric model conditioned on those estimates

    Key insight: the corner sensors complete fully, so we can extract
    the stroke's speed/steepness profile from them.
    """

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue

        corners = SAME_SIDE_CORNERS[ms_name]

        # For each training stroke, compute:
        # - Corner DI ratio (actual/nominal)
        # - Middle DI ratio
        # - Effective steepness (from sigmoid fit)
        training_features = []
        for s in strokes:
            # Corner features
            corner_di_ratio = np.mean([
                s['corner_dis'][c] / max(np.max(s['corner_curves'][c]), 0.01)
                for c in corners
            ])

            # Fit sigmoid to corner to get effective steepness
            avg_corner = np.mean([
                s['corner_curves'][c] / s['corner_dis'][c]
                for c in corners
            ], axis=0)

            try:
                popt, _ = curve_fit(
                    lambda a, k: s_curve(a, 1.0, k),
                    s['alpha'], avg_corner,
                    p0=[s['steep']],
                    bounds=([1], [50]),
                    maxfev=1000
                )
                corner_k = popt[0]
            except Exception:
                corner_k = s['steep']

            training_features.append({
                'corner_di_ratio': corner_di_ratio,
                'corner_k': corner_k,
                'middle_D': s['total_di'],
                'middle_k': s['steep'],
                'alpha': s['alpha'],
                'values': s['values'],
                'corner_curves': s['corner_curves'],
                'corner_dis': s['corner_dis'],
            })

        # Learn corner_k -> middle_k relationship
        corner_ks = np.array([f['corner_k'] for f in training_features])
        middle_ks = np.array([f['middle_k'] for f in training_features])
        middle_Ds = np.array([f['middle_D'] for f in training_features])

        # Simple linear regression for k mapping
        if len(corner_ks) > 1 and np.std(corner_ks) > 0.01:
            A = np.vstack([corner_ks, np.ones(len(corner_ks))]).T
            k_coef, _, _, _ = np.linalg.lstsq(A, middle_ks, rcond=None)
        else:
            k_coef = [1.0, 0.0]

        # Corner DI -> Middle DI
        corner_avg_dis = np.array([
            np.mean([f['corner_dis'][c] for c in corners])
            for f in training_features
        ])
        if len(corner_avg_dis) > 1 and np.std(corner_avg_dis) > 0.01:
            A = np.vstack([corner_avg_dis, np.ones(len(corner_avg_dis))]).T
            d_coef, _, _, _ = np.linalg.lstsq(A, middle_Ds, rcond=None)
        else:
            d_coef = [0.0, np.mean(middle_Ds)]

        sensor_models[ms_name] = {
            'k_coef': k_coef,
            'd_coef': d_coef,
            'D_mean': np.mean(middle_Ds),
            'D_std': max(np.std(middle_Ds), 0.5),
            'k_mean': np.mean(middle_ks),
            'k_std': max(np.std(middle_ks), 0.1),
            'training_features': training_features,
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

        # Level 1: Estimate stroke parameters from corner sensors
        avg_corner_di = np.mean([corner_dis[c] for c in corners])

        # Estimate middle D from corner DI
        D_from_corner = model['d_coef'][0] * avg_corner_di + model['d_coef'][1]

        # Estimate k from corner sensors
        avg_corner_norm = np.mean([
            corner_curves[c] / corner_dis[c]
            for c in corners
        ], axis=0)

        try:
            popt, _ = curve_fit(
                lambda a, k: s_curve(a, 1.0, k),
                alpha_full, avg_corner_norm,
                p0=[model['k_mean']],
                bounds=([1], [50]),
                maxfev=1000
            )
            test_corner_k = popt[0]
        except Exception:
            test_corner_k = model['k_mean']

        k_from_corner = model['k_coef'][0] * test_corner_k + model['k_coef'][1]

        # Level 2: Fit D and k to observed middle data with corner priors
        D_prior = D_from_corner
        k_prior = k_from_corner

        def objective(x):
            D, k = x
            pred = s_curve(alpha_observed, D, k)
            data_fit = np.sum((pred - values_observed) ** 2)
            reg_D = ((D - D_prior) / model['D_std']) ** 2
            reg_k = ((k - k_prior) / model['k_std']) ** 2
            # Scale regularization by fraction of curve seen
            frac_seen = cutoff_idx / N_PTS
            prior_weight = max(0.5, (1.0 - frac_seen) * 5.0)
            return data_fit + prior_weight * (reg_D + 2.0 * reg_k)

        result = minimize(objective, [D_prior, k_prior],
                         bounds=[(D_prior * 0.3, D_prior * 3.0), (1, 50)],
                         method='L-BFGS-B')
        D_fit, k_fit = result.x

        predicted = s_curve(alpha_full, D_fit, k_fit)

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]

        return output

    return predict


# =============================================================================
# Algorithm 7: Shape-Normalized Template Ensemble with Bayesian D Estimation
# =============================================================================

def shape_normalized_ensemble_factory(train_data: Dict, params) -> callable:
    """
    Key insight: Normalize all training curves to unit amplitude, creating
    shape templates. Then separately estimate amplitude D from:
    - Corner DI ratio (prior)
    - Observed data (likelihood)

    The shape (normalized curve) is predicted by weighted average of
    training shape templates, matched by corner similarity.
    The amplitude is predicted via Bayesian estimation.
    """

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue

        corners = SAME_SIDE_CORNERS[ms_name]

        # Normalize all training curves to [0, 1] amplitude
        shapes = []  # normalized curves
        Ds = []      # amplitudes
        corner_profiles = []  # normalized corner curves for matching

        for s in strokes:
            D = s['total_di']
            shape = s['values'] / D  # normalize to [0, 1]
            shapes.append(shape)
            Ds.append(D)

            # Normalized corner profile for matching
            cp = np.concatenate([
                s['corner_curves'][c] / s['corner_dis'][c]
                for c in corners
            ])
            corner_profiles.append(cp)

        shapes = np.array(shapes)
        Ds = np.array(Ds)
        corner_profiles = np.array(corner_profiles)

        # Corner DI -> Middle DI regression
        corner_avg_dis = np.array([
            np.mean([s['corner_dis'][c] for c in corners])
            for s in strokes
        ])

        if len(corner_avg_dis) > 1 and np.std(corner_avg_dis) > 0.01:
            A = np.vstack([corner_avg_dis, np.ones(len(corner_avg_dis))]).T
            d_coef, _, _, _ = np.linalg.lstsq(A, Ds, rcond=None)
        else:
            d_coef = [0.0, np.mean(Ds)]

        sensor_models[ms_name] = {
            'shapes': shapes,
            'Ds': Ds,
            'corner_profiles': corner_profiles,
            'd_coef': d_coef,
            'D_mean': np.mean(Ds),
            'D_std': max(np.std(Ds), 0.5),
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

        # 1. Estimate shape via weighted template average
        # Match by corner profile similarity
        test_corner_profile = np.concatenate([
            corner_curves[c] / corner_dis[c]
            for c in corners
        ])

        # Compute weights based on corner similarity
        diffs = model['corner_profiles'] - test_corner_profile[np.newaxis, :]
        distances = np.sqrt(np.mean(diffs ** 2, axis=1))

        # Softmax-like weighting with temperature
        temp = max(np.median(distances) * 0.5, 1e-6)
        weights = np.exp(-distances / temp)
        weights /= weights.sum()

        # Weighted average shape
        predicted_shape = np.average(model['shapes'], weights=weights, axis=0)

        # 2. Estimate D (amplitude)
        # Prior from corner regression
        avg_corner_di = np.mean([corner_dis[c] for c in corners])
        D_prior = model['d_coef'][0] * avg_corner_di + model['d_coef'][1]
        D_prior = max(D_prior, 1.0)

        # Likelihood from observed data: values = D * shape
        shape_obs = predicted_shape[:cutoff_idx]
        if np.sum(shape_obs ** 2) > 1e-10:
            # Weighted least squares for D
            w = np.linspace(0.5, 2.0, cutoff_idx)
            D_mle = np.sum(w * values_observed * shape_obs) / np.sum(w * shape_obs ** 2)
        else:
            D_mle = D_prior

        # Bayesian combination: posterior D
        # Weight prior more when less data is visible
        frac_seen = cutoff_idx / N_PTS
        prior_precision = 1.0 / model['D_std'] ** 2
        # Likelihood precision: inversely proportional to noise / frac_seen
        like_precision = frac_seen * cutoff_idx / max(model['D_std'] ** 2, 1.0)

        D_post = (prior_precision * D_prior + like_precision * D_mle) / \
                 (prior_precision + like_precision)

        # 3. Assemble full prediction
        predicted = D_post * predicted_shape

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]

        return output

    return predict


# =============================================================================
# Algorithm 8: Physics-Informed Shape + Residual Correction
# =============================================================================

def physics_residual_factory(train_data: Dict, params) -> callable:
    """
    Fit a sigmoid to get the base shape, then learn residual corrections
    from training data. The residual captures systematic deviations from
    the ideal sigmoid (e.g., due to friction, material, tooling effects).
    """

    sensor_models = {}
    for ms_name, strokes in train_data.items():
        if not strokes:
            continue

        corners = SAME_SIDE_CORNERS[ms_name]

        # Fit sigmoid to each training stroke and compute residuals
        residuals = []
        fitted_params_list = []

        for s in strokes:
            try:
                popt, _ = curve_fit(
                    lambda a, D, k: s_curve(a, D, k),
                    s['alpha'], s['values'],
                    p0=[s['total_di'], s['steep']],
                    bounds=([0, 1], [500, 50]),
                    maxfev=2000
                )
                D_fit, k_fit = popt
            except Exception:
                D_fit, k_fit = s['total_di'], s['steep']

            fitted = s_curve(np.array(s['alpha']), D_fit, k_fit)
            residual = s['values'] - fitted
            # Normalize residual by D
            norm_residual = residual / max(D_fit, 0.1)
            residuals.append(norm_residual)
            fitted_params_list.append([D_fit, k_fit])

        residuals = np.array(residuals)
        fitted_params_arr = np.array(fitted_params_list)

        # Average residual (systematic bias)
        avg_residual = np.mean(residuals, axis=0)

        # Corner DI -> Middle DI
        corner_avg_dis = np.array([
            np.mean([s['corner_dis'][c] for c in corners])
            for s in strokes
        ])
        Ds = fitted_params_arr[:, 0]
        ks = fitted_params_arr[:, 1]

        if len(corner_avg_dis) > 1 and np.std(corner_avg_dis) > 0.01:
            A = np.vstack([corner_avg_dis, np.ones(len(corner_avg_dis))]).T
            d_coef, _, _, _ = np.linalg.lstsq(A, Ds, rcond=None)
        else:
            d_coef = [0.0, np.mean(Ds)]

        sensor_models[ms_name] = {
            'avg_residual': avg_residual,
            'd_coef': d_coef,
            'D_mean': np.mean(Ds),
            'D_std': max(np.std(Ds), 0.5),
            'k_mean': np.mean(ks),
            'k_std': max(np.std(ks), 0.1),
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
        avg_corner_di = np.mean([corner_dis[c] for c in corners])

        D_prior = model['d_coef'][0] * avg_corner_di + model['d_coef'][1]
        k_prior = model['k_mean']

        def objective(x):
            D, k = x
            base = s_curve(alpha_observed, D, k)
            # Add scaled residual correction
            corrected = base + D * model['avg_residual'][:cutoff_idx]
            data_fit = np.sum((corrected - values_observed) ** 2)
            reg_D = ((D - D_prior) / model['D_std']) ** 2
            reg_k = ((k - k_prior) / model['k_std']) ** 2
            frac_seen = cutoff_idx / N_PTS
            pw = max(0.5, (1.0 - frac_seen) * 5.0)
            return data_fit + pw * (reg_D + 2.0 * reg_k)

        result = minimize(objective, [D_prior, k_prior],
                         bounds=[(D_prior * 0.3, D_prior * 3.0), (1, 50)],
                         method='L-BFGS-B')
        D_fit, k_fit = result.x

        base = s_curve(alpha_full, D_fit, k_fit)
        predicted = base + D_fit * model['avg_residual']

        output = np.zeros(N_PTS)
        output[:cutoff_idx] = values_observed
        output[cutoff_idx:] = predicted[cutoff_idx:]

        return output

    return predict


# =============================================================================
# Algorithm registry
# =============================================================================

ALGORITHMS = {
    'sigmoid_fit': sigmoid_fit_factory,
    'template_matching': template_matching_factory,
    'bayesian_sigmoid': bayesian_sigmoid_factory,
    'ensemble': ensemble_factory,
    'multi_template': multi_template_factory,
    'hierarchical': hierarchical_factory,
    'shape_normalized': shape_normalized_ensemble_factory,
    'physics_residual': physics_residual_factory,
}
