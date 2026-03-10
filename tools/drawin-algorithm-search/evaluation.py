"""
Evaluation framework for draw-in prediction algorithms.

Runs multi-variable sweeps and computes metrics on the extrapolated region.
Metrics are computed against the CLEAN (noise-free) ground truth signal,
since the noise floor would otherwise make sub-mm RMSE impossible.
"""

import numpy as np
from dataclasses import dataclass
from typing import Dict, List, Callable, Any
import json
import time

from data_model import (
    SimParams, StrokeData, SensorData,
    MIDDLE_SENSORS, SAME_SIDE_CORNERS, N_PTS,
    generate_dataset, compute_alpha, get_cutoff_index
)


@dataclass
class PredictionMetrics:
    """Metrics computed on the extrapolated region only."""
    rmse: float
    max_error: float
    r2: float
    di_error: float  # |predicted_final - actual_final|


@dataclass
class SweepResult:
    """Results for a single sweep configuration."""
    param_name: str
    param_value: float
    rmse: float
    max_error: float
    r2: float
    di_error: float
    n_predictions: int


def compute_metrics(actual_clean: np.ndarray, predicted: np.ndarray,
                    cutoff_idx: int) -> PredictionMetrics:
    """Compute metrics on the extrapolated region (cutoff -> end).

    Compares prediction against CLEAN ground truth (noise-free).
    """
    if cutoff_idx >= len(actual_clean):
        return PredictionMetrics(rmse=0.0, max_error=0.0, r2=1.0, di_error=0.0)

    act = actual_clean[cutoff_idx:]
    pred = predicted[cutoff_idx:]

    if len(act) == 0:
        return PredictionMetrics(rmse=0.0, max_error=0.0, r2=1.0, di_error=0.0)

    errors = pred - act
    rmse = np.sqrt(np.mean(errors ** 2))
    max_err = np.max(np.abs(errors))

    ss_res = np.sum(errors ** 2)
    ss_tot = np.sum((act - np.mean(act)) ** 2)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-12 else 1.0

    di_err = abs(pred[-1] - act[-1])

    return PredictionMetrics(rmse=rmse, max_error=max_err, r2=r2, di_error=di_err)


AlgorithmFactory = Callable


def evaluate_algorithm(algo_factory: AlgorithmFactory,
                       params: SimParams,
                       verbose: bool = False) -> List[PredictionMetrics]:
    """Evaluate an algorithm on a single parameter configuration."""
    sensor_di, train_strokes, test_strokes = generate_dataset(params)

    # Build training data
    train_data = {}
    for ms in MIDDLE_SENSORS:
        corners = SAME_SIDE_CORNERS[ms]
        ms_train = []
        for stroke in train_strokes:
            alpha = compute_alpha(stroke, corners)
            ms_values = stroke.sensors[ms].values
            ms_total_di = stroke.sensors[ms].total_di

            corner_curves = {c: stroke.sensors[c].values for c in corners}
            corner_dis = {c: stroke.sensors[c].total_di for c in corners}

            ms_train.append({
                'alpha': alpha,
                'values': ms_values,
                'total_di': ms_total_di,
                'corner_curves': corner_curves,
                'corner_dis': corner_dis,
                'steep': stroke.sensors[ms].steep,
            })
        train_data[ms] = ms_train

    predictor = algo_factory(train_data, params)

    all_metrics = []
    for stroke in test_strokes:
        for ms in MIDDLE_SENSORS:
            corners = SAME_SIDE_CORNERS[ms]
            alpha = compute_alpha(stroke, corners)
            actual_noisy = stroke.sensors[ms].values
            actual_clean = stroke.sensors[ms].clean_values

            # Cutoff based on noisy values (what sensors actually see)
            cutoff_idx = get_cutoff_index(actual_noisy, params.det_range)

            if cutoff_idx >= N_PTS:
                continue

            alpha_observed = alpha[:cutoff_idx]
            values_observed = actual_noisy[:cutoff_idx]

            corner_curves = {c: stroke.sensors[c].values for c in corners}
            corner_dis = {c: stroke.sensors[c].total_di for c in corners}

            predicted = predictor(
                ms_name=ms,
                alpha_observed=alpha_observed,
                values_observed=values_observed,
                cutoff_idx=cutoff_idx,
                alpha_full=alpha,
                corner_curves=corner_curves,
                corner_dis=corner_dis,
            )

            # Compare prediction against CLEAN ground truth
            metrics = compute_metrics(actual_clean, predicted, cutoff_idx)
            all_metrics.append(metrics)

            if verbose:
                print(f"  {ms} cutoff@{cutoff_idx}: RMSE={metrics.rmse:.3f}mm "
                      f"MaxErr={metrics.max_error:.3f}mm DI_err={metrics.di_error:.3f}mm")

    return all_metrics


def aggregate_metrics(metrics_list: List[PredictionMetrics]) -> Dict[str, float]:
    """Aggregate a list of metrics into summary statistics."""
    if not metrics_list:
        return {'rmse': 0.0, 'max_error': 0.0, 'r2': 1.0, 'di_error': 0.0, 'n': 0}

    rmses = [m.rmse for m in metrics_list]
    max_errs = [m.max_error for m in metrics_list]
    r2s = [m.r2 for m in metrics_list]
    di_errs = [m.di_error for m in metrics_list]

    return {
        'rmse': float(np.mean(rmses)),
        'max_error': float(np.max(max_errs)),
        'r2': float(np.mean(r2s)),
        'di_error': float(np.mean(di_errs)),
        'n': len(metrics_list),
        'rmse_worst': float(np.max(rmses)),
    }


