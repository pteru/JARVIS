# [4.8] Sealer DB Adoption via sql-vk-common — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use `- [ ]` checkbox tracking.

**Goal:** Adopt body schema as canonical `sql-vk-common`, add `metrics jsonb` migration to `defeitos`/`defeitos_agg`, and create three sealer wrapper stored procedures that map sealer payloads to the common tables. Steel untouched.

**Tech Stack:** PostgreSQL 15-alpine, plpgsql, pytest + testcontainers-postgres.

**Spec:** `docs/superpowers/specs/2026-05-06-sealer-db-schema-design.md`

**Repo path:** `services/setup/infra-structure/postgres/`

**Estimate:** 2d implementation + 1d ajustes (was 4d when had sealer-specific schema). ~18 unit tests.

---

## File Structure (delta from current state)

```
services/setup/infra-structure/postgres/
├── sql-vk-common/                      ← RENAMED from sql-vk-body
│   ├── schema.sql                      (= ex schema_body.sql, unchanged)
│   ├── tables/                         (existing body files, unchanged)
│   ├── functions/                      (existing body fns, unchanged)
│   ├── triggers/                       (existing body triggers, unchanged)
│   ├── procedures/
│   │   └── sealer/                     ← NEW dir
│   │       ├── insert_sealer_frame.sql
│   │       ├── insert_sealer_measurements.sql
│   │       └── insert_sealer_2d_detection.sql
│   ├── migrations/
│   │   └── 2026-05-06-001-add-metrics-jsonb.sql   ← NEW
│   └── seed/
│       └── classe_defeitos_sealer.sql               ← NEW
├── sql-vk-steel/                        ← UNTOUCHED (LEGACY marker only)
│   └── README.md                        ← UPDATED
├── entrypoint.sh                        ← MODIFIED (dispatch sealer/body→common, steel→steel)
└── tests/
    └── sealer-procedures/                ← NEW
        ├── conftest.py
        ├── test_migration.py
        ├── test_insert_sealer_frame.py
        ├── test_insert_sealer_measurements.py
        └── test_insert_sealer_2d_detection.py
```

---

## Task 1 — Rename body → common + migration

- [ ] **Step 1: rename directory**
```bash
cd services/setup/infra-structure/postgres
git mv sql-vk-body sql-vk-common
```

- [ ] **Step 2: write migration `migrations/2026-05-06-001-add-metrics-jsonb.sql`**
```sql
ALTER TABLE defeitos     ADD COLUMN IF NOT EXISTS metrics jsonb;
ALTER TABLE defeitos_agg ADD COLUMN IF NOT EXISTS metrics jsonb;
CREATE INDEX IF NOT EXISTS idx_defeitos_metrics_gin     ON defeitos     USING GIN (metrics);
CREATE INDEX IF NOT EXISTS idx_defeitos_agg_metrics_gin ON defeitos_agg USING GIN (metrics);

-- Track that this migration ran
CREATE TABLE IF NOT EXISTS tbl_schema_migrations (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO tbl_schema_migrations (filename) VALUES ('2026-05-06-001-add-metrics-jsonb.sql')
    ON CONFLICT (filename) DO NOTHING;
```

- [ ] **Step 3: rollback companion `migrations/2026-05-06-001-add-metrics-jsonb.down.sql`**
```sql
ALTER TABLE defeitos     DROP COLUMN IF EXISTS metrics;
ALTER TABLE defeitos_agg DROP COLUMN IF EXISTS metrics;
DROP INDEX IF EXISTS idx_defeitos_metrics_gin;
DROP INDEX IF EXISTS idx_defeitos_agg_metrics_gin;
```

