#!/usr/bin/env python3
"""
Generate realistic batch data for DieMaster smart-die-dev database.
Uses simulation data from RelatorioDrawIn_Consolidado.csv as the basis.

Creates:
- 3 batches of 400 panels each (12 SPM, ~5s between panels)
- Random pauses (3-5 per batch, 5-20 min each)
- Missing sensor data (~3% random failures)
- Middle sensors with incomplete curves + predicted completion
- Realistic GAP sensor mock data
"""

import csv
import random
import json
import sys
from datetime import datetime, timedelta, timezone

# ── Config ──────────────────────────────────────────────────────────────────
DB_HOST = "192.168.15.2"
DB_PORT = 2345
DB_NAME = "smart-die-dev"
DB_USER = "strokmatic"
DB_PASS = "<skm-password>"

DIE_ID = 1  # die 1 = 52182584 (GM SJC)
PRESS_ID = 1

NUM_BATCHES = 3
PANELS_PER_BATCH = 400
SPM = 12  # strokes per minute
INTERVAL_S = 60.0 / SPM  # ~5 seconds

PAUSES_PER_BATCH = (3, 5)  # min, max pauses
PAUSE_DURATION_MIN = (5, 20)  # minutes

SENSOR_FAILURE_RATE = 0.03  # 3% chance of missing data per sensor per panel

# Sensors that are "middle" — will have incomplete curves
MIDDLE_SENSORS = ["DP01", "DP03", "DP07", "DP09"]
MIDDLE_INCOMPLETE_RATE = 0.15  # 15% of panels for middle sensors

# Batch start times (staggered by ~1 day)
BATCH_STARTS = [
    datetime(2026, 3, 10, 6, 0, 0, tzinfo=timezone.utc),
    datetime(2026, 3, 11, 6, 30, 0, tzinfo=timezone.utc),
    datetime(2026, 3, 12, 7, 0, 0, tzinfo=timezone.utc),
]

# Sensor ID mapping (DB sensor.id for die_id=1)
# From the DB query: DP01=38, DP02=37, DP03=36, DP04=35, DP05=34,
# DP06=27, DP07=28, DP08=29, DP09=30, DP10=31, DP11=40, DP12=39
DRAWIN_SENSOR_IDS = {
    "DP01": 38, "DP02": 37, "DP03": 36, "DP04": 35, "DP05": 34,
    "DP06": 27, "DP07": 28, "DP08": 29, "DP09": 30, "DP10": 31,
    "DP11": 40, "DP12": 39,
}

# GAP sensors for die 1
GAP_SENSOR_IDS = {
    "GP01": 41, "GP02": 42, "GP03": 33, "GP04": 32,
}

# Field IDs from the DB
FIELD_IDS = {
    "X": 1, "Y": 2, "X_cal": 3, "Y_cal": 4,
    "v_x": 5, "v_y": 6, "di_x": 7, "di_y": 8,
    "di": 9, "dpi": 10, "time": 11,
    "Z": 12, "T": 13, "abs": 14,
    "x_max": 15, "y_max": 16, "z_max": 17, "abs_max": 18,
    "x_norm": 19, "y_norm": 20, "z_norm": 21, "abs_norm": 22,
    "range": 23,
}


def parse_csv(filepath):
    """Parse the consolidado CSV and extract all curve data."""
    stamps = []
    with open(filepath, "r") as f:
        reader = csv.reader(f)
        header = next(reader)  # Simulacao, Tempo_s, STEP, DP01..DP12

        for row in reader:
            if not row or not row[0].startswith("Stamp_"):
                continue
            stamp = {"name": row[0]}
            # Parse time array (same for all)
            stamp["time"] = [float(x) for x in row[1].split(",")]
            stamp["step"] = [float(x) for x in row[2].split(",")]
            # Parse each sensor curve
            for i, sensor_name in enumerate(header[3:], start=3):
                stamp[sensor_name] = [float(x) for x in row[i].split(",")]
            stamps.append(stamp)
    return stamps, header[3:]  # stamps list, sensor names


def compute_sensor_stats(stamps, sensor_names):
    """Compute mean, std, min, max of final di values per sensor."""
    stats = {}
    for sname in sensor_names:
        finals = [s[sname][-1] for s in stamps]
        mean = sum(finals) / len(finals)
        variance = sum((x - mean) ** 2 for x in finals) / len(finals)
        std = variance ** 0.5
        stats[sname] = {
            "mean": mean,
            "std": std,
            "min": min(finals),
            "max": max(finals),
            "cl": round(mean, 2),
            "uwl": round(mean + 2 * std, 2),
            "lwl": round(mean - 2 * std, 2),
            "ucl": round(mean + 3 * std, 2),
            "lcl": round(mean - 3 * std, 2),
        }
    return stats