def get_sweep_configs() -> List[tuple]:
    """Get the multi-variable sweep configurations."""
    return [
        ('det_range', np.linspace(15, 70, 12).tolist()),
        ('noise', np.linspace(0, 50, 11).tolist()),
        ('speed_var', np.linspace(0, 0.50, 11).tolist()),
        ('steep', np.linspace(4, 25, 11).tolist()),
        ('train_strokes', [5, 8, 10, 15, 20, 25, 30, 40, 50, 60]),
    ]


def run_sweep(algo_factory: AlgorithmFactory,
              algo_name: str = "unknown",
              verbose: bool = False) -> Dict[str, Any]:
    """Run the full multi-variable sweep."""
    sweep_configs = get_sweep_configs()
    all_results = []
    worst_rmse = 0.0
    worst_max_error = 0.0
    worst_di_error = 0.0

    t0 = time.time()

    for param_name, values in sweep_configs:
        if verbose:
            print(f"\n=== Sweeping {param_name} ===")

        for val in values:
            params = SimParams()

            if param_name == 'det_range':
                params.det_range = val
            elif param_name == 'noise':
                params.noise = val
            elif param_name == 'speed_var':
                params.speed_var = val
            elif param_name == 'steep':
                params.steep = val
            elif param_name == 'train_strokes':
                params.train_strokes = int(val)

            if verbose:
                print(f"  {param_name}={val:.2f}...", end=" ", flush=True)

            metrics = evaluate_algorithm(algo_factory, params, verbose=False)
            agg = aggregate_metrics(metrics)

            result = SweepResult(
                param_name=param_name,
                param_value=float(val),
                rmse=agg['rmse'],
                max_error=agg['max_error'],
                r2=agg['r2'],
                di_error=agg['di_error'],
                n_predictions=agg['n'],
            )
            all_results.append(result)

            worst_rmse = max(worst_rmse, agg['rmse'])
            worst_max_error = max(worst_max_error, agg['max_error'])
            worst_di_error = max(worst_di_error, agg['di_error'])

            if verbose:
                print(f"RMSE={agg['rmse']:.3f}mm MaxErr={agg['max_error']:.3f}mm "
                      f"DI_err={agg['di_error']:.3f}mm (n={agg['n']})")

    elapsed = time.time() - t0

    summary = {
        'algorithm': algo_name,
        'worst_rmse': worst_rmse,
        'worst_max_error': worst_max_error,
        'worst_di_error': worst_di_error,
        'total_time_s': elapsed,
        'meets_criteria': (worst_rmse < 1.0 and worst_max_error < 3.0 and worst_di_error < 2.0),
    }

    results_data = {
        'summary': summary,
        'sweep_points': [
            {
                'param': r.param_name,
                'value': r.param_value,
                'rmse': r.rmse,
                'max_error': r.max_error,
                'r2': r.r2,
                'di_error': r.di_error,
                'n': r.n_predictions,
            }
            for r in all_results
        ]
    }

    if verbose:
        print(f"\n{'='*60}")
        print(f"Algorithm: {algo_name}")
        print(f"Worst RMSE: {worst_rmse:.4f}mm (target < 1.0)")
        print(f"Worst Max Error: {worst_max_error:.4f}mm (target < 3.0)")
        print(f"Worst DI Error: {worst_di_error:.4f}mm (target < 2.0)")
        print(f"Meets criteria: {summary['meets_criteria']}")
        print(f"Time: {elapsed:.1f}s")
        print(f"{'='*60}")

    return results_data


def quick_eval(algo_factory: AlgorithmFactory,
               algo_name: str = "unknown",
               verbose: bool = True) -> Dict[str, float]:
    """Quick evaluation on just a few hard cases (for fast iteration)."""
    hard_cases = [
        SimParams(det_range=15),     # very early cutoff
        SimParams(noise=50),         # max noise
        SimParams(speed_var=0.50),   # max speed variation
        SimParams(steep=4),          # very gradual curve
        SimParams(steep=25),         # very steep curve
        SimParams(train_strokes=5),  # minimal training data
    ]

    worst = {'rmse': 0, 'max_error': 0, 'di_error': 0}
    for params in hard_cases:
        metrics = evaluate_algorithm(algo_factory, params, verbose=False)
        agg = aggregate_metrics(metrics)
        worst['rmse'] = max(worst['rmse'], agg['rmse'])
        worst['max_error'] = max(worst['max_error'], agg['max_error'])
        worst['di_error'] = max(worst['di_error'], agg['di_error'])

        if verbose:
            label = [k for k, v in vars(params).items()
                     if v != getattr(SimParams(), k) and k != 'seed']
            label_str = ', '.join(f"{k}={getattr(params, k)}" for k in label)
            print(f"  {label_str or 'default'}: RMSE={agg['rmse']:.3f}mm "
                  f"MaxErr={agg['max_error']:.3f}mm DI={agg['di_error']:.3f}mm")

    if verbose:
        print(f"  WORST: RMSE={worst['rmse']:.3f}mm "
              f"MaxErr={worst['max_error']:.3f}mm DI={worst['di_error']:.3f}mm")

    return worst