- [ ] **Step 4: update entrypoint.sh** to dispatch by `POSTGRES_DB`:
```bash
case "$POSTGRES_DB" in
    sealer|body|carrocerias)
        SCHEMA_DIR=/sql-vk-common
        ;;
    laminacao|steel)
        SCHEMA_DIR=/sql-vk-steel
        ;;
    *)
        echo "Unknown POSTGRES_DB: $POSTGRES_DB" >&2; exit 1
        ;;
esac

psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$SCHEMA_DIR/schema.sql"

# Apply pending migrations (idempotent via tbl_schema_migrations)
if [ -d "$SCHEMA_DIR/migrations" ]; then
    for migration in $(ls "$SCHEMA_DIR"/migrations/*.sql 2>/dev/null | grep -v '\.down\.sql'); do
        already=$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
                "SELECT 1 FROM tbl_schema_migrations WHERE filename = '$(basename $migration)'" 2>/dev/null || echo "")
        [ -z "$already" ] && psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$migration"
    done
fi

# Sealer-specific procs and seed
if [ "$POSTGRES_DB" = "sealer" ]; then
    for proc in "$SCHEMA_DIR"/procedures/sealer/*.sql; do
        [ -f "$proc" ] && psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$proc"
    done
    [ -f "$SCHEMA_DIR/seed/classe_defeitos_sealer.sql" ] && \
        psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$SCHEMA_DIR/seed/classe_defeitos_sealer.sql"
fi
```

- [ ] **Step 5: mark steel as legacy**
Update `sql-vk-steel/README.md`:
```
## Status: LEGACY (Phase 1)

This schema remains in place for in-production laminacao deployments.
Migration to sql-vk-common is planned for Phase 2 — see backlog item
SCHEMA-MIGRATE-STEEL-TO-COMMON in backlogs/strokmatic/visionking.md.

Do not extend this schema with new features. New profile work goes into
sql-vk-common/.
```

- [ ] **Step 6: update topologies**
- `topologies/sealer-single-node.yaml`: postgres mounts `./sql-vk-common:/sql-vk-common:ro`
- `topologies/carrocerias-single-node.yaml`: same (was `./sql-vk-body`)
- `topologies/laminacao-single-node.yaml`: unchanged

- [ ] **Step 7: smoke test**
```bash
docker run --rm -d --name pg-test -e POSTGRES_PASSWORD=test -p 5433:5432 \
    -v $(pwd)/sql-vk-common:/sql-vk-common:ro \
    -v $(pwd)/entrypoint.sh:/docker-entrypoint-initdb.d/zz-entrypoint.sh:ro \
    -e POSTGRES_DB=body postgres:15-alpine
sleep 5
docker exec pg-test psql -U postgres -d body -c "\d+ defeitos" | grep metrics  # should appear
docker stop pg-test
```

- [ ] **Step 8: commit** `refactor(postgres): rename sql-vk-body → sql-vk-common + metrics jsonb migration`

---

## Task 2 — Sealer-specific seed (classe_defeitos)

- [ ] **Step 1: write `seed/classe_defeitos_sealer.sql`**
```sql
INSERT INTO classe_defeitos (id, defect_class_code, defect_class_name, category_code, status, stop_production_line)
VALUES
    (1000, 'sealer_segment_pass', 'Sealer Segmento OK',     'S', 'Ativo',  false),
    (1001, 'sealer_segment_fail', 'Sealer Segmento Falha',  'S', 'Ativo',  true),
    (1010, 'sealer_bead_pass',    'Sealer Cordão OK',        'S', 'Ativo',  false),
    (1011, 'sealer_bead_fail',    'Sealer Cordão Falha',     'S', 'Ativo',  true),
    (1020, 'bead_present',        'Cordão Presente (2D)',    'S', 'Ativo',  false),
    (1021, 'bead_absent',         'Cordão Ausente (2D)',     'S', 'Ativo',  true)
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: smoke test**
```bash
docker exec pg-test psql -U postgres -d sealer -f /sql-vk-common/seed/classe_defeitos_sealer.sql
docker exec pg-test psql -U postgres -d sealer -c "SELECT id, defect_class_code FROM classe_defeitos WHERE id BETWEEN 1000 AND 1099 ORDER BY id"
```

- [ ] **Step 3: commit** `feat(sealer-db): seed classe_defeitos for sealer (1000-1099 range)`

---

## Task 3 — `insert_sealer_frame` wrapper (TDD)

- [ ] **Step 1: testcontainers fixture** (`tests/sealer-procedures/conftest.py`)
```python
import pytest, psycopg2
from pathlib import Path
from testcontainers.postgres import PostgresContainer

