#!/usr/bin/env python3
"""Quick evaluation of V2 algorithms on hard cases."""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from evaluation import quick_eval
from algorithms_v2 import ALGORITHMS_V2

print("=" * 70)
print("Quick Evaluation V2: Hard Cases")
print("=" * 70)

results = {}
for name, factory in ALGORITHMS_V2.items():
    print(f"\n--- {name} ---")
    worst = quick_eval(factory, name, verbose=True)
    results[name] = worst

print("\n" + "=" * 70)
print("SUMMARY")
print("=" * 70)
print(f"{'Algorithm':<30} {'RMSE':>8} {'MaxErr':>8} {'DI_Err':>8} {'Pass?':>6}")
print("-" * 62)
for name, worst in sorted(results.items(), key=lambda x: x[1]['rmse']):
    passed = worst['rmse'] < 1.0 and worst['max_error'] < 3.0 and worst['di_error'] < 2.0
    mark = "YES" if passed else "NO"
    print(f"{name:<30} {worst['rmse']:>8.3f} {worst['max_error']:>8.3f} "
          f"{worst['di_error']:>8.3f} {mark:>6}")
