#!/bin/bash
# Cleans a PR review markdown file for GitHub posting.
# Removes preamble, footnotes, and permission-related noise from claude --print output.
# Usage: clean-review-for-github.sh <review-file>
#   Outputs cleaned content to stdout.

set -e

FILE="$1"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
    echo "Usage: clean-review-for-github.sh <review-file>" >&2
    exit 1
fi

awk '
    BEGIN { in_review = 0; skip_tail = 0 }

    # Start capturing at the review header
    /^#+ PR Review:/ { in_review = 1 }

    # Stop at common tail noise patterns
    in_review && /^---$/ && skip_tail { next }
    in_review && /^\*\*(Note|Review Details|To save)/ { skip_tail = 1; next }
    in_review && /^(The restriction prevents|I need to provide|The user needs|I.m unable to write|Let me output|To save this review|Would you like me to write|I.ve completed|Could you please|Please save the review)/ { skip_tail = 1; next }
    in_review && /^```bash$/ && skip_tail { skip_tail = 2; next }
    skip_tail == 2 { if (/^```$/) skip_tail = 1; next }

    # Print lines that are inside the review and not skipped
    in_review && !skip_tail { print }
' "$FILE" | sed -e :a -e '/^[[:space:]]*$/{ $d; N; ba; }'
