#!/usr/bin/env python3
"""Compare 2-corner (same-side) vs 8-corner (all) reference sensors."""
import sys, os, time, copy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from data_model import (
    SimParams, MIDDLE_SENSORS, CORNER_SENSORS, SAME_SIDE_CORNERS, N_PTS,
    generate_dataset, compute_alpha, get_cutoff_index
)
from evaluation import aggregate_metrics, compute_metrics, PredictionMetrics, get_sweep_configs
from best_algorithm import build_predictor, SAME_SIDE_CORNERS as ALGO_CORNERS

# All-corners mapping
ALL_CORNERS = {ms: CORNER_SENSORS for ms in MIDDLE_SENSORS}


def evaluate_with_corners(algo_factory, params, corner_map):
    """Evaluate algorithm using a specific corner mapping."""
    sensor_di, train_strokes, test_strokes = generate_dataset(params)

    train_data = {}
    for ms in MIDDLE_SENSORS:
        corners = corner_map[ms]
        ms_train = []
        for stroke in train_strokes:
            alpha = compute_alpha(stroke, corners)
            ms_train.append({
                'alpha': alpha,
                'values': stroke.sensors[ms].values,
                'total_di': stroke.sensors[ms].total_di,
                'corner_curves': {c: stroke.sensors[c].values for c in corners},
                'corner_dis': {c: stroke.sensors[c].total_di for c in corners},
                'steep': stroke.sensors[ms].steep,
            })
        train_data[ms] = ms_train

    predictor = algo_factory(train_data, params)

    all_metrics = []
    for stroke in test_strokes:
        for ms in MIDDLE_SENSORS:
            corners = corner_map[ms]
            alpha = compute_alpha(stroke, corners)
            actual_noisy = stroke.sensors[ms].values
            actual_clean = stroke.sensors[ms].clean_values
            cutoff_idx = get_cutoff_index(actual_noisy, params.det_range)
            if cutoff_idx >= N_PTS:
                continue

            predicted = predictor(
                ms_name=ms,
                alpha_observed=actual_noisy[:cutoff_idx],
                values_observed=actual_noisy[:cutoff_idx],
                cutoff_idx=cutoff_idx,
                alpha_full=alpha,
                corner_curves={c: stroke.sensors[c].values for c in corners},
                corner_dis={c: stroke.sensors[c].total_di for c in corners},
            )
            metrics = compute_metrics(actual_clean, predicted, cutoff_idx)
            all_metrics.append(metrics)

    return aggregate_metrics(all_metrics)


def make_factory_with_corners(corner_map):
    """Create a build_predictor that uses the given corner mapping."""
    import best_algorithm as ba
    orig = ba.SAME_SIDE_CORNERS

    def factory(train_data, params):
        ba.SAME_SIDE_CORNERS = corner_map
        result = build_predictor(train_data, params)
        ba.SAME_SIDE_CORNERS = orig
        return result

    return factory


def main():
    configs = [
        ('Same-side (2)', SAME_SIDE_CORNERS),
        ('All corners (8)', ALL_CORNERS),
    ]

    sweep_configs = get_sweep_configs()

    for label, corner_map in configs:
        print(f"\n{'='*70}")
        print(f"  {label}")
        print(f"{'='*70}")

        factory = make_factory_with_corners(corner_map)
        worst = {'rmse': 0, 'max_error': 0, 'di_error': 0}
        sweep_worst = {}

        t0 = time.time()
        for param_name, values in sweep_configs:
            pw = {'rmse': 0, 'max_error': 0, 'di_error': 0}
            for val in values:
                params = SimParams()
                if param_name == 'det_range': params.det_range = val
                elif param_name == 'noise': params.noise = val
                elif param_name == 'speed_var': params.speed_var = val
                elif param_name == 'steep': params.steep = val
                elif param_name == 'train_strokes': params.train_strokes = int(val)

                agg = evaluate_with_corners(factory, params, corner_map)
                for k in ['rmse', 'max_error', 'di_error']:
                    pw[k] = max(pw[k], agg[k])
                    worst[k] = max(worst[k], agg[k])

            print(f"  {param_name:<15} worst RMSE={pw['rmse']:.3f}  MaxErr={pw['max_error']:.3f}  DI={pw['di_error']:.3f}")

        elapsed = time.time() - t0
        print(f"\n  OVERALL: RMSE={worst['rmse']:.3f}mm  MaxErr={worst['max_error']:.3f}mm  DI={worst['di_error']:.3f}mm  ({elapsed:.1f}s)")


if __name__ == '__main__':
    main()
