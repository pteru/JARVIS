# P7 Downstream Services Spec — Draw-In Prediction Integration

**Status:** Draft
**Depends on:** P7 data-processing implementation (completed)
**Scope:** Backend API, Frontend, DB schema, Inference service

---

## 1. Database Schema

### 1.1 Pre-seed Prediction Field Definitions

The EAV `acquisition` table auto-creates field entries for unknown keys via `process_acquisition_json`. However, pre-seeding gives us control over field metadata.

**Add to `14-ref-fields.sql`:**

```sql
-- P7: Draw-In Prediction fields
(40, 'X_cal_phi_predicted', 'Predicted full phase-domain curve', 'jsonb_array', NULL, NOW(), NOW()),
(41, 'di_predicted',        'Predicted total draw-in',           'numeric',     NULL, NOW(), NOW()),
(42, 'di_x_predicted',      'Predicted X-axis draw-in',          'numeric',     NULL, NOW(), NOW()),
(43, 'stale_idx',           'Phase index where signal went stale','numeric',    NULL, NOW(), NOW()),
(44, 'prediction_confidence','Prediction confidence score',       'numeric',     NULL, NOW(), NOW()),
(45, 'prediction_noise_ratio','Signal noise ratio',               'numeric',     NULL, NOW(), NOW()),
(46, 'prediction_method',    'Prediction algorithm used',         'varchar',     NULL, NOW(), NOW());
```

### 1.2 Prediction Config Table

Already added to `schema.sql` in the data-processing phase. The `prediction_config` table stores per-die sensor role/neighbor mappings. Backend needs a CRUD API for it.

---

## 2. Backend API (`services/backend`)

### 2.1 Expand DRAW_IN_FIELDS

**File:** `src/smart-die/smart-die.service.ts`

Add the new prediction fields to the query field list so they are returned in API responses:

```typescript
const DRAW_IN_FIELDS = [
  // ... existing fields ...
  'X_cal_phi_predicted',
  'di_predicted',
  'di_x_predicted',
  'stale_idx',
  'prediction_confidence',
  'prediction_noise_ratio',
  'prediction_method',
];
```

### 2.2 Update TypeScript Interfaces

**File:** `src/smart-die/interfaces/smart-die.interface.ts`

```typescript
// P7: Prediction fields (optional — only present for middle sensors with prediction)
X_cal_phi_predicted?: number[];
di_predicted?: number;
di_x_predicted?: number;
stale_idx?: number;
prediction_confidence?: number;
prediction_noise_ratio?: number;
prediction_method?: string;
```

### 2.3 Prediction Config CRUD

**New endpoint group:** `/api/prediction-config`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/prediction-config/:dieId` | Get prediction config for a die |
| PUT | `/api/prediction-config/:dieId` | Update sensor roles and neighbors |
| POST | `/api/prediction-config/:dieId/upload-model` | Upload training model JSON |

The PUT endpoint accepts:
```json
{
  "sensors": [
    {"sensor_name": "DP01", "role": "corner", "neighbor_sensors": null},
    {"sensor_name": "DP02", "role": "middle", "neighbor_sensors": ["DP01", "DP03"]},
    {"sensor_name": "DP03", "role": "corner", "neighbor_sensors": null}
  ]
}
```

---

## 3. Frontend (`services/frontend`)

### 3.1 Hybrid Curve Rendering

**Component:** Draw-in chart panel (Plotly)

For sensors with prediction data:
- **Solid line (0 to stale_idx):** Real measured data (`X_cal_phi[0:stale_idx]`)
- **Dashed line (stale_idx to 1000):** Predicted data (`X_cal_phi_predicted[stale_idx:]`)
- **Vertical marker at stale_idx:** Indicates where prediction begins
- **Color coding:** Use sensor's existing color, dashed style for predicted region

```typescript
// Trace for real data
{ x: phi.slice(0, stale_idx), y: X_cal_phi.slice(0, stale_idx),
  mode: 'lines', line: { color: sensorColor, width: 2 } }

