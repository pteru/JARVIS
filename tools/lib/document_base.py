"""
Shared CLI scaffolding for JARVIS document tools (docx, xlsx, pptx).

Extracts duplicated patterns:
- Unicode-aware file path resolution (NFC/NFD normalization)
- JSON output helper
- File validation (existence + extension check)

Usage:
    from tools.lib.document_base import resolve_path, json_output, validate_file
"""

import json
import os
import sys
import unicodedata
from pathlib import Path


def resolve_path(filepath):
    """Resolve a file path, handling NFC/NFD Unicode normalization mismatches.

    Linux filesystems can store filenames in NFC or NFD form depending on
    the creating OS (macOS uses NFD, Windows uses NFC). This tries both
    normalizations before giving up.
    """
    p = Path(filepath)
    if p.exists():
        return str(p)
    # Try NFD normalization (common on Linux with files created on macOS/Windows)
    nfd = unicodedata.normalize("NFD", str(p))
    if os.path.exists(nfd):
        return nfd
    # Try NFC
    nfc = unicodedata.normalize("NFC", str(p))
    if os.path.exists(nfc):
        return nfc
    return str(p)  # Return original, let the caller's library raise its own error


def json_output(data, ensure_ascii=False, indent=2):
    """Print data as formatted JSON to stdout.

    Matches the convention used across all document tools:
    json.dumps with default=str for datetime serialization.
    """
    print(json.dumps(data, default=str, indent=indent, ensure_ascii=ensure_ascii))


def validate_file(filepath, allowed_extensions=None):
    """Validate that a file exists and optionally check its extension.

    Args:
        filepath: Path to the file to validate.
        allowed_extensions: Optional set/list of allowed extensions (e.g., {'.docx', '.doc'}).
            Extensions should include the leading dot.

    Returns:
        The resolved file path.

    Raises:
        SystemExit: If the file does not exist or has an invalid extension.
    """
    resolved = resolve_path(filepath)
    if not os.path.exists(resolved):
        print(f"Error: file not found: {filepath}", file=sys.stderr)
        sys.exit(1)
    if allowed_extensions:
        ext = Path(resolved).suffix.lower()
        if ext not in allowed_extensions:
            exts = ", ".join(sorted(allowed_extensions))
            print(f"Error: unsupported file type '{ext}'. Expected: {exts}", file=sys.stderr)
            sys.exit(1)
    return resolved
