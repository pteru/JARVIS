#!/usr/bin/env python3
"""Mechanical digest of a Claude Code transcript jsonl.

Prints user prompts and turn-final assistant texts as a markdown digest — the
raw material for a journal back-fill entry. Extraction only, no interpretation;
tool calls/results, meta records and command noise are dropped. Stdlib only.
"""
import argparse
import json
import sys
from pathlib import Path

DEFAULT_MAX_MSG = 700       # chars kept per message
DEFAULT_MAX_TOTAL = 20000   # digest size cap

NOISE_PREFIXES = ("<command-name>", "<local-command", "<system-reminder>",
                  "Caveat:")


def _text_of(content):
    """Plain text of message content (string or parts list); '' otherwise."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = [p.get("text", "") for p in content
                 if isinstance(p, dict) and p.get("type") == "text"]
        return "\n".join(t for t in parts if t).strip()
    return ""


def _is_noise(text):
    return not text or text.startswith(NOISE_PREFIXES)


def extract(path):
    """Return [(role, text)] turns; assistant = turn-final text only."""
    turns = []
    pending = None   # last assistant text seen since the previous user msg
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(rec, dict):
            continue
        if rec.get("isMeta"):
            continue
        kind = rec.get("type")
        msg = rec.get("message")
        if not isinstance(msg, dict):
            continue
        text = _text_of(msg.get("content"))
        if kind == "user":
            if _is_noise(text):
                continue
            if pending:
                turns.append(("assistant", pending))
                pending = None
            turns.append(("user", text))
        elif kind == "assistant" and text:
            pending = text
    if pending:
        turns.append(("assistant", pending))
    return turns


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("jsonl")
    ap.add_argument("--max-msg", type=int, default=DEFAULT_MAX_MSG)
    ap.add_argument("--max-total", type=int, default=DEFAULT_MAX_TOTAL)
    args = ap.parse_args(argv)
    total = 0
    for role, text in extract(args.jsonl):
        if len(text) > args.max_msg:
            text = text[:args.max_msg] + " […]"
        block = "## {0}\n\n{1}\n\n".format(role, text)
        total += len(block)
        if total > args.max_total:
            print("… [truncado: limite de extração atingido]")
            return 0
        sys.stdout.write(block)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
