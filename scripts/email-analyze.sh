#!/usr/bin/env bash
# Email Analyzer — classify uncategorized emails via claude --print
# Finds parsed emails missing analysis, batches them, and writes results back.
# Called automatically after email-ingest.sh, or standalone.

set -euo pipefail

JARVIS_HOME="${ORCHESTRATOR_HOME:-/home/teruel/JARVIS}"
PMO_ROOT="$JARVIS_HOME/workspaces/strokmatic/pmo"
PROJECT_CODES="$JARVIS_HOME/config/project-codes.json"

WORK_DIR=$(mktemp -d /tmp/email-analyze-XXXXXX)
trap "rm -rf $WORK_DIR" EXIT

echo "=== Email Analysis — $(date -Iseconds) ==="

# Step 1: Find uncategorized emails and build prompt
python3 << 'PYEOF' - "$PMO_ROOT" "$PROJECT_CODES" "$WORK_DIR"
import json, os, sys

pmo_root = sys.argv[1]
codes_path = sys.argv[2]
work_dir = sys.argv[3]

with open(codes_path) as f:
    codes = json.load(f)

emails = []
for code in sorted(codes.keys()):
    index_path = os.path.join(pmo_root, code, "emails", "index.json")
    parsed_dir = os.path.join(pmo_root, code, "emails", "parsed")
    if not os.path.exists(index_path):
        continue
    with open(index_path) as f:
        index = json.load(f)
    for entry in index:
        if entry.get("category"):
            continue
        h = entry["hash"]
        parsed_path = os.path.join(parsed_dir, h[:16] + ".json")
        if not os.path.exists(parsed_path):
            continue
        with open(parsed_path) as pf:
            parsed = json.load(pf)
        analysis = parsed.get("analysis") or {}
        if analysis.get("category"):
            continue
        body = (parsed.get("body_text") or "")[:1500]
        # Clean control characters for safe embedding
        body = body.replace("\r", " ").replace("\x00", "")
        emails.append({
            "code": code,
            "hash": h,
            "parsed_path": parsed_path,
            "subject": entry.get("subject", ""),
            "sender": entry.get("sender_email", ""),
            "date": entry.get("date", ""),
            "body_preview": body
        })

# Save metadata for the apply step
with open(os.path.join(work_dir, "emails.json"), "w") as f:
    json.dump(emails, f, ensure_ascii=False)

if not emails:
    print("No uncategorized emails found. Nothing to do.")
    sys.exit(0)

print(f"Found {len(emails)} uncategorized email(s). Analyzing...")

# Build the prompt
lines = [
    "You are an email classifier for a manufacturing/engineering company (Strokmatic).",
    "Classify each email and extract structured data. Return ONLY a JSON array with one object per email.",
    "",
    "Categories:",
    "- technical: Engineering specs, designs, measurements, test results, technical requirements",
    "- status: Project updates, progress reports, schedule changes, delivery notifications",
    "- discussion: Negotiations, strategy, proposals, meeting scheduling for decisions",
    "- administrative: Calendar invites, NDAs, security forms, auto-replies, signatures, logistics",
    "",
    "For each email, return:",
    '{',
    '  "hash": "<the email hash>",',
    '  "category": "<one of: technical, status, discussion, administrative>",',
    '  "action_items": ["<string>", ...],',
    '  "decisions": ["<string>", ...],',
    '  "technical_notes": ["<string>", ...],',
    '  "key_dates": [{"date": "YYYY-MM-DD", "event": "<description>"}]',
    '}',
    "",
    "Return ONLY the JSON array. No markdown fences, no explanation.",
    "",
    "EMAILS TO CLASSIFY:",
]

for i, e in enumerate(emails):
    lines.append(f"\n--- Email {i+1} ---")
    lines.append(f"Hash: {e['hash']}")
    lines.append(f"Project: {e['code']}")
    lines.append(f"Date: {e['date']}")
    lines.append(f"From: {e['sender']}")
    lines.append(f"Subject: {e['subject']}")
    lines.append(f"Body (preview):\n{e['body_preview']}")

with open(os.path.join(work_dir, "prompt.txt"), "w") as f:
    f.write("\n".join(lines))
PYEOF

# Check if there are emails to process
if [[ ! -f "$WORK_DIR/prompt.txt" ]]; then
    exit 0
fi

# Step 2: Call Claude to classify
echo "Calling Claude (haiku) for classification..."
claude --model haiku --print < "$WORK_DIR/prompt.txt" > "$WORK_DIR/response.txt" 2>/dev/null || {
    echo "ERROR: Claude analysis failed"
    exit 1
}

# Step 3: Apply results back to parsed JSONs and index
python3 << 'PYEOF' - "$WORK_DIR" "$PMO_ROOT"
import json, os, re, sys

work_dir = sys.argv[1]
pmo_root = sys.argv[2]

# Load email metadata
with open(os.path.join(work_dir, "emails.json")) as f:
    emails = json.load(f)

# Parse Claude's response
with open(os.path.join(work_dir, "response.txt")) as f:
    text = f.read().strip()

# Strip markdown fences if present
text = re.sub(r'^```json?\s*', '', text)
text = re.sub(r'\s*```$', '', text)

try:
    results = json.loads(text)
except json.JSONDecodeError as e:
    print(f"ERROR: Claude returned invalid JSON: {e}")
    print(f"Response: {text[:500]}")
    sys.exit(1)

if not isinstance(results, list):
    results = [results]

# Build lookup from hash to result
result_map = {r["hash"]: r for r in results}

# Build lookup from hash to email metadata (has parsed_path and code)
email_map = {e["hash"]: e for e in emails}

# Update parsed JSONs and collect index updates
index_updates = {}  # code -> {hash: category}

for h, meta in email_map.items():
    r = result_map.get(h, {})
    category = r.get("category", "administrative")  # default fallback
    code = meta["code"]
    parsed_path = meta["parsed_path"]

    # Update parsed JSON
    with open(parsed_path) as f:
        parsed = json.load(f)

    parsed["category"] = category
    parsed["analysis"] = {
        "category": category,
        "action_items": r.get("action_items", []),
        "decisions": r.get("decisions", []),
        "technical_notes": r.get("technical_notes", []),
        "key_dates": r.get("key_dates", [])
    }

    with open(parsed_path, "w") as f:
        json.dump(parsed, f, indent=2, ensure_ascii=False)
    print(f"  {os.path.basename(parsed_path)} → {category}")

    if code not in index_updates:
        index_updates[code] = {}
    index_updates[code][h] = category

# Update index files
for code, hash_cats in index_updates.items():
    index_path = os.path.join(pmo_root, code, "emails", "index.json")
    with open(index_path) as f:
        index = json.load(f)

    updated = 0
    for entry in index:
        if entry["hash"] in hash_cats:
            entry["category"] = hash_cats[entry["hash"]]
            updated += 1

    with open(index_path, "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    print(f"  Index {code}: {updated} entries updated")

print(f"Analyzed {len(email_map)} email(s).")
PYEOF

echo "=== Analysis complete — $(date -Iseconds) ==="
