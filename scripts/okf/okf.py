#!/usr/bin/env python3
"""OKF CLI — catalog, lint, search, index for JARVIS knowledge bundles.

Python stdlib only. Bundles are discovered from the root catalog at
$ORCHESTRATOR_HOME/knowledge/index.md (default home: ~/JARVIS).
Spec: docs/superpowers/specs/2026-07-04-okf-adoption-design.md
"""
import argparse
import os
import re
import sys
from collections import namedtuple
from datetime import date
from fnmatch import fnmatch
from pathlib import Path

RESERVED = {"index.md", "log.md", "INDEX.md", "README.md", "CHANGELOG.md", "MEMORY.md"}
SKIP_DIRS = {".git", ".claude", "node_modules", "__pycache__", ".venv", "cache"}


def _unquote(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        return value[1:-1]
    return value


def _coerce(value):
    value = value.strip()
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [_unquote(v.strip()) for v in inner.split(",")]
    return _unquote(value)


def parse_frontmatter(text):
    """Parse a minimal YAML-subset frontmatter block.

    Returns (meta_dict, body) or (None, text) when absent/malformed.
    Supports flat scalars, inline lists, block lists, and ONE level of
    nested mapping (e.g. the memory files' `metadata:` block).
    """
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return None, text
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return None, text

    meta = {}
    last_key = None  # most recent top-level key (block-list / nesting target)
    for raw in lines[1:end]:
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indented = raw.startswith((" ", "\t"))
        if stripped.startswith("- "):
            if last_key is None:
                return None, text
            if not isinstance(meta.get(last_key), list):
                meta[last_key] = []
            meta[last_key].append(_coerce(stripped[2:]))
        elif ":" in stripped:
            key, _, val = stripped.partition(":")
            key, val = key.strip(), val.strip()
            if indented:
                if last_key is None:
                    return None, text
                if not isinstance(meta.get(last_key), dict):
                    meta[last_key] = {}
                meta[last_key][key] = _coerce(val)
            else:
                meta[key] = _coerce(val) if val else {}
                last_key = key
        else:
            return None, text
    body = "\n".join(lines[end + 1:])
    return meta, body
