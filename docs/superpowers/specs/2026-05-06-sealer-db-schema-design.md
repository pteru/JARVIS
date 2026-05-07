# [4.8] Sealer DB Adoption via sql-vk-common — Design Spec

> **Profile**: `vk-sealer`
> **Project**: 03008 — Hyundai Piracicaba
> **Backlog**: SEALER-DB-ADOPTION (NEW, identified 2026-05-06)
> **Date**: 2026-05-06 (revised after schema convergence analysis)
> **Status**: Draft

---

## 1. Overview

**Strategic decision (B-light)**: instead of creating a sealer-specific schema, sealer adopts the existing **body schema as the canonical "common" schema** across visionking profiles. Body schema is renamed `sql-vk-body/` → `sql-vk-common/` (its design with `process_tags` jsonb already targets multi-profile reuse). Sealer adds **one migration** (two `metrics jsonb` columns) and a small set of **wrapper stored procedures** that adapt sealer messages to existing common tables.

This is **stage 1 of a 3-stage path** to a unified schema (target = "Caminho A"):

| Stage | Scope | When |
|---|---|---|
| **M1 — sealer + body unified** | rename body → common; add metrics jsonb; sealer wrappers | **NOW (this spec)** |
| **M2 — steel migration** | extract steel-specific tracking to extension table; rewrite functions/queries | Phase 2 (post-comissionamento) — backlog `SCHEMA-MIGRATE-STEEL-TO-COMMON` |
| **M3 — cleanup** | deprecate extensions where possible; standardize naming | Phase 2+ |

Steel is **untouched** in M1 — zero production risk.

---

## 2. Sealer ↔ Common Schema Mapping

| Sealer concept | Common table | How it's stored |
|---|---|---|
| **Part (vehicle body)** | `pecas` | `peca = part_uuid`; `process_tags = {"vin_number": "...", "model_type": "CRETA_2026"}`; `type_id` → `types` |
| **Vehicle model** | `types` | `type_code = "CRETA_2026"`, `type_name = "Hyundai Creta 2026"` |
| **Bead (left_sill, right_sill)** | `subcomponente` | `subcomponente_code = "left_sill"`, `subcomponente_3d_file = "/config/sealer/{model}/part.stl"`, `type_id` → `types` |
| **Frame** | `frames` | unchanged structure; `frame_path` points to `.ply` / `.bin` / `.png` |
| **Inspection rollup (overall pass/fail)** | `pecas.nao_conforme`, `qtd_defeitos`, `parada_linha` | already exist; `pecas.regras_de_negocio` jsonb captures detail |
| **Bead-level pass/fail + continuity** | `defeitos_agg` | `class_id` references `classe_defeitos` (sealer-specific entries); `metrics` jsonb stores aggregates `{"continuity_pct": 95.3, "passed_segments": 80, "total_segments": 80, "expected_width_mm": 22.0}` |
| **Per-segment 3D measurement** | `defeitos` | `class_id` → sealer measurement class; `position_3d_ct` is segment center; `metrics` jsonb stores `{"width_mm": 4.2, "height_mm": 2.1, "continuity_pct": 95.3, "volume_mm3": 12.4, "position_offset_mm": 0.3, "fit_r2": 0.94, "isolation_method": "ransac-plane", "fit_model": "gaussian", "arc_length_mm": 0.0, "segment_id": 0}` |
| **2D ROI detection (presence/position/width)** | `defeitos` | `class_id` → sealer 2D class (`bead_present` / `bead_absent`); `position` is bbox; `metrics` jsonb stores `{"presence": true, "confidence": 0.92, "position_x_px": 1340, "width_px": 87, "roi_index": 0, "roi_name": "left_sill_front"}` |

**Net result**: zero new tables. Everything sealer needs maps cleanly into 3 existing common tables (`pecas`, `defeitos_agg`, `defeitos`) plus configuration (`types`, `subcomponente`, `classe_defeitos`).

---

## 3. Schema Changes (the only DDL change)

```sql
-- migrations/2026-05-06-add-metrics-jsonb.sql
ALTER TABLE defeitos     ADD COLUMN IF NOT EXISTS metrics jsonb;
ALTER TABLE defeitos_agg ADD COLUMN IF NOT EXISTS metrics jsonb;

-- For efficient sealer queries (e.g., width_mm < 3 across all segments)
CREATE INDEX IF NOT EXISTS idx_defeitos_metrics_gin ON defeitos USING GIN (metrics);
```

Backwards compatible: existing body insert paths produce `metrics IS NULL` rows, which is fine.

---

## 4. Sealer-specific stored procedures (wrappers)

All live in `sql-vk-common/procedures/sealer/`. They translate sealer payloads into INSERTs against common tables.

### 4.1 `insert_sealer_frame(jsonb)`

Same role as the existing `insert_frames_pecas_v2` for body, but accepts the simpler sealer message shape:

