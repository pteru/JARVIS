#!/usr/bin/env bash
# lib/checks.sh — config-driven check evaluation engine
#
# evaluate_checks <snapshot_json> <config_json>
#
# Reads config checks[] (field, direction, warn, crit, label) and snapshot metrics{}.
# For each check, matches metric keys by:
#   K == F  OR  K matches ^node\.[^.]+\.<F with dots escaped>$
# Prints one TSV line per matched metric:
#   severity<TAB>label<TAB>metric_key<TAB>value<TAB>warn/crit
# If no metric key matches, prints:
#   unknown<TAB>label<TAB>field<TAB><TAB>
# Verdicts:
#   high: value>=crit → crit; value>=warn → warn; else ok
#   low:  value<=crit → crit; value<=warn → warn; else ok

evaluate_checks() {
  local snap="$1" cfg="$2"
  local n; n=$(jq '.checks|length' "$cfg")
  for ((i=0; i<n; i++)); do
    local field dir warn crit label
    field=$(jq -r ".checks[$i].field" "$cfg")
    dir=$(jq -r ".checks[$i].direction" "$cfg")
    warn=$(jq -r ".checks[$i].warn" "$cfg")
    crit=$(jq -r ".checks[$i].crit" "$cfg")
    label=$(jq -r ".checks[$i].label" "$cfg")

    # Escape dots for regex, then build pattern that allows optional node.<name>. prefix
    local esc="${field//./\\.}"
    local rx="^(node\\.[^.]+\\.)?${esc}$"

    local matches
    matches=$(jq -r --arg rx "$rx" \
      '.metrics|to_entries[]|select(.key|test($rx))|"\(.key)\t\(.value)"' "$snap")

    if [[ -z "$matches" ]]; then
      printf 'unknown\t%s\t%s\t\t\n' "$label" "$field"
      continue
    fi

    while IFS=$'\t' read -r key val; do
      local sev
      sev=$(awk -v v="$val" -v w="$warn" -v c="$crit" -v d="$dir" 'BEGIN{
        if (d == "high") { print (v >= c) ? "crit" : ((v >= w) ? "warn" : "ok") }
        else             { print (v <= c) ? "crit" : ((v <= w) ? "warn" : "ok") }
      }')
      printf '%s\t%s\t%s\t%s\t%s/%s\n' "$sev" "$label" "$key" "$val" "$warn" "$crit"
    done <<< "$matches"
  done
}
