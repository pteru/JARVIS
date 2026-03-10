#!/usr/bin/env python3
"""Compute theoretical RMSE lower bound for noise=50 case."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from data_model import SimParams, N_PTS, SAME_SIDE_CORNERS, MIDDLE_SENSORS
from data_model import generate_dataset, compute_alpha, get_cutoff_index, s_curve

# Generate dataset with noise=50
params = SimParams(noise=50)
sensor_di, train, test = generate_dataset(params)

# Compute D estimation error with PERFECT shape knowledge
print("=== Theoretical Lower Bound Analysis (noise=50) ===\n")

rmse_list = []
di_err_list = []

for stroke in test:
    for ms in MIDDLE_SENSORS:
        corners = SAME_SIDE_CORNERS[ms]
        alpha = compute_alpha(stroke, corners)
        actual_noisy = stroke.sensors[ms].values
        actual_clean = stroke.sensors[ms].clean_values
        cutoff_idx = get_cutoff_index(actual_noisy, params.det_range)

        if cutoff_idx >= N_PTS:
            continue

        # PERFECT shape: use clean values / total_di
        D_true = stroke.sensors[ms].total_di
        shape_true = actual_clean / D_true

        # D estimation from noisy observed data using PERFECT shape
        shape_obs = shape_true[:cutoff_idx]
        values_obs = actual_noisy[:cutoff_idx]
        ss = np.sum(shape_obs ** 2)
        D_mle = np.sum(values_obs * shape_obs) / ss

        # Also try with Bayesian prior
        # Compute prior from training
        D_ratios = []
        avg_di = np.mean([stroke.sensors[c].total_di for c in corners])
        for ts in train:
            ts_D = ts.sensors[ms].total_di
            ts_avg_corner = np.mean([ts.sensors[c].total_di for c in corners])
            D_ratios.append(ts_D / ts_avg_corner)
        D_ratio_mean = np.mean(D_ratios)
        D_ratio_std = max(np.std(D_ratios), 0.005)
        D_prior = D_ratio_mean * avg_di
        D_prior_std = D_ratio_std * avg_di

        # Noise variance
        res = values_obs - D_mle * shape_obs
        noise_var = np.mean(res ** 2)
        D_mle_var = noise_var / max(ss, 1e-10)

        # Bayesian D
        pp = 1.0 / max(D_prior_std**2, 1e-10)
        lp = 1.0 / max(D_mle_var, 1e-10)
        D_post = (pp * D_prior + lp * D_mle) / (pp + lp)

        # Prediction with perfect shape
        pred = D_post * shape_true
        err = pred[cutoff_idx:] - actual_clean[cutoff_idx:]
        rmse = np.sqrt(np.mean(err**2))
        di_err = abs(pred[-1] - actual_clean[-1])
        rmse_list.append(rmse)
        di_err_list.append(di_err)

print(f"With PERFECT shape + Bayesian D:")
print(f"  Mean RMSE: {np.mean(rmse_list):.3f}mm")
print(f"  Max RMSE:  {np.max(rmse_list):.3f}mm")
print(f"  Mean DI_err: {np.mean(di_err_list):.3f}mm")
print(f"  Max DI_err: {np.max(di_err_list):.3f}mm")

# Also compute with perfect D (shape error only, from mean shape)
print(f"\nWith mean shape + PERFECT D:")
rmse_list2 = []
for stroke in test:
    for ms in MIDDLE_SENSORS:
        corners = SAME_SIDE_CORNERS[ms]
        actual_clean = stroke.sensors[ms].clean_values
        cutoff_idx = get_cutoff_index(stroke.sensors[ms].values, params.det_range)
        if cutoff_idx >= N_PTS:
            continue
        D_true = stroke.sensors[ms].total_di
        # Compute mean shape from training
        shapes = []
        alpha_grid = np.linspace(0, 1, N_PTS)
        for ts in train:
            ts_clean = ts.sensors[ms].clean_values
            ts_D = ts.sensors[ms].total_di
            shapes.append(ts_clean / ts_D)
        mean_shape = np.mean(shapes, axis=0)
        pred = D_true * mean_shape
        err = pred[cutoff_idx:] - actual_clean[cutoff_idx:]
        rmse_list2.append(np.sqrt(np.mean(err**2)))

print(f"  Mean RMSE: {np.mean(rmse_list2):.3f}mm")
print(f"  Max RMSE:  {np.max(rmse_list2):.3f}mm")

# Perfect D + perfect shape
print(f"\nWith perfect shape + PERFECT D (absolute minimum):")
print(f"  RMSE: 0.000mm (by definition)")

print(f"\n=== Conclusion ===")
print(f"D estimation error alone (perfect shape): {np.mean(rmse_list):.3f}mm mean, {np.max(rmse_list):.3f}mm worst")
print(f"Shape error alone (perfect D): {np.mean(rmse_list2):.3f}mm mean, {np.max(rmse_list2):.3f}mm worst")
print(f"Combined lower bound: ~{np.sqrt(np.mean(rmse_list)**2 + np.mean(rmse_list2)**2):.3f}mm")