```json
{
  "frame_uuid": "...",
  "part_uuid": "...",
  "vin_number": "KMHXX00XXXX000001",
  "model_type": "CRETA_2026",
  "frame_index": 0,
  "frame_path": "/img_saved/.../hash.ply",
  "data_type": "pointcloud",
  "camera_serial_number": "HK3D001",
  "captured_at": "2026-05-15T10:30:45.123Z",
  "station_id": "STN-01"
}
```

**Behavior**:
1. UPSERT `types` (if not present, insert with `type_code = model_type`)
2. UPSERT `pecas` by `peca = part_uuid`:
   ```sql
   process_tags = jsonb_build_object(
       'vin_number', payload->>'vin_number',
       'model_type', payload->>'model_type',
       'station_id', payload->>'station_id',
       'data_type',  payload->>'data_type'
   )
   type_id = (SELECT internal_id FROM types WHERE type_code = payload->>'model_type')
   ```
3. INSERT `frames` (if frame_uuid unique)
4. INSERT `frames_pecas`

### 4.2 `insert_sealer_measurements(jsonb)`

Sealer payload shape (per SEALER-03 spec):

```json
{
  "part_uuid": "...",
  "overall_pass_fail": true,
  "processed_at": "...",
  "processing_duration_ms": 17345,
  "beads": [
    {
      "bead_name": "left_sill",
      "bead_pass_fail": true,
      "expected_width_mm": 22.0,
      "continuity_pct": 95.3,
      "segments": [...]
    }
  ]
}
```

**Behavior** (single transaction):
1. Verify `pecas.peca = part_uuid` exists → raise if not
2. UPDATE `pecas` overall fields:
   - `nao_conforme = NOT overall_pass_fail`
   - `inspected_at = processed_at`
   - `qtd_defeitos = (sum of failed segments)`
   - `regras_de_negocio = jsonb_build_object('processing_duration_ms', ..., 'beads_summary', ...)`
3. DELETE existing `defeitos_agg` and `defeitos` for this part (reinspection cascade)
4. For each bead:
   - Get/create `subcomponente` row by `subcomponente_code = bead_name`, `type_id` from peças
   - Get/create `classe_defeitos` for sealer bead-level (e.g., `defect_class_code = 'sealer_bead_pass'` / `'sealer_bead_fail'`)
   - INSERT `defeitos_agg` with `class_id`, `subcomponente_id`, `peca_id`, `peca`, `metrics = jsonb_build_object('continuity_pct', ..., 'expected_width_mm', ..., 'passed_segments', ..., 'total_segments', ...)`
   - For each segment: INSERT `defeitos` with `defeito_agg_id`, `class_id` (sealer segment), `subcomponente_id`, `position_3d_ct = [x, y, z]` (centroid), `metrics = jsonb_build_object('width_mm', ..., 'height_mm', ..., 'continuity_pct', ..., 'volume_mm3', ..., 'position_offset_mm', ..., 'fit_r2', ..., 'isolation_method', ..., 'fit_model', ..., 'arc_length_mm', ..., 'segment_id', ..., 'pass_fail', ...)`

### 4.3 `insert_sealer_2d_detection(jsonb)`

```json
{
  "part_uuid": "...",
  "inferred_at": "...",
  "detections": [
    { "roi_index": 0, "roi_name": "left_sill_front",
      "presence": true, "position_x_px": 1340, "width_px": 87, "confidence": 0.92 }
  ]
}
```

**Behavior**:
1. Verify `pecas.peca = part_uuid` exists
2. For each detection:
   - DELETE prior detection for same (part_uuid, roi_index) — UPSERT semantics
   - Get/create `subcomponente` for the bead (looked up by ROI metadata, or stored in roi config)
   - Get/create `classe_defeitos`: `bead_present` (id reserved range) or `bead_absent`
   - INSERT `defeitos`:
     - `class_id` = present/absent class
     - `position` = bbox (read from runtime ROI config if needed)
     - `x1, y1, x2, y2` = bbox coords
     - `metrics = jsonb_build_object('roi_index', ..., 'roi_name', ..., 'presence', ..., 'confidence', ..., 'position_x_px', ..., 'width_px', ..., 'inferred_at', ...)`

---

## 5. Sealer-specific seed data

Sealer adds rows to `classe_defeitos` (used to distinguish 2D detection vs 3D measurement vs pass/fail rollups):

| `id` | `defect_class_code` | `defect_class_name` | Used by |
|---|---|---|---|
| 1000 | `sealer_segment_pass` | Sealer Segmento OK | `insert_sealer_measurements` (per-segment row) |
| 1001 | `sealer_segment_fail` | Sealer Segmento Falha | `insert_sealer_measurements` |
| 1010 | `sealer_bead_pass` | Sealer Cordão OK | `insert_sealer_measurements` (defeitos_agg per bead) |
| 1011 | `sealer_bead_fail` | Sealer Cordão Falha | `insert_sealer_measurements` |
| 1020 | `bead_present` | Cordão Presente (2D) | `insert_sealer_2d_detection` |
| 1021 | `bead_absent` | Cordão Ausente (2D) | `insert_sealer_2d_detection` |

Reserve 1000–1099 in `classe_defeitos.id` for sealer; existing body/steel use lower ranges.

