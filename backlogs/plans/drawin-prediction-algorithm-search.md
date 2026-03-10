# Draw-In Prediction Algorithm Search

## Objective

Find a prediction algorithm that achieves **near-zero error** for draw-in curve extrapolation across the **full range** of all simulation parameters. The current best models (RBF, Residual CNN, Ensemble) degrade significantly under noisy, early-cutoff, or high speed-variation conditions.

## Problem Statement

In automotive stamping, laser sensors measure sheet metal draw-in displacement during a press stroke. **Corner sensors** (8 total, 2 per side) have small displacement (3-25mm) and always complete their full curve. **Middle sensors** (4 total, 1 per side) have large displacement (40-180mm) but their signal is interrupted when it exceeds the sensor detection range (15-80mm). We must predict the remaining middle-sensor curve after cutoff.

### Key Insight: Stroke Progress (α)

All sensors on the same press follow the same time warp (press kinematics). By computing **stroke progress α** from corner sensors (which complete fully), we can parameterize middle sensor curves as `y(α)` instead of `y(t)`, eliminating time dependency.

### What Makes This Hard

1. **Early cutoff**: With low detection range, we may only see α=0.2-0.4 of the curve before losing signal
2. **Noise**: Sensor noise up to 5% of draw-in amplitude
3. **Speed variation**: Non-uniform press speed creates different time warps per stroke
4. **Steepness variation**: S-curve shape varies between strokes (process/friction variation)
5. **The prediction region is EXTRAPOLATION** — we must predict the unseen portion of the curve

### Current Approach: In-Stroke Correction

After learning `y(α)` from training data, production prediction uses:
1. **D estimation** (amplitude scaling): weighted least-squares fit of measured portion to model, with Bayesian prior from corner DI ratio
2. **γ correction** (shape warp): `α → α^γ` to adjust steepness, regularized toward a corner-derived γ estimate
3. **Splice**: actual data up to cutoff, predicted data after

## Data Generation Model

Port this to Python. The data model is deterministic given a seed.

```python
N_PTS = 200  # points per curve

def s_curve(alpha, D, k):
    """Sigmoid-based S-curve. D=total draw-in, k=steepness"""
    s = lambda x: 1 / (1 + exp(-x))
    s0, s1 = s(-k*0.5), s(k*0.5)
    return D * (s(k*(alpha-0.5)) - s0) / (s1 - s0)

def gen_time_warp(rng, speed_var):
    """Random piecewise-linear speed profile → cumulative time warp [0,1]"""
    cp = [1 + (rng()-0.5)*2*speed_var for _ in range(5)]
    spd = interpolate(cp, N_PTS)  # linear interp across 5 control points
    cum = cumsum(max(spd, 0.01))
    return cum / cum[-1]  # normalize to [0, 1]

# Sensor layout: sides A,B,C,D; positions 1(corner),2(middle),3(corner)
# Corner sensors: A1,A3,B1,B3,C1,C3,D1,D3 (8 total)
# Middle sensors: A2,B2,C2,D2 (4 total)

def gen_stroke(rng, sensor_DI, params):
    """Generate one press stroke with all 12 sensor curves"""
    warp = gen_time_warp(rng, params.speed_var)
    stroke_k = params.steep * (1 + (rng()-0.5)*0.08)  # stroke-level steepness
    sensors = {}
    for name in ALL_SENSORS:
        k = stroke_k * (1 + (rng()-0.5)*0.08)  # per-sensor jitter
        di_var = sensor_DI[name] * (1 + (rng()-0.5)*0.04)  # DI variation
        values = [max(0, s_curve(warp[i], di_var, k) + gauss(rng)*di_var*params.noise/1000)
                  for i in range(N_PTS)]
        sensors[name] = {'values': values, 'totalDI': di_var, 'steep': k}
    return {'sensors': sensors, 'warp': warp}

def compute_alpha(stroke, ref_corners):
    """Stroke progress from corner sensors (normalized by their totalDI)"""
    alphas = []
    for i in range(N_PTS):
        avg = mean([stroke.sensors[n].values[i] / stroke.sensors[n].totalDI for n in ref_corners])
        alphas.append(avg)
    return alphas
```

### Parameter Ranges for Sweep

| Parameter | Min | Max | Default |
|-----------|-----|-----|---------|
| `train_strokes` | 5 | 60 | 20 |
| `test_strokes` | 5 | 15 | 10 |
| `det_range` (mm) | 15 | 70 | 40 |
| `speed_var` (%) | 0 | 50 | 20 |
| `noise` (‰ → %) | 0 | 50 (=5%) | 15 (=1.5%) |
| `steep` | 4 | 25 | 12 |
| `corner_min` (mm) | 0 | 15 | 3 |
| `corner_max` (mm) | 5 | 25 | 12 |
| `middle_min` (mm) | 40 | 120 | 80 |
| `middle_max` (mm) | 80 | 180 | 130 |
| `seed` | fixed: 42 | | |

### Reference Sensors

