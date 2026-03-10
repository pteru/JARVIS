#!/usr/bin/env python3
"""
Benchmark script for draw-in prediction algorithms.

Runs the full multi-variable sweep evaluation and outputs results to
sweep_results.json. Also prints a summary table to stdout.
"""
import sys
import os
import json
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from evaluation import run_sweep, quick_eval
from best_algorithm import build_predictor


def main():
    print("=" * 70)
    print("Draw-in Prediction Algorithm Benchmark")
    print("=" * 70)

    algo_name = "shape_selection_robust"

    # Quick eval first (fast sanity check)
    print("\n--- Quick Evaluation (6 hard cases) ---")
    quick_worst = quick_eval(build_predictor, algo_name, verbose=True)

    passed_quick = (quick_worst['rmse'] < 1.0
                    and quick_worst['max_error'] < 3.0
                    and quick_worst['di_error'] < 2.0)
    print(f"\nQuick pass: {'YES' if passed_quick else 'NO'}")

    # Full sweep
    print("\n--- Full Sweep Evaluation ---")
    results = run_sweep(build_predictor, algo_name, verbose=True)

    # Save results
    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               'sweep_results.json')
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to: {output_path}")

    # Print per-sweep summary table
    print("\n" + "=" * 70)
    print("Per-Sweep Summary")
    print("=" * 70)

    sweep_worst = {}
    for pt in results['sweep_points']:
        p = pt['param']
        if p not in sweep_worst:
            sweep_worst[p] = {'rmse': 0, 'max_error': 0, 'di_error': 0, 'points': []}
        sweep_worst[p]['rmse'] = max(sweep_worst[p]['rmse'], pt['rmse'])
        sweep_worst[p]['max_error'] = max(sweep_worst[p]['max_error'], pt['max_error'])
        sweep_worst[p]['di_error'] = max(sweep_worst[p]['di_error'], pt['di_error'])
        sweep_worst[p]['points'].append(pt)

    print(f"\n{'Sweep Param':<15} {'Worst RMSE':>12} {'Worst MaxErr':>14} {'Worst DI_Err':>14}")
    print("-" * 55)
    for p, w in sweep_worst.items():
        print(f"{p:<15} {w['rmse']:>12.3f} {w['max_error']:>14.3f} {w['di_error']:>14.3f}")

    s = results['summary']
    print(f"\n{'='*70}")
    print(f"OVERALL: Worst RMSE={s['worst_rmse']:.3f}mm "
          f"MaxErr={s['worst_max_error']:.3f}mm "
          f"DI_Err={s['worst_di_error']:.3f}mm")
    print(f"Meets <1mm RMSE target: {s['meets_criteria']}")
    print(f"Time: {s['total_time_s']:.1f}s")
    print(f"{'='*70}")

    return results


if __name__ == '__main__':
    main()
