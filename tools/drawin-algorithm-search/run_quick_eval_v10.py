#!/usr/bin/env python3
"""Quick evaluation of V10 + comparison with best previous algorithms."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from evaluation import quick_eval
from algorithms_v7 import ALGORITHMS_V7
from algorithms_v9 import ALGORITHMS_V9
from algorithms_v10 import ALGORITHMS_V10

algos = {
    'shape_sel_robust_v7': ALGORITHMS_V7['shape_selection_robust'],
    'ultimate_v9': ALGORITHMS_V9['ultimate_v9'],
    'adaptive_hybrid_v10': ALGORITHMS_V10['adaptive_hybrid'],
}

print("=" * 70)
print("Quick Evaluation: Best Algorithms Comparison")
print("=" * 70)

results = {}
for name, factory in algos.items():
    print(f"\n--- {name} ---")
    worst = quick_eval(factory, name, verbose=True)
    results[name] = worst

print("\n" + "=" * 70)
print("SUMMARY")
print("=" * 70)
print(f"{'Algorithm':<30} {'RMSE':>8} {'MaxErr':>8} {'DI_Err':>8}")
print("-" * 55)
for name, worst in sorted(results.items(), key=lambda x: x[1]['rmse']):
    print(f"{name:<30} {worst['rmse']:>8.3f} {worst['max_error']:>8.3f} "
          f"{worst['di_error']:>8.3f}")
