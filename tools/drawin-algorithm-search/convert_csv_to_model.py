#!/usr/bin/env python3
"""Convert PAM-Stamp CSV to P7 training model JSON.

Reads RelatorioDrawIn_Consolidado.csv (11-point simulation curves) and produces
a prediction model JSON with 200-point normalized shapes on a uniform α grid.

Interpolation: Clamped cubic B-spline (zero derivative at both endpoints),
ensuring curves approach start/end horizontally.
"""

import csv
import json
import numpy as np
from scipy.interpolate import make_interp_spline
from pathlib import Path

# --- Configuration ---
N_PTS = 200       # output α grid resolution
N_FINE = 1001     # intermediate fine grid for interpolation

SAME_SIDE_CORNERS = {
    'DP02': ['DP01', 'DP03'],
    'DP05': ['DP04', 'DP06'],
    'DP08': ['DP07', 'DP09'],
    'DP11': ['DP10', 'DP12'],
}
CORNERS = ['DP01', 'DP03', 'DP04', 'DP06', 'DP07', 'DP09', 'DP10', 'DP12']
MIDDLES = ['DP02', 'DP05', 'DP08', 'DP11']


def read_csv(path):
    """Read CSV and return list of stroke dicts."""
    with open(path) as f:
        reader = csv.reader(f)
        header = next(reader)
        sensor_names = header[3:]  # DP01..DP12

        strokes = []
        for row in reader:
            name = row[0]
            step = np.array([float(x) for x in row[2].split(',')])
            sensors = {}
            for i, sname in enumerate(sensor_names, 3):
                vals = np.array([float(x) for x in row[i].split(',')])
                # Offset to ensure curve starts from zero
                vals = vals - vals[0]
                sensors[sname] = vals
            strokes.append({'name': name, 'step': step, 'sensors': sensors})
    return strokes, sensor_names


def bspline_interpolate(x, y, x_new):
    """Clamped cubic B-spline: zero first derivative at both endpoints."""
    spline = make_interp_spline(
        x, y, k=3,
        bc_type=([(1, 0.0)], [(1, 0.0)])
    )
    result = spline(x_new)
    # Clamp to non-negative (B-spline can oscillate slightly near zero)
    return np.maximum(result, 0.0)


def process_strokes(strokes):
    """Interpolate all strokes, compute α, build normalized shapes."""
    alpha_grid = np.linspace(0, 1, N_PTS)

    # All stamps share the same STEP grid
    step_coarse = strokes[0]['step']  # 11 points, -220 to 0
    step_fine = np.linspace(step_coarse[0], step_coarse[-1], N_FINE)

    sensor_data = {ms: {'shapes': [], 'D_ratios': []} for ms in MIDDLES}

    for stroke in strokes:
        # 1. Interpolate all 12 sensors from 11 → 1001 points
        fine = {}
        for sname, vals in stroke['sensors'].items():
            fine[sname] = bspline_interpolate(step_coarse, vals, step_fine)

        # 2. Per-middle processing
        for ms, corners in SAME_SIDE_CORNERS.items():
            corner_dis = [fine[c][-1] for c in corners]
            avg_corner_di = np.mean(corner_dis)

            if avg_corner_di <= 0:
                continue

            # α = mean of normalized same-side corner curves
            norm_corners = []
            for c in corners:
                di = fine[c][-1]
                if di > 0:
                    norm_corners.append(fine[c] / di)
            if not norm_corners:
                continue
            alpha = np.mean(norm_corners, axis=0)

            # Make α strictly monotonic for resampling
            alpha = np.maximum.accumulate(alpha)
            alpha += np.arange(N_FINE) * 1e-12
            if alpha[-1] <= alpha[0]:
                continue
            alpha_norm = (alpha - alpha[0]) / (alpha[-1] - alpha[0])

            # Middle sensor: normalize by total draw-in → shape
            D = fine[ms][-1]
            if D <= 0:
                continue
            shape = fine[ms] / D

            # Resample shape onto uniform α grid
            shape_resampled = np.interp(alpha_grid, alpha_norm, shape)
            shape_resampled[0] = 0.0
            shape_resampled[-1] = 1.0

            sensor_data[ms]['shapes'].append(shape_resampled.tolist())
            sensor_data[ms]['D_ratios'].append(D / avg_corner_di)

    return sensor_data, alpha_grid


def build_model_json(sensor_data, alpha_grid, die_id="93309290"):
    """Build the P7 training model JSON."""
    model = {
        "die_id": die_id,
        "source": "pamstamp_sim",
        "date": "2026-03-10",
        "n_pts": N_PTS,
        "alpha_grid": alpha_grid.tolist(),
        "sensors": {},
    }

    for ms in MIDDLES:
        data = sensor_data[ms]
        shapes = np.array(data['shapes'])
        D_ratios = np.array(data['D_ratios'])

        if len(shapes) == 0:
            continue

        # Median shape as robust fallback
        med_shape = np.median(shapes, axis=0)
        med_shape[0] = 0.0
        med_shape[-1] = 1.0
        med_shape = np.maximum.accumulate(med_shape)
        if med_shape[-1] > 0:
            med_shape /= med_shape[-1]

        model["sensors"][ms] = {
            "shapes": shapes.tolist(),
            "med_shape": med_shape.tolist(),
            "D_ratio_mean": round(float(np.mean(D_ratios)), 4),
            "D_ratio_std": round(float(max(np.std(D_ratios), 0.005)), 4),
            "n_training_strokes": len(shapes),
        }

    return model


def main():
    csv_path = Path(__file__).parent / "sample-data" / "RelatorioDrawIn_Consolidado.csv"
    out_dir = Path(__file__).parent.parent.parent / "config" / "prediction-models"
    out_path = out_dir / "93309290.json"

    print(f"Reading {csv_path}")
    strokes, sensor_names = read_csv(csv_path)
    print(f"  {len(strokes)} strokes, {len(sensor_names)} sensors")

    print("Processing strokes (clamped B-spline 11→1001, then α-resample to 200)...")
    sensor_data, alpha_grid = process_strokes(strokes)

    print("Building model JSON...")
    model = build_model_json(sensor_data, alpha_grid)

    # Summary
    print()
    for ms, data in model["sensors"].items():
        n = data["n_training_strokes"]
        dr = data["D_ratio_mean"]
        ds = data["D_ratio_std"]
        print(f"  {ms}: {n} shapes, D_ratio = {dr:.4f} ± {ds:.4f}")

    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(model, f, indent=2)
    print(f"\nWritten to {out_path}")


if __name__ == '__main__':
    main()
