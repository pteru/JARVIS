#!/bin/bash
# Run a CalculiX analysis
# Usage: ./run_analysis.sh <input_file_without_extension>
#   e.g.: ./run_analysis.sh cantilever_static

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="$BASE_DIR/models"
RESULTS_DIR="$BASE_DIR/results"

INPUT="${1:?Usage: $0 <input_name>}"
INPUT_FILE="$MODELS_DIR/${INPUT}.inp"

if [[ ! -f "$INPUT_FILE" ]]; then
    echo "ERROR: Input file not found: $INPUT_FILE"
    exit 1
fi

# Create results subdirectory
mkdir -p "$RESULTS_DIR/$INPUT"

echo "=== Running CalculiX: $INPUT ==="
echo "Input: $INPUT_FILE"
echo ""

# Run CCX (it reads <name>.inp and writes <name>.frd, <name>.dat etc.)
cd "$MODELS_DIR"
ccx "$INPUT" 2>&1 | tee "$RESULTS_DIR/$INPUT/solver.log"

# Move result files to results directory
for ext in frd dat sta cvg; do
    if [[ -f "$MODELS_DIR/${INPUT}.${ext}" ]]; then
        mv "$MODELS_DIR/${INPUT}.${ext}" "$RESULTS_DIR/$INPUT/"
        echo "Moved: ${INPUT}.${ext} -> results/$INPUT/"
    fi
done

echo ""
echo "=== Results in: $RESULTS_DIR/$INPUT/ ==="
ls -lh "$RESULTS_DIR/$INPUT/"
