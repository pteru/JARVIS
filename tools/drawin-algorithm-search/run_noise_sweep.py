#!/usr/bin/env python3
"""Test algorithms across noise levels to understand the noise-RMSE relationship."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from evaluation import evaluate_algorithm, aggregate_metrics
from data_model import SimParams
from algorithms_v7 import ALGORITHMS_V7
from algorithms_v9 import ALGORITHMS_V9

algos = {
    'shape_sel_robust': ALGORITHMS_V7['shape_selection_robust'],
    'ultimate_v9': ALGORITHMS_V9['ultimate_v9'],
}

noise_vals = [0, 5, 10, 15, 20, 30, 40, 50]

print(f"{'Noise':<8}", end="")
for name in algos:
    print(f"  {name:<20}", end="")
print()
print("-" * 60)

for noise in noise_vals:
    params = SimParams(noise=noise)
    print(f"{noise:<8}", end="")
    for name, factory in algos.items():
        metrics = evaluate_algorithm(factory, params, verbose=False)
        agg = aggregate_metrics(metrics)
        print(f"  RMSE={agg['rmse']:.3f} DI={agg['di_error']:.3f}", end="")
    print()