- **Same-side** (default): middle sensor A2 uses corners A1, A3
- **All corners**: all 8 corner sensors

Use **same-side** as the primary evaluation mode (production constraint: only same-side sensors are guaranteed to be co-located).

## Evaluation Framework

### Metrics (computed only on extrapolated region: cutoff → end)

1. **RMSE** (mm) — primary metric
2. **Max Error** (mm) — worst-case
3. **R²** — coefficient of determination
4. **DI Error** (mm) — |predicted_final - actual_final| (total draw-in prediction accuracy)

### Multi-Variable Sweep

Run a comprehensive sweep:
- For each of the 5 key parameters (`det_range`, `noise`, `speed_var`, `steep`, `train_strokes`), sweep 10-12 steps while holding others at default
- For each configuration: generate data, train model, predict all test strokes for all 4 middle sensors, compute aggregate metrics
- Track **worst-case RMSE across all sweep points** — this is what we're trying to minimize

### Success Criteria

- **RMSE < 1.0mm** across ALL parameter combinations in the sweep
- **Max Error < 3.0mm** across ALL parameter combinations
- **DI Error < 2.0mm** across ALL parameter combinations
- Graceful degradation: no catastrophic failure at any sweep point

## Current Algorithm Performance (Approximate)

| Model | Best-case RMSE | Worst-case RMSE | Weakness |
|-------|---------------|-----------------|----------|
| Polynomial (deg 4-5) | 0.3mm | 8-15mm | Early cutoff, noise |
| Sigmoid | 0.5mm | 5-10mm | Speed variation |
| KNN | 0.4mm | 6-12mm | Extrapolation |
| RBF Network | 0.2mm | 4-8mm | Early cutoff |
| MLP | 0.3mm | 5-10mm | Overfitting with few strokes |
| Ensemble (all 5) | 0.2mm | 3-6mm | Averages bad models |
| Multi-Input RBF | 0.2mm | 4-7mm | Still parametric |
| Residual CNN | 0.2mm | 3-6mm | Limited by base RBF |

## Algorithm Ideas to Explore

You are free to try ANY approach. Here are starting ideas:

### 1. Physics-Informed Approach
The underlying curve is an S-curve (sigmoid). Instead of learning an arbitrary `y(α)`, fit a **parametric S-curve model** with parameters `(D, k, m)` to each training stroke, then build a prior over parameters. For prediction: fit the visible portion + prior → posterior estimate.

### 2. Bayesian Curve Completion
Use Gaussian Process Regression with an S-curve mean function. The GP prior captures the known shape; the posterior updates with observed data. The kernel should encode the smoothness of draw-in curves.

### 3. Ensemble with Intelligent Selection
Instead of averaging all models, use the observed portion to score each model's fit and weight accordingly (stacking / model selection based on visible data quality).

### 4. Template Matching + Deformation
Find the training stroke whose corner sensor profile best matches the test stroke, then warp the training middle sensor curve to match the observed portion. This naturally handles speed/steepness variation.

### 5. Optimal Transport / DTW
Use Dynamic Time Warping to align training curves to the test stroke's observed portion, then extrapolate using the aligned curves.

### 6. Hierarchical Model
- Level 1: Estimate stroke parameters (speed profile, steepness) from corner sensors only
- Level 2: Given stroke parameters, predict middle sensor curve using conditional model

### 7. Direct Corner-to-Middle Mapping
Skip α parameterization entirely. Learn a function that maps the 2-3 corner sensor curves directly to the middle sensor curve. Since corner curves are complete, no extrapolation is needed — just a spatial transfer function.

### 8. Hybrid: Any combination of the above

## Deliverables

### Required Output Files

1. **`tools/drawin-algorithm-search/sweep_results.json`** — Full sweep results for all tested algorithms
2. **`tools/drawin-algorithm-search/best_algorithm.py`** — Clean, documented implementation of the winning algorithm
3. **`tools/drawin-algorithm-search/benchmark.py`** — Benchmark script that runs the full sweep and prints comparison table
4. **`REPORT.md`** — Implementation report with:
   - Algorithms tested and their sweep results
   - Why the winner works
   - Worst-case performance metrics
   - How to port it back to the HTML playground

### Iteration Process

1. Start by porting the data generation model to Python and verifying it matches the JS version
2. Implement the evaluation framework (sweep + metrics)
3. Implement current best (RBF + D/γ correction) as a baseline
4. Try each algorithm idea, running the sweep after each
5. Iterate on the most promising approach until you hit the success criteria or exhaust ideas
6. Write the final report

## Technical Notes

- Use numpy/scipy — they should be available in the sandbox
- No GPU needed — these are small models (200-point curves, <100 training strokes)
- The noise parameter in state is in tenths of percent: `noise=15` means 1.5% noise. The formula is: `noise_amplitude = value * (noise/1000)` where value is the sensor's totalDI
- RNG: use a seedable PRNG (numpy's default_rng with seed 42)
- All curves are 200 points, normalized time [0,1]
- The `detRange` is in mm — the cutoff index is where the actual middle sensor value first exceeds this threshold