def generate_panel_timestamps(start_time, num_panels, pauses_range, pause_duration_range):
    """Generate timestamps with random pauses inserted."""
    timestamps = []
    num_pauses = random.randint(*pauses_range)
    # Choose random panel indices where pauses occur (not at start/end)
    pause_at = sorted(random.sample(range(20, num_panels - 20), num_pauses))

    current_time = start_time
    for i in range(num_panels):
        timestamps.append(current_time)
        # Normal interval + small jitter (±0.5s)
        interval = INTERVAL_S + random.uniform(-0.5, 0.5)
        current_time += timedelta(seconds=interval)

        # Check for pause
        if i in pause_at:
            pause_min = random.uniform(*pause_duration_range)
            current_time += timedelta(minutes=pause_min)

    return timestamps


def sample_curve(stamps, sensor_name):
    """Sample a random curve from simulation data with small perturbation."""
    base = random.choice(stamps)
    curve = list(base[sensor_name])
    # Add small noise (proportional to value)
    perturbed = []
    for v in curve:
        noise = random.gauss(0, max(abs(v) * 0.005, 0.01))
        perturbed.append(round(v + noise, 4))
    return perturbed


def make_incomplete_curve(curve, predicted_from_idx=None):
    """
    Make a curve incomplete — truncate actual data, add predicted completion.
    Returns (actual_curve, predicted_curve) where predicted_curve completes it.
    """
    n = len(curve)
    if predicted_from_idx is None:
        # Truncate somewhere between 40-70% of the curve
        predicted_from_idx = random.randint(int(n * 0.4), int(n * 0.7))

    actual = curve[:predicted_from_idx]
    # Predicted: extrapolate from last 2 actual points with some drift
    predicted = list(curve)  # full curve as "prediction"
    # Add slight bias to predicted portion to make it visibly different
    for i in range(predicted_from_idx, n):
        bias = random.gauss(0, abs(curve[i]) * 0.02)
        predicted[i] = round(curve[i] + bias, 4)

    return actual, predicted


def generate_gap_data(sensor_name, panel_idx):
    """Generate mock GAP sensor data (vibration magnitude)."""
    # Base vibration levels per GAP sensor (realistic range: 0.3-1.2g)
    base_levels = {
        "GP01": 0.65, "GP02": 0.58, "GP03": 0.72, "GP04": 0.85,
    }
    base = base_levels.get(sensor_name, 0.7)

    # 10-point vibration time series
    n_points = 10
    time_arr = [round(0.1 + i * 0.08, 2) for i in range(n_points)]

    # Generate vibration curve (spike pattern typical of stamping)
    x_arr, y_arr, z_arr = [], [], []
    for j in range(n_points):
        # Peak in the middle of the stroke
        peak_factor = 1.0 + 2.0 * (1.0 - abs(j - n_points / 2) / (n_points / 2))
        x_arr.append(round(random.gauss(0, base * 0.3) * peak_factor, 4))
        y_arr.append(round(random.gauss(0, base * 0.25) * peak_factor, 4))
        z_arr.append(round(random.gauss(0, base * 0.15) * peak_factor, 4))

    abs_arr = [round((x**2 + y**2 + z**2) ** 0.5, 4)
               for x, y, z in zip(x_arr, y_arr, z_arr)]
    abs_max = round(max(abs_arr), 4)

    # Temperature (slowly varying, ~25-35°C)
    temp_base = random.gauss(30, 2)
    temp_arr = [round(temp_base + j * 0.05 + random.gauss(0, 0.1), 1)
                for j in range(n_points)]

    return {
        "X": json.dumps(x_arr),
        "Y": json.dumps(y_arr),
        "Z": json.dumps(z_arr),
        "T": json.dumps(temp_arr),
        "abs": json.dumps(abs_arr),
        "x_max": str(round(max(abs(v) for v in x_arr), 4)),
        "y_max": str(round(max(abs(v) for v in y_arr), 4)),
        "z_max": str(round(max(abs(v) for v in z_arr), 4)),
        "abs_max": str(abs_max),
        "time": json.dumps(time_arr),
    }