COMMON_DIR = Path(__file__).parents[1] / "sql-vk-common"

@pytest.fixture(scope="session")
def pg_container():
    with PostgresContainer("postgres:15-alpine") as pg:
        yield pg

@pytest.fixture
def db(pg_container):
    conn = psycopg2.connect(pg_container.get_connection_url())
    with conn.cursor() as cur:
        # Apply common schema
        cur.execute((COMMON_DIR / "schema.sql").read_text())
        # Apply migrations
        for mig in sorted((COMMON_DIR / "migrations").glob("*.sql")):
            if "down" not in mig.name:
                cur.execute(mig.read_text())
        # Apply sealer procs + seed
        for proc in sorted((COMMON_DIR / "procedures/sealer").glob("*.sql")):
            cur.execute(proc.read_text())
        cur.execute((COMMON_DIR / "seed/classe_defeitos_sealer.sql").read_text())
        conn.commit()
    yield conn
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    conn.commit()
    conn.close()
```

- [ ] **Step 2: failing tests** (`tests/sealer-procedures/test_insert_sealer_frame.py`)
```python
import json, uuid

def test_creates_type_pecas_and_frame(db):
    payload = {
        "frame_uuid": str(uuid.uuid4()),
        "part_uuid":  str(uuid.uuid4()),
        "vin_number": "KMHXX00XXXX000001",
        "model_type": "CRETA_2026",
        "frame_index": 0,
        "frame_path": "/img_saved/foo.ply",
        "data_type": "pointcloud",
        "camera_serial_number": "HK3D001",
        "captured_at": "2026-05-15T10:30:45.123Z",
        "station_id": "STN-01",
    }
    with db.cursor() as cur:
        cur.execute("SELECT insert_sealer_frame(%s::jsonb)", (json.dumps(payload),))
        # types row created
        cur.execute("SELECT type_code FROM types WHERE type_code = 'CRETA_2026'")
        assert cur.fetchone() is not None
        # pecas row with process_tags
        cur.execute("SELECT process_tags FROM pecas WHERE peca = %s", (payload["part_uuid"],))
        tags = cur.fetchone()[0]
        assert tags["vin_number"] == "KMHXX00XXXX000001"
        assert tags["model_type"] == "CRETA_2026"
        # frames row
        cur.execute("SELECT frame_path FROM frames WHERE frame_uuid = %s", (payload["frame_uuid"],))
        assert cur.fetchone()[0] == "/img_saved/foo.ply"
        # frames_pecas linkage
        cur.execute("SELECT 1 FROM frames_pecas fp JOIN frames f ON fp.frame_id=f.id "
                    "JOIN pecas p ON fp.peca_id=p.id "
                    "WHERE f.frame_uuid=%s AND p.peca=%s",
                    (payload["frame_uuid"], payload["part_uuid"]))
        assert cur.fetchone() is not None

def test_idempotent_on_repeat_call(db):
    """Calling twice with same frame_uuid does not duplicate."""
    ...

def test_reuses_existing_type(db):
    """Pre-insert types row; verify second call doesn't error or duplicate."""
    ...
```

- [ ] **Step 3: implement `procedures/sealer/insert_sealer_frame.sql`**
```sql
CREATE OR REPLACE FUNCTION insert_sealer_frame(payload JSONB) RETURNS void AS $$
DECLARE
    v_part_uuid TEXT := payload->>'part_uuid';
    v_model_type TEXT := payload->>'model_type';
    v_type_id INT;
    v_frame_id BIGINT;
    v_peca_id BIGINT;
