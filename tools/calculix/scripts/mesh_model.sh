#!/bin/bash
# Mesh a GMSH .geo file and export CalculiX .inp mesh
# Usage: ./mesh_model.sh <model_name>
#   e.g.: ./mesh_model.sh cantilever_beam

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="$BASE_DIR/models"

MODEL="${1:?Usage: $0 <model_name>}"
GEO_FILE="$MODELS_DIR/${MODEL}.geo"
MESH_FILE="$MODELS_DIR/${MODEL}_mesh.inp"

if [[ ! -f "$GEO_FILE" ]]; then
    echo "ERROR: Geometry file not found: $GEO_FILE"
    exit 1
fi

echo "=== Meshing $MODEL ==="
echo "Input:  $GEO_FILE"
echo "Output: $MESH_FILE"

gmsh "$GEO_FILE" -3 -format inp -o "$MESH_FILE" -v 2

echo ""
echo "=== Mesh Summary ==="
grep -c "^\*" "$MESH_FILE" 2>/dev/null && true
echo "Nodes:    $(grep -A1 '^\*NODE' "$MESH_FILE" | tail -1 | cut -d',' -f1 | tr -d ' ' || echo 'check file')"
echo "Output:   $MESH_FILE"
echo "=== Done ==="