---

## 6. Directory Structure

```
services/setup/infra-structure/postgres/
├── sql-vk-common/                  ← RENAMED from sql-vk-body
│   ├── schema.sql                  (= ex schema_body.sql)
│   ├── tables/                     (already exists)
│   ├── functions/                  (already exists, body fns)
│   ├── triggers/                   (already exists)
│   ├── procedures/
│   │   └── sealer/                 ← NEW dir
│   │       ├── insert_sealer_frame.sql
│   │       ├── insert_sealer_measurements.sql
│   │       └── insert_sealer_2d_detection.sql
│   ├── migrations/
│   │   └── 2026-05-06-001-add-metrics-jsonb.sql   ← NEW
│   └── seed/
│       └── classe_defeitos_sealer.sql              ← NEW
├── sql-vk-steel/                   ← UNTOUCHED (will migrate in M2)
│   └── README.md                   ← UPDATED: "LEGACY. Migration to sql-vk-common pending (Phase 2 backlog: SCHEMA-MIGRATE-STEEL-TO-COMMON)"
└── (NO sql-vk-sealer/ — sealer uses sql-vk-common entirely)
```

---

## 7. Setup / Entrypoint Update

`services/setup/infra-structure/postgres/entrypoint.sh`:

```bash
case "$POSTGRES_DB" in
    sealer|body|carrocerias)
        SCHEMA_DIR=/sql-vk-common
        ;;
    laminacao|steel)
        SCHEMA_DIR=/sql-vk-steel
        ;;
esac

psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$SCHEMA_DIR/schema.sql"

# Apply migrations
for migration in "$SCHEMA_DIR"/migrations/*.sql; do
    [ -f "$migration" ] && psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$migration"
done

# Sealer-specific procedures and seed (only when DB is sealer)
if [ "$POSTGRES_DB" = "sealer" ]; then
    for proc in "$SCHEMA_DIR"/procedures/sealer/*.sql; do
        psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$proc"
    done
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$SCHEMA_DIR/seed/classe_defeitos_sealer.sql"
fi
```

Body and carrocerias deployments switch from `sql-vk-body/` to `sql-vk-common/` (path change only — schema content identical until migration runs, which is also a no-op for them since `metrics jsonb` is nullable).

---

## 8. Topology Update

`topologies/sealer-single-node.yaml`:
```yaml
infrastructure:
  postgres:
    env_overrides:
      POSTGRES_DB: sealer
    volumes:
      - ./sql-vk-common:/sql-vk-common:ro
```

`topologies/carrocerias-single-node.yaml`:
```yaml
infrastructure:
  postgres:
    volumes:
      - ./sql-vk-common:/sql-vk-common:ro    # was ./sql-vk-body
```

`topologies/laminacao-single-node.yaml`: **unchanged** (still mounts `sql-vk-steel/`).

---

## 9. Migration / Rollback

**On a fresh sealer deployment**: nothing special — schema applies clean.

**On an existing body deployment**: run the `metrics jsonb` migration (additive, nullable, zero downtime).

**Rollback**: `ALTER TABLE defeitos DROP COLUMN metrics; ALTER TABLE defeitos_agg DROP COLUMN metrics;` — safe because no body code references the column.

---

## 10. Phase 2 Plan (out of scope for this spec, recorded for context)

Backlog item: **`SCHEMA-MIGRATE-STEEL-TO-COMMON`** (epic, ~3 weeks)

1. Create extension table `pecas_steel_tracking` in `sql-vk-common/extensions/steel/`
2. Migrate steel-specific columns from `pecas` (corrida_id, barra_id, etc.) to extension via data migration script
3. Rewrite `insert_frames_pecas` (steel) to use process_tags + extension (analog to body's `insert_frames_pecas_v2`)
4. Rewrite `fn_evaluate_rules`, `fn_return_regras_de_negocio_v3`, `fn_process_regras_complete_batch` to query process_tags + extension
5. Update `visionking-result` (laminação) Python queries
6. Update `backend` (laminacao) Sequelize models / queries
7. Switch laminacao topology to `sql-vk-common/`
8. Production cutover (maintenance window required)

---

## 11. Out of Scope

- Steel migration (M2 — separate epic)
- Time-series partitioning of `defeitos` (deferred regardless of profile)
- GIN index optimization for sealer-specific queries beyond the basic one (revisit when query patterns observed in production)
- Material catalog migration — `materiais` (steel) becomes a profile of `types`; covered in M2

---

## 12. References

- `services/setup/infra-structure/postgres/sql-vk-body/schema_body.sql` — current body schema (will become common)
- `services/setup/infra-structure/postgres/sql-vk-body/functions/fn_insere_frames_body_v2.sql` — pattern for sealer wrappers
- SEALER-03 spec — output schema producer (input to `insert_sealer_measurements`)
- [4.10] db-writer mode sealer spec — calls these wrappers
- [4.11] 2D inference spec — produces input for `insert_sealer_2d_detection`
- Backlog: `SCHEMA-MIGRATE-STEEL-TO-COMMON` (Phase 2 epic)
