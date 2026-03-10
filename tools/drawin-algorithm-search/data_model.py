"""
Draw-in curve data generation model.

Generates synthetic stamping press sensor data with configurable parameters
for algorithm testing and evaluation.
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Optional

N_PTS = 200

# Sensor layout: sides A,B,C,D; positions 1(corner), 2(middle), 3(corner)
SIDES = ['A', 'B', 'C', 'D']
CORNER_SENSORS = [f'{s}{p}' for s in SIDES for p in [1, 3]]  # 8 corners
MIDDLE_SENSORS = [f'{s}2' for s in SIDES]  # 4 middles
ALL_SENSORS = CORNER_SENSORS + MIDDLE_SENSORS

# Same-side reference corners for each middle sensor
SAME_SIDE_CORNERS = {
    'A2': ['A1', 'A3'],
    'B2': ['B1', 'B3'],
    'C2': ['C1', 'C3'],
    'D2': ['D1', 'D3'],
}


@dataclass
class SimParams:
    """Simulation parameters for a sweep configuration."""
    train_strokes: int = 20
    test_strokes: int = 10
    det_range: float = 40.0   # mm - detection range
    speed_var: float = 0.20   # fraction (20% = 0.20)
    noise: float = 15.0       # tenths of percent (15 = 1.5%)
    steep: float = 12.0       # steepness parameter
    corner_min: float = 3.0   # mm
    corner_max: float = 12.0  # mm
    middle_min: float = 80.0  # mm
    middle_max: float = 130.0 # mm
    seed: int = 42


@dataclass
class SensorData:
    """Data for a single sensor in a stroke."""
    values: np.ndarray       # shape (N_PTS,) - noisy measurements
    clean_values: np.ndarray # shape (N_PTS,) - noise-free ground truth
    total_di: float          # total draw-in (amplitude)
    steep: float             # steepness parameter used


@dataclass
class StrokeData:
    """Data for a complete press stroke (all sensors)."""
    sensors: Dict[str, SensorData]
    warp: np.ndarray      # time warp array, shape (N_PTS,)


def s_curve(alpha: np.ndarray, D: float, k: float) -> np.ndarray:
    """Sigmoid-based S-curve. D=total draw-in, k=steepness."""
    def sigmoid(x):
        return 1.0 / (1.0 + np.exp(-x))

    s0 = sigmoid(-k * 0.5)
    s1 = sigmoid(k * 0.5)
    return D * (sigmoid(k * (alpha - 0.5)) - s0) / (s1 - s0)


def gen_time_warp(rng: np.random.Generator, speed_var: float) -> np.ndarray:
    """Random piecewise-linear speed profile -> cumulative time warp [0,1]."""
    # 5 control points for speed variation
    cp = np.array([1.0 + (rng.random() - 0.5) * 2.0 * speed_var for _ in range(5)])

    # Linear interpolation across N_PTS points
    cp_positions = np.linspace(0, N_PTS - 1, len(cp))
    all_positions = np.arange(N_PTS)
    spd = np.interp(all_positions, cp_positions, cp)

    # Clamp minimum speed
    spd = np.maximum(spd, 0.01)

    # Cumulative sum -> normalized
    cum = np.cumsum(spd)
    return cum / cum[-1]


def gen_sensor_di(rng: np.random.Generator, params: SimParams) -> Dict[str, float]:
    """Generate nominal draw-in values for all sensors."""
    sensor_di = {}
    for name in CORNER_SENSORS:
        sensor_di[name] = params.corner_min + rng.random() * (params.corner_max - params.corner_min)
    for name in MIDDLE_SENSORS:
        sensor_di[name] = params.middle_min + rng.random() * (params.middle_max - params.middle_min)
    return sensor_di


def gen_stroke(rng: np.random.Generator, sensor_di: Dict[str, float],
               params: SimParams) -> StrokeData:
    """Generate one press stroke with all 12 sensor curves."""
    warp = gen_time_warp(rng, params.speed_var)

    # Stroke-level steepness with 8% jitter
    stroke_k = params.steep * (1.0 + (rng.random() - 0.5) * 0.08)

    sensors = {}
    for name in ALL_SENSORS:
        # Per-sensor steepness jitter (8%)
        k = stroke_k * (1.0 + (rng.random() - 0.5) * 0.08)
        # Per-sensor DI variation (4%)
        di_var = sensor_di[name] * (1.0 + (rng.random() - 0.5) * 0.04)

        # Generate curve values
        clean_values = s_curve(warp, di_var, k)
        # Add noise
        noise_std = di_var * params.noise / 1000.0
        noise_vals = rng.normal(0, noise_std, N_PTS) if noise_std > 0 else np.zeros(N_PTS)
        values = np.maximum(0, clean_values + noise_vals)

        sensors[name] = SensorData(
            values=values, clean_values=clean_values,
            total_di=di_var, steep=k
        )

    return StrokeData(sensors=sensors, warp=warp)


def compute_alpha(stroke: StrokeData, ref_corners: List[str]) -> np.ndarray:
    """Compute stroke progress alpha from corner sensors (normalized by their totalDI)."""
    normalized = np.zeros((len(ref_corners), N_PTS))
    for j, name in enumerate(ref_corners):
        sd = stroke.sensors[name]
        normalized[j] = sd.values / sd.total_di
    return np.mean(normalized, axis=0)


def get_cutoff_index(values: np.ndarray, det_range: float) -> int:
    """Find the index where sensor value first exceeds detection range."""
    exceeds = np.where(values > det_range)[0]
    if len(exceeds) == 0:
        return N_PTS  # never exceeds -> full curve visible
    return int(exceeds[0])


def generate_dataset(params: SimParams):
    """Generate complete train+test dataset for a parameter configuration.

    Returns:
        sensor_di: nominal DI values for all sensors
        train_strokes: list of StrokeData for training
        test_strokes: list of StrokeData for testing
    """
    rng = np.random.default_rng(params.seed)

    # Generate nominal DI values (fixed for all strokes)
    sensor_di = gen_sensor_di(rng, params)

    # Generate training strokes
    train = [gen_stroke(rng, sensor_di, params) for _ in range(params.train_strokes)]

    # Generate test strokes
    test = [gen_stroke(rng, sensor_di, params) for _ in range(params.test_strokes)]

    return sensor_di, train, test
