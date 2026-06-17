#!/bin/bash
# Health Monitor — Daily trend aggregation (generic)
# Reads all snapshots from today, computes per-metric trends (min/max/avg),
# and saves to $DATA_DIR/<utc-date>/trends.json.
# Also applies snapshot retention: deletes date-dirs older than
# snapshot_retention_days (config, default 90), compared lexicographically.
#
# Usage: trends.sh <product> <deployment>
#
# Interfaces:
#   Consumes: lib/config.sh (load_health_config → DATA_DIR, CONFIG_FILE)
#   Reads:    $DATA_DIR/<utc-date>/snapshot-*.json
#   Writes:   $DATA_DIR/<utc-date>/trends.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../lib"

# shellcheck source=../lib/config.sh
source "$LIB_DIR/config.sh"
load_health_config "${1:?product required}" "${2:?deployment required}"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] [trends] $*" >&2; }

TODAY=$(date -u +%Y-%m-%d)
SNAPSHOT_DIR="$DATA_DIR/$TODAY"

# ---------------------------------------------------------------------------
# Validate snapshot directory
# ---------------------------------------------------------------------------
if [[ ! -d "$SNAPSHOT_DIR" ]]; then
  log "No snapshot directory for today: $SNAPSHOT_DIR"
  exit 0
fi

mapfile -t SNAPSHOT_FILES < <(ls "$SNAPSHOT_DIR"/snapshot-*.json 2>/dev/null || true)
SNAPSHOT_COUNT=${#SNAPSHOT_FILES[@]}

if [[ "$SNAPSHOT_COUNT" -eq 0 ]]; then
  log "No snapshots found in $SNAPSHOT_DIR"
  exit 0
fi

log "Processing $SNAPSHOT_COUNT snapshot(s) for $TODAY"

# ---------------------------------------------------------------------------
# Collect all metric keys across all snapshots (union of all keys)
# ---------------------------------------------------------------------------
METRIC_KEYS=$(
  for f in "${SNAPSHOT_FILES[@]}"; do
    jq -r '.metrics // {} | keys[]' "$f" 2>/dev/null || true
  done | sort -u
)

if [[ -z "$METRIC_KEYS" ]]; then
  log "No metrics found in snapshots — writing empty trends"
fi

# ---------------------------------------------------------------------------
# Compute min/max/avg for each metric key
# ---------------------------------------------------------------------------
# Build the metrics object incrementally as a JSON string via jq
METRICS_JSON='{}'

while IFS= read -r metric_key; do
  [[ -z "$metric_key" ]] && continue

  # Collect numeric values for this key across all snapshots
  values=()
  for f in "${SNAPSHOT_FILES[@]}"; do
    val=$(jq -r --arg k "$metric_key" '.metrics[$k] // empty' "$f" 2>/dev/null || true)
    if [[ -n "$val" && "$val" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then
      values+=("$val")
    fi
  done

  if [[ ${#values[@]} -eq 0 ]]; then
    # Key exists but no numeric values — skip
    continue
  fi

  # Compute min/max/avg/samples with awk; output as JSON fragment
  stats=$(printf '%s\n' "${values[@]}" | awk '
    BEGIN { min=1e18; max=-1e18; sum=0; n=0 }
    {
      val = $1 + 0;
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
      n++;
    }
    END {
      # Round avg to 2 decimal places then strip trailing zeros
      avg = sum / n;
      printf "{\"min\": %g, \"max\": %g, \"avg\": %g, \"samples\": %d}\n",
             min, max, avg, n
    }
  ')

  # Merge into running METRICS_JSON
  METRICS_JSON=$(echo "$METRICS_JSON" | jq \
    --arg k "$metric_key" \
    --argjson v "$stats" \
    '. + {($k): $v}')
done <<< "$METRIC_KEYS"

# ---------------------------------------------------------------------------
# Build and save the full trends document
# ---------------------------------------------------------------------------
TRENDS_FILE="$SNAPSHOT_DIR/trends.json"

jq -n \
  --arg date "$TODAY" \
  --arg id "$HEALTH_DEPLOYMENT" \
  --argjson count "$SNAPSHOT_COUNT" \
  --argjson metrics "$METRICS_JSON" \
  '{
    meta: {
      deployment_id: $id,
      date: $date,
      snapshot_count: $count,
      generated_at: (now | todate)
    },
    metrics: $metrics
  }' > "$TRENDS_FILE"

log "Trends saved to $TRENDS_FILE"

# ---------------------------------------------------------------------------
# Snapshot retention: delete date-dirs older than snapshot_retention_days
# ---------------------------------------------------------------------------
RETENTION_DAYS=$(jq -r '.snapshot_retention_days // 90' "$CONFIG_FILE" 2>/dev/null)
RETENTION_DAYS="${RETENTION_DAYS:-90}"

CUTOFF_DATE=$(date -u -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null \
           || date -u -v-${RETENTION_DAYS}d +%Y-%m-%d 2>/dev/null \
           || true)

if [[ -z "$CUTOFF_DATE" ]]; then
  log "WARNING: Could not compute retention cutoff date — skipping cleanup"
else
  DELETED_COUNT=0
  for dir in "$DATA_DIR"/????-??-??; do
    [[ ! -d "$dir" ]] && continue
    dir_date=$(basename "$dir")
    # YYYY-MM-DD sorts lexicographically — no date arithmetic needed
    if [[ "$dir_date" < "$CUTOFF_DATE" ]]; then
      log "Deleting expired snapshot directory: $dir (${dir_date} < ${CUTOFF_DATE})"
      rm -rf "$dir"
      DELETED_COUNT=$((DELETED_COUNT + 1))
    fi
  done

  if [[ "$DELETED_COUNT" -gt 0 ]]; then
    log "Retention cleanup: deleted $DELETED_COUNT dir(s) older than $CUTOFF_DATE"
  else
    log "Retention cleanup: no directories older than $CUTOFF_DATE"
  fi
fi

log "Trend aggregation complete for ${HEALTH_PRODUCT}/${HEALTH_DEPLOYMENT}"