def main():
    csv_path = "/home/teruel/JARVIS/tools/drawin-algorithm-search/sample-data/RelatorioDrawIn_Consolidado.csv"

    print("Parsing simulation data...")
    stamps, sensor_names = parse_csv(csv_path)
    print(f"  Loaded {len(stamps)} stamps with {len(sensor_names)} sensors")

    print("\nComputing sensor statistics...")
    stats = compute_sensor_stats(stamps, sensor_names)
    for sn in sorted(stats.keys()):
        s = stats[sn]
        print(f"  {sn}: mean={s['mean']:.2f} std={s['std']:.2f} "
              f"CL={s['cl']} UWL={s['uwl']} LWL={s['lwl']} UCL={s['ucl']} LCL={s['lcl']}")

    # ── Generate SQL ────────────────────────────────────────────────────
    sql_lines = []
    sql_lines.append("-- Generated batch data for die 1 (52182584)")
    sql_lines.append("-- 3 batches x 400 panels, with pauses, failures, incomplete curves")
    sql_lines.append("BEGIN;")
    sql_lines.append("")

    # 1. Update sensor control limits
    sql_lines.append("-- Update control limits based on simulation statistics")
    for sname, sid in DRAWIN_SENSOR_IDS.items():
        s = stats[sname]
        sql_lines.append(
            f"UPDATE sensor SET cl={s['cl']}, uwl={s['uwl']}, lwl={s['lwl']}, "
            f"ucl={s['ucl']}, lcl={s['lcl']} WHERE id={sid};"
        )
    # GAP sensors: set plausible limits
    for gname, gid in GAP_SENSOR_IDS.items():
        base = {"GP01": 0.65, "GP02": 0.58, "GP03": 0.72, "GP04": 0.85}[gname]
        sql_lines.append(
            f"UPDATE sensor SET cl={base:.2f}, uwl={base + 0.15:.2f}, lwl={base - 0.15:.2f}, "
            f"ucl={base + 0.25:.2f}, lcl={base - 0.25:.2f} WHERE id={gid};"
        )
    sql_lines.append("")

    # 2. Delete existing panels/acquisitions/batches for die 1 (clean slate)
    sql_lines.append("-- Clean existing die 1 data")
    sql_lines.append("DELETE FROM acquisition WHERE die_id = 1;")
    sql_lines.append("DELETE FROM panel WHERE die_id = 1;")
    sql_lines.append("DELETE FROM batch WHERE die_id = 1;")
    sql_lines.append("")

    # Disable trigger for bulk insert
    sql_lines.append("ALTER TABLE panel DISABLE TRIGGER panel_after_insert_determine_batch_trigger;")
    sql_lines.append("")

    panel_id_counter = 100  # start from 100 to avoid conflicts
    batch_id_counter = 10

    total_acquisitions = 0
    total_skipped = 0
    total_incomplete = 0

    for batch_idx in range(NUM_BATCHES):
        batch_id = batch_id_counter + batch_idx
        start_time = BATCH_STARTS[batch_idx]

        print(f"\nGenerating batch {batch_idx + 1} (id={batch_id}, start={start_time.isoformat()})...")

        timestamps = generate_panel_timestamps(
            start_time, PANELS_PER_BATCH, PAUSES_PER_BATCH, PAUSE_DURATION_MIN
        )
        end_time = timestamps[-1]

        sql_lines.append(f"-- Batch {batch_idx + 1}: {PANELS_PER_BATCH} panels")
        sql_lines.append(
            f"INSERT INTO batch (id, press_id, die_id, start_timestamp, end_timestamp, "
            f"created_at, updated_at) VALUES ({batch_id}, {PRESS_ID}, {DIE_ID}, "
            f"'{start_time.isoformat()}', '{end_time.isoformat()}', NOW(), NOW());"
        )
        sql_lines.append("")

        # Generate panels
        panel_ids = []
        for p_idx in range(PANELS_PER_BATCH):
            pid = panel_id_counter
            panel_id_counter += 1
            panel_ids.append(pid)
            ts = timestamps[p_idx].isoformat()
            sql_lines.append(
                f"INSERT INTO panel (id, stroke_timestamp, die_id, batch_id, "
                f"created_at, updated_at) VALUES ({pid}, '{ts}', {DIE_ID}, {batch_id}, NOW(), NOW());"
            )

        sql_lines.append("")
        sql_lines.append(f"-- Acquisitions for batch {batch_idx + 1}")

        # Generate acquisitions
        acq_values = []

        for p_idx, pid in enumerate(panel_ids):
            # ── DRAWIN sensors ──
            for sname in sensor_names:
                sid = DRAWIN_SENSOR_IDS[sname]

                # Random sensor failure
                if random.random() < SENSOR_FAILURE_RATE:
                    total_skipped += 1
                    continue

                curve = sample_curve(stamps, sname)
                di = curve[-1]

                # Check if middle sensor should be incomplete
                is_incomplete = False
                predicted_curve = None
                if sname in MIDDLE_SENSORS and random.random() < MIDDLE_INCOMPLETE_RATE:
                    actual_curve, predicted_curve = make_incomplete_curve(curve)
                    is_incomplete = True
                    total_incomplete += 1

                # Store curve fields
                time_arr = stamps[0]["time"]
                step_arr = stamps[0]["step"]

                # X_cal (calibrated displacement = the curve itself)
                x_cal = json.dumps(curve if not is_incomplete else actual_curve)
                acq_values.append(f"({pid},{sid},{FIELD_IDS['X_cal']},{DIE_ID},'{x_cal}')")

                # di (final displacement)
                acq_values.append(f"({pid},{sid},{FIELD_IDS['di']},{DIE_ID},'{di:.4f}')")

                # di_x and di_y components
                angle = random.uniform(0.1, 1.4)  # flow angle
                di_x = round(di * abs(random.gauss(0.85, 0.1)), 4)
                di_y = round(di * abs(random.gauss(0.3, 0.08)), 4)
                acq_values.append(f"({pid},{sid},{FIELD_IDS['di_x']},{DIE_ID},'{di_x}')")
                acq_values.append(f"({pid},{sid},{FIELD_IDS['di_y']},{DIE_ID},'{di_y}')")

                # time array
                time_json = json.dumps(time_arr)
                acq_values.append(f"({pid},{sid},{FIELD_IDS['time']},{DIE_ID},'{time_json}')")

                total_acquisitions += 5

                # If incomplete, also store the predicted curve
                if is_incomplete and predicted_curve:
                    pred_json = json.dumps(predicted_curve)
                    # Store predicted as Y_cal (field 4) — represents the predicted completion
                    acq_values.append(f"({pid},{sid},{FIELD_IDS['Y_cal']},{DIE_ID},'{pred_json}')")
                    total_acquisitions += 1

            # ── GAP sensors ──
            for gname, gid in GAP_SENSOR_IDS.items():
                # Random sensor failure
                if random.random() < SENSOR_FAILURE_RATE:
                    total_skipped += 1
                    continue

                gap = generate_gap_data(gname, p_idx)

                for field_name, value in gap.items():
                    fid = FIELD_IDS[field_name]
                    # Escape single quotes in JSON
                    v = value.replace("'", "''")
                    acq_values.append(f"({pid},{gid},{fid},{DIE_ID},'{v}')")
                    total_acquisitions += 1

            # Flush in batches of 500 to avoid huge statements
            if len(acq_values) >= 500:
                sql_lines.append(
                    "INSERT INTO acquisition (panel_id, sensor_id, field_id, die_id, value) VALUES"
                )
                sql_lines.append(",\n".join(acq_values) + ";")
                sql_lines.append("")
                acq_values = []

        # Flush remaining
        if acq_values:
            sql_lines.append(
                "INSERT INTO acquisition (panel_id, sensor_id, field_id, die_id, value) VALUES"
            )
            sql_lines.append(",\n".join(acq_values) + ";")
            sql_lines.append("")

        print(f"  Generated {len(panel_ids)} panels")

    # Re-enable trigger
    sql_lines.append("ALTER TABLE panel ENABLE TRIGGER panel_after_insert_determine_batch_trigger;")
    sql_lines.append("")

    # Reset sequences
    sql_lines.append("SELECT setval('panel_id_seq', (SELECT MAX(id) FROM panel));")
    sql_lines.append("SELECT setval('batch_id_seq', (SELECT MAX(id) FROM batch));")
    sql_lines.append("")
    sql_lines.append("COMMIT;")

    print(f"\n── Summary ─────────────────────────")
    print(f"  Batches: {NUM_BATCHES}")
    print(f"  Total panels: {NUM_BATCHES * PANELS_PER_BATCH}")
    print(f"  Total acquisitions: {total_acquisitions}")
    print(f"  Sensor failures (skipped): {total_skipped}")
    print(f"  Incomplete middle curves: {total_incomplete}")

    # Write SQL file
    out_path = "/home/teruel/JARVIS/tools/drawin-algorithm-search/batch_data.sql"
    with open(out_path, "w") as f:
        f.write("\n".join(sql_lines))
    print(f"\n  SQL written to: {out_path}")
    print(f"  File size: {len('\n'.join(sql_lines)) / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
