"""Parsers for extracting structured data from review markdown files.

Matches the format produced by the PR review service:
  # PR Review: repo-name#123
  **Title:** ...
  **Reviewed:** 2026-03-12T10:00:00-03:00
  **Complexity:** medium

  ## Summary
  ...

  ## Findings
  ### Critical
  ...
  ### Warnings
  ...
  ### Suggestions
  ...

  ## Verdict
  **APPROVE WITH COMMENTS**
  ...
"""

from __future__ import annotations

import re


def parse_verdict(content: str) -> str | None:
    """Extract the verdict from the ## Verdict section.

    Looks for patterns like:
      **APPROVE**
      **APPROVE WITH COMMENTS**
      **CHANGES REQUESTED**
      APPROVE
      CHANGES REQUESTED
    """
    verdict_section = _extract_section(content, "Verdict")
    if not verdict_section:
        return None

    # Try bold format first: **APPROVE WITH COMMENTS**
    match = re.search(
        r"\*\*(APPROVE WITH COMMENTS|CHANGES REQUESTED|APPROVE)\*\*",
        verdict_section,
        re.IGNORECASE,
    )
    if match:
        return match.group(1).upper()

    # Try plain text
    match = re.search(
        r"^(APPROVE WITH COMMENTS|CHANGES REQUESTED|APPROVE)",
        verdict_section,
        re.IGNORECASE | re.MULTILINE,
    )
    if match:
        return match.group(1).upper()

    return None


def parse_summary(content: str) -> str | None:
    """Extract the ## Summary section content."""
    return _extract_section(content, "Summary")


def parse_complexity(content: str) -> str | None:
    """Extract the **Complexity:** field from the header."""
    match = re.search(r"\*\*Complexity:\*\*\s*(\S+)", content)
    if match:
        return match.group(1).lower()
    return None


def parse_findings(content: str) -> dict[str, int]:
    """Count findings in each subsection of ## Findings.

    Returns dict with keys: critical, warnings, suggestions.
    Counts bullet points (lines starting with - or *) in each subsection.
    """
    findings_section = _extract_section(content, "Findings")
    if not findings_section:
        return {"critical": 0, "warnings": 0, "suggestions": 0}

    result = {}
    for subsection_name, key in [
        ("Critical", "critical"),
        ("Warnings", "warnings"),
        ("Suggestions", "suggestions"),
    ]:
        subsection = _extract_subsection(findings_section, subsection_name)
        if not subsection:
            result[key] = 0
            continue

        # Check for "None" or "No issues" indicators
        stripped = subsection.strip()
        if re.match(r"^(None|No\s|N/A|—|-\s*None)", stripped, re.IGNORECASE):
            result[key] = 0
            continue

        # Count bullet points (lines starting with - or * followed by space)
        bullets = re.findall(r"^[\-\*]\s+\S", subsection, re.MULTILINE)
        # Also count numbered items (1. 2. etc.)
        numbered = re.findall(r"^\d+\.\s+\S", subsection, re.MULTILINE)
        result[key] = len(bullets) + len(numbered)

    return result


def _extract_section(content: str, heading: str) -> str | None:
    """Extract the content of a ## heading section (until next ## or EOF)."""
    pattern = rf"^##\s+{re.escape(heading)}\s*$"
    match = re.search(pattern, content, re.MULTILINE | re.IGNORECASE)
    if not match:
        return None

    start = match.end()
    # Find next ## heading or end of string
    next_heading = re.search(r"^##\s+", content[start:], re.MULTILINE)
    if next_heading:
        end = start + next_heading.start()
    else:
        end = len(content)

    return content[start:end].strip()


def _extract_subsection(content: str, heading: str) -> str | None:
    """Extract the content of a ### heading subsection (until next ### or ##)."""
    pattern = rf"^###\s+{re.escape(heading)}\s*$"
    match = re.search(pattern, content, re.MULTILINE | re.IGNORECASE)
    if not match:
        return None

    start = match.end()
    # Find next ### or ## heading or end of string
    next_heading = re.search(r"^##", content[start:], re.MULTILINE)
    if next_heading:
        end = start + next_heading.start()
    else:
        end = len(content)

    return content[start:end].strip()