BEGIN
    -- 1. UPSERT type
    INSERT INTO types (internal_id, type_code, type_name)
    VALUES (
        COALESCE((SELECT MAX(internal_id) + 1 FROM types), 1),
        v_model_type,
        v_model_type
    )
    ON CONFLICT (type_code) DO NOTHING;
    SELECT internal_id INTO v_type_id FROM types WHERE type_code = v_model_type;

    -- 2. UPSERT peca by peca = part_uuid
    INSERT INTO pecas (id, peca, type_id, process_tags, inserted_at)
    VALUES (
        nextval('peca_seq'),
        v_part_uuid,
        v_type_id,
        jsonb_build_object(
            'vin_number',  payload->>'vin_number',
            'model_type',  v_model_type,
            'station_id',  payload->>'station_id',
            'data_type',   payload->>'data_type'
        ),
        NOW()
    )
    ON CONFLICT (peca) DO NOTHING
    RETURNING id INTO v_peca_id;
    IF v_peca_id IS NULL THEN
        SELECT id INTO v_peca_id FROM pecas WHERE peca = v_part_uuid;
    END IF;

    -- 3. INSERT frame (skip if exists)
    INSERT INTO frames (
        id, frame_uuid, frame_number, frame_path, camera_serial,
        frame_captured_at, host_id, inserted_at
    )
    VALUES (
        nextval('frame_seq'),
        (payload->>'frame_uuid')::uuid,
        (payload->>'frame_index')::int,
        payload->>'frame_path',
        payload->>'camera_serial_number',
        (payload->>'captured_at')::timestamptz,
        COALESCE((payload->>'host_id')::int, 0),
        NOW()
    )
    ON CONFLICT (frame_uuid) DO NOTHING
    RETURNING id INTO v_frame_id;
    IF v_frame_id IS NULL THEN
        SELECT id INTO v_frame_id FROM frames WHERE frame_uuid = (payload->>'frame_uuid')::uuid;
    END IF;

    -- 4. Link frame to peca
    INSERT INTO frames_pecas (frame_id, peca_id)
    VALUES (v_frame_id, v_peca_id)
    ON CONFLICT (frame_id, peca_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 4: commit** `feat(sealer-db): insert_sealer_frame wrapper + tests`

---

## Task 4 — `insert_sealer_measurements` wrapper (TDD, most complex)

- [ ] **Step 1: failing tests** (`tests/sealer-procedures/test_insert_sealer_measurements.py`)
```python
def test_inserts_part_summary_beads_and_segments(db):
    # Pre-create peca via insert_sealer_frame
    insert_frame(db, part_uuid="00...01", model_type="CRETA_2026")

    payload = {
        "part_uuid": "00...01",
        "overall_pass_fail": True,
        "processed_at": "2026-05-15T10:31:02Z",
        "processing_duration_ms": 17345,
        "beads": [
            {
                "bead_name": "left_sill", "bead_pass_fail": True,
                "expected_width_mm": 22.0, "continuity_pct": 95.3,
                "segments": [
                    { "segment_id": 0, "arc_length_mm": 0.0,
                      "width_mm": 4.2, "height_mm": 2.1, "continuity_pct": 95.3,
                      "volume_mm3": 12.4, "position_offset_mm": 0.3, "fit_r2": 0.94,
                      "pass_fail": True, "isolation_method": "ransac-plane", "fit_model": "gaussian" }
                ]
            }
        ]
    }
    with db.cursor() as cur:
        cur.execute("SELECT insert_sealer_measurements(%s::jsonb)", (json.dumps(payload),))

        # pecas updated
        cur.execute("SELECT nao_conforme, qtd_defeitos, inspected_at FROM pecas WHERE peca='00...01'")
        nc, qd, inspect_at = cur.fetchone()
        assert nc is False
        assert qd == 0  # all passed
        assert inspect_at is not None

        # subcomponente created for the bead
        cur.execute("SELECT subcomponente_code FROM subcomponente WHERE subcomponente_code='left_sill'")
        assert cur.fetchone() is not None

        # defeitos_agg row per bead
        cur.execute("""SELECT class_id, metrics FROM defeitos_agg da
                       JOIN pecas p ON da.peca_id=p.id WHERE p.peca='00...01'""")
        rows = cur.fetchall()
        assert len(rows) == 1
        assert rows[0][0] == 1010  # sealer_bead_pass
        assert rows[0][1]["continuity_pct"] == 95.3

        # defeitos rows per segment
        cur.execute("""SELECT class_id, metrics FROM defeitos d
                       JOIN pecas p ON d.peca_id=p.id WHERE p.peca='00...01'""")
        seg_rows = cur.fetchall()
        assert len(seg_rows) == 1
        assert seg_rows[0][0] == 1000  # sealer_segment_pass
        assert seg_rows[0][1]["width_mm"] == 4.2
        assert seg_rows[0][1]["isolation_method"] == "ransac-plane"

def test_reinspection_replaces_beads_segments(db):
    """Run twice with same part_uuid; verify cascade delete + reinsert."""
    ...

def test_overall_fail_aggregates_correctly(db):
    """1 of 2 beads fail; pecas.qtd_defeitos = (count of failed segments)."""
    ...

def test_raises_when_part_missing(db):
    """No peca with part_uuid → exception."""
    ...
```

- [ ] **Step 2: implement `procedures/sealer/insert_sealer_measurements.sql`**
```sql
CREATE OR REPLACE FUNCTION insert_sealer_measurements(payload JSONB) RETURNS void AS $$
DECLARE
    v_part_uuid TEXT := payload->>'part_uuid';
    v_peca_id BIGINT;
    v_type_id INT;
    v_bead JSONB;
    v_segment JSONB;
    v_subcomp_id INT;
    v_agg_id BIGINT;
    v_total_defects INT := 0;
    v_segment_class_id INT;
    v_bead_class_id INT;
BEGIN
    -- 1. Verify peca exists
    SELECT id, type_id INTO v_peca_id, v_type_id FROM pecas WHERE peca = v_part_uuid;
    IF v_peca_id IS NULL THEN
        RAISE EXCEPTION 'Peca % not found (call insert_sealer_frame first)', v_part_uuid;
    END IF;

    -- 2. Reinspection cascade: delete prior defeitos + defeitos_agg for this peca
    DELETE FROM defeitos WHERE peca_id = v_peca_id;
    DELETE FROM defeitos_agg WHERE peca_id = v_peca_id;

    -- 3. Iterate beads
    FOR v_bead IN SELECT * FROM jsonb_array_elements(payload->'beads')
    LOOP
        -- 3a. Get/create subcomponente for bead
        INSERT INTO subcomponente (subcomponente_code, subcomponente_name, type_id)
        VALUES (v_bead->>'bead_name', v_bead->>'bead_name', v_type_id)
        ON CONFLICT (subcomponente_3d_file) DO NOTHING;
        SELECT id INTO v_subcomp_id FROM subcomponente
        WHERE subcomponente_code = (v_bead->>'bead_name') AND type_id = v_type_id
        LIMIT 1;
        IF v_subcomp_id IS NULL THEN
            -- subcomponente_3d_file unique conflict skip; insert without it
            INSERT INTO subcomponente (subcomponente_code, subcomponente_name, type_id)
            VALUES (v_bead->>'bead_name', v_bead->>'bead_name', v_type_id)
            RETURNING id INTO v_subcomp_id;
        END IF;

        -- 3b. Pick bead-level class
        v_bead_class_id := CASE WHEN (v_bead->>'bead_pass_fail')::boolean THEN 1010 ELSE 1011 END;

        -- 3c. INSERT defeitos_agg per bead
        INSERT INTO defeitos_agg (
            id, peca_id, peca, class_id, subcomponente_id, metrics, inserted_at
        )
        VALUES (
            nextval('defeito_seq'),
            v_peca_id,
            v_part_uuid,
            v_bead_class_id,
            v_subcomp_id,
            jsonb_build_object(
                'continuity_pct',     v_bead->>'continuity_pct',
                'expected_width_mm',  v_bead->>'expected_width_mm',
                'bead_pass_fail',     v_bead->>'bead_pass_fail'
            ),
            NOW()
        )
        RETURNING id INTO v_agg_id;

        -- 3d. INSERT defeitos per segment
        FOR v_segment IN SELECT * FROM jsonb_array_elements(v_bead->'segments')
        LOOP
            v_segment_class_id := CASE WHEN (v_segment->>'pass_fail')::boolean THEN 1000 ELSE 1001 END;
            IF NOT (v_segment->>'pass_fail')::boolean THEN
                v_total_defects := v_total_defects + 1;
            END IF;

            INSERT INTO defeitos (
                id, peca_id, peca, class_id, defeito_agg_id, subcomponente_id,
                metrics, inserted_at
            )
            VALUES (
                nextval('defeito_seq'),
                v_peca_id,
                v_part_uuid,
                v_segment_class_id,
                v_agg_id,
                v_subcomp_id,
                jsonb_build_object(
                    'segment_id',         (v_segment->>'segment_id')::int,
                    'arc_length_mm',      (v_segment->>'arc_length_mm')::numeric,
                    'width_mm',           (v_segment->>'width_mm')::numeric,
                    'height_mm',          (v_segment->>'height_mm')::numeric,
                    'continuity_pct',     (v_segment->>'continuity_pct')::numeric,
                    'volume_mm3',         (v_segment->>'volume_mm3')::numeric,
                    'position_offset_mm', (v_segment->>'position_offset_mm')::numeric,
                    'fit_r2',             (v_segment->>'fit_r2')::numeric,
                    'isolation_method',   v_segment->>'isolation_method',
                    'fit_model',          v_segment->>'fit_model',
                    'pass_fail',          (v_segment->>'pass_fail')::boolean
                ),
                NOW()
            );
        END LOOP;
    END LOOP;

    -- 4. UPDATE peca summary fields
    UPDATE pecas SET
        nao_conforme = NOT (payload->>'overall_pass_fail')::boolean,
        qtd_defeitos = v_total_defects,
        inspected_at = (payload->>'processed_at')::timestamptz,
        regras_de_negocio = jsonb_build_object(
            'processing_duration_ms', (payload->>'processing_duration_ms')::int,
            'overall_pass_fail',      (payload->>'overall_pass_fail')::boolean
        ),
        updated_at = NOW()
    WHERE id = v_peca_id;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 3: commit** `feat(sealer-db): insert_sealer_measurements wrapper + tests`

---

## Task 5 — `insert_sealer_2d_detection` wrapper (TDD)

- [ ] **Step 1: failing tests**
```python
def test_inserts_2d_detections(db):
    insert_frame(db, part_uuid="00...01", model_type="CRETA_2026")
    payload = {
        "part_uuid": "00...01",
        "inferred_at": "2026-05-15T10:30:50Z",
        "detections": [
            { "roi_index": 0, "roi_name": "left_sill_front", "presence": True,
              "position_x_px": 1340, "width_px": 87, "confidence": 0.92 },
            { "roi_index": 1, "roi_name": "left_sill_rear", "presence": False,
              "position_x_px": None, "width_px": None, "confidence": 0.0 },
        ],
    }
    with db.cursor() as cur:
        cur.execute("SELECT insert_sealer_2d_detection(%s::jsonb)", (json.dumps(payload),))
        cur.execute("SELECT class_id, metrics FROM defeitos d JOIN pecas p ON d.peca_id=p.id "
                    "WHERE p.peca='00...01' ORDER BY (metrics->>'roi_index')::int")
        rows = cur.fetchall()
        assert len(rows) == 2
        assert rows[0][0] == 1020  # bead_present
        assert rows[0][1]["confidence"] == 0.92
        assert rows[1][0] == 1021  # bead_absent

def test_upsert_replaces_prior_detection(db):
    """Run twice with different presence → only latest persists per (part_uuid, roi_index)."""
    ...
```

- [ ] **Step 2: implement** with delete-by-(peca_id, metrics->>'roi_index') + insert
```sql
CREATE OR REPLACE FUNCTION insert_sealer_2d_detection(payload JSONB) RETURNS void AS $$
DECLARE
    v_part_uuid TEXT := payload->>'part_uuid';
    v_peca_id BIGINT;
    v_detection JSONB;
    v_class_id INT;
BEGIN
    SELECT id INTO v_peca_id FROM pecas WHERE peca = v_part_uuid;
    IF v_peca_id IS NULL THEN
        RAISE EXCEPTION 'Peca % not found', v_part_uuid;
    END IF;

    FOR v_detection IN SELECT * FROM jsonb_array_elements(payload->'detections')
    LOOP
        -- Delete prior detection for same ROI (UPSERT semantics)
        DELETE FROM defeitos
        WHERE peca_id = v_peca_id
          AND class_id BETWEEN 1020 AND 1021
          AND (metrics->>'roi_index')::int = (v_detection->>'roi_index')::int;

        v_class_id := CASE WHEN (v_detection->>'presence')::boolean THEN 1020 ELSE 1021 END;

        INSERT INTO defeitos (
            id, peca_id, peca, class_id, x1, metrics, inserted_at
        )
        VALUES (
            nextval('defeito_seq'),
            v_peca_id,
            v_part_uuid,
            v_class_id,
            (v_detection->>'position_x_px')::numeric,
            jsonb_build_object(
                'roi_index',     (v_detection->>'roi_index')::int,
                'roi_name',      v_detection->>'roi_name',
                'presence',      (v_detection->>'presence')::boolean,
                'confidence',    (v_detection->>'confidence')::numeric,
                'position_x_px', v_detection->>'position_x_px',
                'width_px',      v_detection->>'width_px',
                'inferred_at',   payload->>'inferred_at'
            ),
            NOW()
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 3: commit** `feat(sealer-db): insert_sealer_2d_detection wrapper + tests`

---

## Task 6 — Documentation + backlog + handoff

- [ ] **Step 1: README in sql-vk-common/**
```markdown
# sql-vk-common

Common PostgreSQL schema shared by **body** (carrocerias) and **sealer** profiles.

## Status

- ✅ **Body / Carrocerias** — uses this schema (formerly `sql-vk-body/`)
- ✅ **Sealer** — uses this schema + sealer-specific procedures + seed
- ⏸ **Steel / Laminacao** — still on legacy `sql-vk-steel/`. Migration tracked as `SCHEMA-MIGRATE-STEEL-TO-COMMON` (Phase 2 backlog).

## Sealer-specific extensions

When `POSTGRES_DB=sealer`, the entrypoint also applies:
- `migrations/2026-05-06-001-add-metrics-jsonb.sql` (also applied to body — additive)
- `procedures/sealer/insert_sealer_*.sql`
- `seed/classe_defeitos_sealer.sql` (IDs 1000–1099 reserved for sealer)

## Migrations

Versioned migrations in `migrations/`. Tracked via `tbl_schema_migrations`.
```

- [ ] **Step 2: backlog entry** `backlogs/strokmatic/visionking.md`
```
- [ ] [COMPLEX] SCHEMA-MIGRATE-STEEL-TO-COMMON — Phase 2 epic.
  Migrate sql-vk-steel deployments to sql-vk-common with a steel-tracking
  extension table. Includes rewriting insert_frames_pecas, fn_evaluate_rules,
  fn_return_regras_de_negocio_v3, visionking-result Python queries, and
  backend Sequelize models. Maintenance window required.
  ~3 weeks. Bloqueado até pós-comissionamento 03008.
```

- [ ] **Step 3: changelog entry** via mcp tool

- [ ] **Step 4: commit** `docs(sealer-db): README + backlog SCHEMA-MIGRATE-STEEL-TO-COMMON`

---

## Cross-cutting checks

- All sealer procedures pass with testcontainers postgres
- Body/carrocerias smoke (apply schema fresh; assert no errors)
- Steel topology unchanged (sanity)
- Total of 18+ tests passing

## Definition of done

- All 6 tasks committed
- 18+ tests passing
- Body topology `sql-vk-body/` paths replaced with `sql-vk-common/`
- Steel marked LEGACY via README
- Backlog entry recorded for Phase 2 steel migration
- Changelog entry created
- PR opened on `develop`
