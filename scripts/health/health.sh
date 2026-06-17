#!/bin/bash
# Health Monitor — unified entry point
# Usage: health.sh <product> <deployment> [mode]
#
# Loads config for the given product+deployment, then dispatches to
# core/<mode>.sh passing product and deployment as arguments.
# Default mode: run
#
# Environment overrides (for testing):
#   HEALTH_CORE_DIR   override the core scripts directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Argument validation
if [[ -z "${1:-}" || -z "${2:-}" ]]; then
  echo "Usage: health.sh <product> <deployment> [mode]" >&2
  exit 1
fi

product="$1"
deployment="$2"
mode="${3:-run}"

# Load unified config (exports HEALTH_*, DATA_DIR, REPORT_DIR, etc.)
# shellcheck source=scripts/health/lib/config.sh
source "$SCRIPT_DIR/lib/config.sh"
load_health_config "$product" "$deployment" || exit 1

# Resolve core directory (overridable for tests)
HEALTH_CORE_DIR="${HEALTH_CORE_DIR:-$SCRIPT_DIR/core}"

core_script="$HEALTH_CORE_DIR/$mode.sh"
if [[ ! -f "$core_script" ]]; then
  echo "ERROR: Unknown mode '$mode': $core_script not found" >&2
  exit 1
fi

exec bash "$core_script" "$product" "$deployment"