// Trace for predicted data
{ x: phi.slice(stale_idx), y: X_cal_phi_predicted.slice(stale_idx),
  mode: 'lines', line: { color: sensorColor, width: 2, dash: 'dash' } }
```

### 3.2 Confidence Badge

Display prediction confidence alongside the sensor label:
- **Green badge (≥ 0.7):** High confidence
- **Yellow badge (0.4–0.7):** Medium confidence
- **Red badge (< 0.4):** Low confidence — treat prediction with caution

### 3.3 Stale Marker

Add a vertical dashed line at `stale_idx` on the φ-domain chart with tooltip: "Signal stale at φ={stale_idx}".

### 3.4 Prediction Summary Card

New card in the sensor detail panel:
- `di_predicted` vs `di` (truncated): shows the correction magnitude
- `prediction_method`: algorithm name
- `prediction_confidence`: colored indicator
- `prediction_noise_ratio`: data quality metric

### 3.5 Prediction Config UI

Admin panel to configure sensor roles per die:
- Table showing all DRAWIN sensors for the selected die
- Dropdown for role (corner/middle)
- Multi-select for neighbors (only shown for middle sensors)
- Upload button for training model JSON files

---

## 4. Inference Integration

### 4.1 Complete Stroke Publication

The inference service (`services/inference`) consumes from `inference-queue` and requires complete stroke data (all sensors, full curves).

**Current limitation:** Middle sensors have truncated curves → inference model receives incomplete input.

**With P7:** After prediction completes, publish a composite message to `inference-queue`:

```json
{
  "die_id": 1,
  "stroke_timestamp": "2025-03-13 23:21:26.078",
  "sensors": {
    "DP01": { "X_cal_phi": [...], "di": 5.2, "role": "corner", "source": "measured" },
    "DP02": { "X_cal_phi": [...], "di": 95.4, "role": "middle", "source": "predicted",
              "stale_idx": 650, "confidence": 0.87 },
    "DP03": { "X_cal_phi": [...], "di": 8.1, "role": "corner", "source": "measured" }
  }
}
```

**Implementation:** Add this publication in `_run_prediction()` after all middle sensor predictions complete. Requires `inference-queue` to be declared in the pipeline (currently only `pd-queue` and `dw-smart-die-queue` are declared).

### 4.2 Model Training Data Feedback Loop

As production strokes accumulate, corner sensors provide ground truth for the stroke progress (α). Strokes where middle sensors had **no stale point** (signal active throughout) can be added to the training shape library to improve future predictions.

**Proposed workflow:**
1. Database-writer stores all strokes
2. Periodic batch job queries strokes where middle sensor `stale_idx IS NULL`
3. Extract shape = X_cal_phi / di, resample to 200 points on α grid
4. Append to training model JSON → reload to Redis DB7 via loader

This is a future enhancement — not required for initial deployment.

---

## 5. Implementation Priority

| Priority | Service | Scope | Effort |
|----------|---------|-------|--------|
| 1 | Backend | Expand DRAW_IN_FIELDS + TS interfaces | Small |
| 2 | DB | Pre-seed field definitions | Small |
| 3 | Frontend | Hybrid curve rendering + stale marker | Medium |
| 4 | Frontend | Confidence badge + summary card | Small |
| 5 | Backend | Prediction config CRUD API | Medium |
| 6 | Frontend | Prediction config admin UI | Medium |
| 7 | Inference | Complete stroke publication | Medium |
| 8 | Inference | Training data feedback loop | Large (future) |

---

## 6. Testing Considerations

- **Backend:** Add unit tests for new fields in smart-die.service spec
- **Frontend:** Playwright E2E tests for hybrid chart rendering (extend existing monitoring spec)
- **Integration:** Extend E2E `tests/e2e/` to verify prediction messages flow through database-writer and appear in API responses
- **Seed data:** Add prediction fixture data to E2E seed scripts (truncated middle sensor + corner sensors for same stroke)
