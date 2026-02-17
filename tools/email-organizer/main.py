#!/usr/bin/env python3
"""JARVIS Email Organizer — Fetch, classify, parse, and store project emails."""

import argparse
import email
import email.utils
import email.policy
import hashlib
import imaplib
import json
import os
import re
import shutil
import sys
from datetime import datetime
from email.header import decode_header
from pathlib import Path

from dateutil import parser as dateutil_parser

JARVIS_ROOT = Path(os.environ.get("JARVIS_HOME", Path(__file__).resolve().parent.parent.parent))
PROJECT_CODES_PATH = JARVIS_ROOT / "config" / "project-codes.json"
IMAP_STATE_PATH = JARVIS_ROOT / "data" / "email-organizer" / "imap_state.json"
UNCLASSIFIED_PATH = JARVIS_ROOT / "data" / "email-organizer" / "unclassified"

LABEL_PATTERN = re.compile(r"^\d{5}$")
PROJECT_CODE_PATTERN = re.compile(r"\b(\d{5})\b")
TEXT_EXTRACTABLE = {".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log"}
MAX_EXTRACT_BYTES = 512 * 1024


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_project_codes():
    if not PROJECT_CODES_PATH.exists():
        return {}
    return json.loads(PROJECT_CODES_PATH.read_text())


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode_header_value(raw):
    if raw is None:
        return ""
    parts = decode_header(raw)
    decoded = []
    for data, charset in parts:
        if isinstance(data, bytes):
            decoded.append(data.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(data)
    return " ".join(decoded)


def pmo_path(project_code: str) -> Path:
    codes = load_project_codes()
    if project_code in codes and "pmo_path" in codes[project_code]:
        return JARVIS_ROOT / codes[project_code]["pmo_path"]
    return JARVIS_ROOT / "workspaces" / "strokmatic" / "pmo" / project_code


def ensure_pmo_dirs(project_code: str) -> Path:
    base = pmo_path(project_code)
    for d in ["emails/raw", "emails/parsed", "attachments"]:
        (base / d).mkdir(parents=True, exist_ok=True)
    return base


def load_index(project_code: str) -> list:
    idx_path = pmo_path(project_code) / "emails" / "index.json"
    if idx_path.exists():
        return json.loads(idx_path.read_text())
    return []


def save_index(project_code: str, index: list):
    idx_path = pmo_path(project_code) / "emails" / "index.json"
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    idx_path.write_text(json.dumps(index, indent=2, default=str))


def load_imap_state() -> dict:
    if IMAP_STATE_PATH.exists():
        return json.loads(IMAP_STATE_PATH.read_text())
    return {}


def save_imap_state(state: dict):
    IMAP_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    IMAP_STATE_PATH.write_text(json.dumps(state, indent=2))


# ---------------------------------------------------------------------------
# Email Parsing
# ---------------------------------------------------------------------------

def parse_eml(path: Path) -> dict:
    raw_bytes = path.read_bytes()
    msg = email.message_from_bytes(raw_bytes, policy=email.policy.compat32)

    subject = decode_header_value(msg["Subject"])
    sender_name, sender_email = email.utils.parseaddr(decode_header_value(msg["From"]))
    recipients = []
    for hdr in ("To", "Cc"):
        val = decode_header_value(msg.get(hdr, ""))
        if val:
            recipients.extend([addr.strip() for addr in val.split(",") if addr.strip()])

    date_str = msg.get("Date", "")
    date = None
    if date_str:
        try:
            date = email.utils.parsedate_to_datetime(date_str).replace(tzinfo=None)
        except Exception:
            try:
                date = dateutil_parser.parse(date_str, fuzzy=True).replace(tzinfo=None)
            except Exception:
                pass

    # Extract project code: X-Email-KB-Project-Code header > subject
    project_code = msg.get("X-Email-KB-Project-Code")
    if not project_code:
        m = PROJECT_CODE_PATTERN.search(subject)
        if m:
            project_code = m.group(1)

    # Body extraction
    body_text = ""
    body_html = ""
    attachment_list = []

    if msg.is_multipart():
        for part in msg.walk():
            disp = str(part.get("Content-Disposition", ""))
            ct = part.get_content_type()
            if "attachment" in disp:
                fname = part.get_filename()
                if fname:
                    fname = decode_header_value(fname)
                    payload = part.get_payload(decode=True)
                    attachment_list.append({
                        "filename": fname,
                        "content_type": ct,
                        "size": len(payload) if payload else 0,
                        "data": payload,
                    })
                continue
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    body_text += payload.decode(charset, errors="replace")
            elif ct == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    body_html += payload.decode(charset, errors="replace")
    else:
        ct = msg.get_content_type()
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            if ct == "text/plain":
                body_text = payload.decode(charset, errors="replace")
            elif ct == "text/html":
                body_html = payload.decode(charset, errors="replace")

    # Thread tracking
    message_id = msg.get("Message-ID", "")
    in_reply_to = msg.get("In-Reply-To", "")
    references = msg.get("References", "")

    return {
        "hash": sha256_bytes(raw_bytes),
        "subject": subject,
        "sender_name": sender_name,
        "sender_email": sender_email,
        "recipients": recipients,
        "date": date.isoformat() if date else None,
        "body_text": body_text,
        "body_html": body_html,
        "project_code": project_code,
        "attachments": [{"filename": a["filename"], "content_type": a["content_type"], "size": a["size"]} for a in attachment_list],
        "message_id": message_id,
        "in_reply_to": in_reply_to,
        "references": references,
        "_raw_attachments": attachment_list,
    }


def extract_heuristics(parsed: dict) -> dict:
    """Basic heuristic extraction from email body text."""
    body = parsed.get("body_text", "")
    lines = body.split("\n")

    action_items = []
    dates_mentioned = []
    participants = set()

    for line in lines:
        stripped = line.strip()
        # Action items
        if stripped.startswith(("- ", "* ", "TODO", "Action:", "ACTION:")):
            action_items.append(stripped)
        # Date patterns
        date_matches = re.findall(
            r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\w+ \d{1,2},? \d{4})\b", stripped
        )
        dates_mentioned.extend(date_matches)

    # Participants from recipients + sender
    participants.add(parsed.get("sender_email", ""))
    for r in parsed.get("recipients", []):
        _, addr = email.utils.parseaddr(r)
        if addr:
            participants.add(addr)

    return {
        "action_items": action_items[:20],
        "dates_mentioned": dates_mentioned[:20],
        "participants": sorted(p for p in participants if p),
    }


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def classify_email(parsed: dict, project_codes: dict) -> str:
    """Rule-based classification: keyword match → sender match → fallback."""
    subject_lower = (parsed.get("subject", "") or "").lower()
    body_lower = (parsed.get("body_text", "") or "").lower()[:2000]
    sender = (parsed.get("sender_email", "") or "").lower()
    text = subject_lower + " " + body_lower

    # If email already has a project code from header/subject, verify it exists
    if parsed.get("project_code") and parsed["project_code"] in project_codes:
        return parsed["project_code"]

    best_score = 0
    best_code = None

    for code, info in project_codes.items():
        score = 0
        # Keyword matching
        for kw in info.get("keywords", []):
            if kw.lower() in text:
                score += 2
            if kw.lower() in subject_lower:
                score += 3  # Subject matches worth more

        # Sender matching
        for s in info.get("senders", []):
            if s.lower() in sender:
                score += 5

        if score > best_score:
            best_score = score
            best_code = code

    if best_score >= 2:
        return best_code

    return None  # unclassified


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_fetch(args):
    """Connect to IMAP, download new emails."""
    username = os.environ.get("IMAP_USERNAME")
    password = os.environ.get("IMAP_PASSWORD")
    host = os.environ.get("IMAP_HOST", "imap.gmail.com")

    if not username or not password:
        print("Error: IMAP_USERNAME and IMAP_PASSWORD env vars required", file=sys.stderr)
        sys.exit(1)

    state = load_imap_state()
    staging = JARVIS_ROOT / "data" / "email-organizer" / "staging"
    staging.mkdir(parents=True, exist_ok=True)

    print(f"Connecting to {host} as {username}...")
    imap = imaplib.IMAP4_SSL(host)
    imap.login(username, password)

    # List all folders, find 5-digit project-code labels
    _, folder_data = imap.list()
    fetched = 0

    for item in (folder_data or []):
        if not item:
            continue
        # Parse folder name from IMAP LIST response
        decoded = item.decode() if isinstance(item, bytes) else item
        # Extract last path component
        match = re.search(r'"[/.]" "?([^"]*)"?$', decoded)
        if not match:
            match = re.search(r'"[/.]" (.+)$', decoded)
        if not match:
            continue

        folder_path = match.group(1).strip().strip('"')
        folder_name = folder_path.rsplit("/", 1)[-1] if "/" in folder_path else folder_path

        if not LABEL_PATTERN.match(folder_name):
            continue

        project_code = folder_name
        seen_uids = set(state.get(folder_path, []))

        try:
            status, _ = imap.select(f'"{folder_path}"')
            if status != "OK":
                continue
        except Exception:
            continue

        _, msg_data = imap.search(None, "ALL")
        if not msg_data or not msg_data[0]:
            continue

        uids = msg_data[0].split()
        new_uids = [u for u in uids if u.decode() not in seen_uids]

        for uid in new_uids:
            _, data = imap.fetch(uid, "(RFC822)")
            if not data or not data[0] or not isinstance(data[0], tuple):
                continue
            raw = data[0][1]

            # Inject project code header
            header_line = f"X-Email-KB-Project-Code: {project_code}\r\n".encode()
            first_nl = raw.find(b"\r\n")
            if first_nl >= 0:
                raw = raw[:first_nl + 2] + header_line + raw[first_nl + 2:]

            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            fname = f"email_{project_code}_{ts}.eml"
            (staging / fname).write_bytes(raw)
            seen_uids.add(uid.decode())
            fetched += 1

        state[folder_path] = sorted(seen_uids)

    imap.logout()
    save_imap_state(state)
    print(f"Fetched {fetched} new emails to staging.")

    # If --classify flag, auto-classify staged emails
    if args.classify:
        _classify_staged(staging)


def _classify_staged(staging: Path):
    """Classify all .eml files in staging and move to PMO folders."""
    project_codes = load_project_codes()
    classified = 0
    unclassified = 0

    for eml_path in sorted(staging.glob("*.eml")):
        parsed = parse_eml(eml_path)
        code = classify_email(parsed, project_codes)

        if code:
            base = ensure_pmo_dirs(code)
            dest = base / "emails" / "raw" / eml_path.name
            shutil.move(str(eml_path), str(dest))
            classified += 1
        else:
            UNCLASSIFIED_PATH.mkdir(parents=True, exist_ok=True)
            shutil.move(str(eml_path), str(UNCLASSIFIED_PATH / eml_path.name))
            unclassified += 1

    print(f"Classified: {classified}, Unclassified: {unclassified}")


def cmd_classify(args):
    """Classify emails from staging or a specified directory."""
    source = Path(args.source) if args.source else JARVIS_ROOT / "data" / "email-organizer" / "staging"
    if not source.exists():
        print(f"Source directory not found: {source}", file=sys.stderr)
        sys.exit(1)
    _classify_staged(source)


def cmd_parse(args):
    """Parse raw .eml files into structured JSON for a project."""
    code = args.project
    base = pmo_path(code)
    raw_dir = base / "emails" / "raw"
    parsed_dir = base / "emails" / "parsed"
    attachments_dir = base / "attachments"

    if not raw_dir.exists():
        print(f"No raw emails found for project {code}", file=sys.stderr)
        sys.exit(1)

    parsed_dir.mkdir(parents=True, exist_ok=True)
    attachments_dir.mkdir(parents=True, exist_ok=True)
    index = load_index(code)
    existing_hashes = {e["hash"] for e in index}

    parsed_count = 0
    skipped = 0

    for eml_path in sorted(raw_dir.glob("*.eml")):
        parsed = parse_eml(eml_path)
        file_hash = parsed["hash"]

        if file_hash in existing_hashes and not args.force:
            skipped += 1
            continue

        heuristics = extract_heuristics(parsed)

        # Save attachments
        raw_attachments = parsed.pop("_raw_attachments", [])
        saved_attachments = []
        for att in raw_attachments:
            att_dir = attachments_dir / file_hash[:12]
            att_dir.mkdir(parents=True, exist_ok=True)
            att_path = att_dir / att["filename"]
            # Dedup by name collision
            counter = 1
            while att_path.exists():
                stem = Path(att["filename"]).stem
                suffix = Path(att["filename"]).suffix
                att_path = att_dir / f"{stem}_{counter}{suffix}"
                counter += 1
            att_path.write_bytes(att["data"] or b"")

            # Extract text from text-extractable attachments
            att_text = ""
            if Path(att["filename"]).suffix.lower() in TEXT_EXTRACTABLE and att["data"]:
                try:
                    att_text = att["data"].decode("utf-8", errors="replace")[:MAX_EXTRACT_BYTES]
                except Exception:
                    pass

            saved_attachments.append({
                "filename": att["filename"],
                "path": str(att_path.relative_to(base)),
                "text_preview": att_text[:500] if att_text else "",
            })

        # Build parsed record
        record = {
            "hash": file_hash,
            "source_file": eml_path.name,
            "subject": parsed["subject"],
            "sender_name": parsed["sender_name"],
            "sender_email": parsed["sender_email"],
            "recipients": parsed["recipients"],
            "date": parsed["date"],
            "project_code": code,
            "body_text": parsed["body_text"],
            "attachments": saved_attachments,
            "heuristics": heuristics,
            "message_id": parsed["message_id"],
            "in_reply_to": parsed["in_reply_to"],
            "references": parsed["references"],
            "category": None,  # Set by MCP email-analyzer tool
        }

        # Save parsed JSON
        parsed_path = parsed_dir / f"{file_hash[:16]}.json"
        parsed_path.write_text(json.dumps(record, indent=2, default=str))

        # Update index (without body_text to keep index small)
        index_entry = {k: v for k, v in record.items() if k != "body_text"}
        if file_hash in existing_hashes:
            index = [e for e in index if e["hash"] != file_hash]
        index.append(index_entry)
        existing_hashes.add(file_hash)
        parsed_count += 1

    # Sort index by date
    index.sort(key=lambda e: e.get("date") or "")
    save_index(code, index)
    print(f"Parsed: {parsed_count}, Skipped: {skipped}, Total in index: {len(index)}")


def cmd_ingest(args):
    """Full pipeline: fetch → classify → parse."""
    # Fetch
    fetch_args = argparse.Namespace(classify=True)
    cmd_fetch(fetch_args)

    # Parse all projects that have raw emails
    project_codes = load_project_codes()
    for code in project_codes:
        raw_dir = pmo_path(code) / "emails" / "raw"
        if raw_dir.exists() and list(raw_dir.glob("*.eml")):
            parse_args = argparse.Namespace(project=code, force=False)
            print(f"\n--- Parsing project {code} ---")
            cmd_parse(parse_args)


def cmd_list(args):
    """Show ingested emails per project."""
    project_codes = load_project_codes()
    code_filter = args.project

    codes = [code_filter] if code_filter else sorted(project_codes.keys())

    for code in codes:
        index = load_index(code)
        name = project_codes.get(code, {}).get("name", "Unknown")
        print(f"\n{'='*60}")
        print(f"Project {code}: {name} ({len(index)} emails)")
        print(f"{'='*60}")

        if not index:
            print("  (no emails)")
            continue

        for entry in index[-20:]:  # Last 20
            date = entry.get("date", "?")[:10]
            subj = entry.get("subject", "(no subject)")[:60]
            sender = entry.get("sender_email", "?")
            cat = entry.get("category", "-")
            atts = len(entry.get("attachments", []))
            att_str = f" [{atts} att]" if atts else ""
            print(f"  {date}  {sender:<30}  {subj}{att_str}  ({cat})")

    # Show unclassified
    if UNCLASSIFIED_PATH.exists():
        unclass = list(UNCLASSIFIED_PATH.glob("*.eml"))
        if unclass:
            print(f"\n  Unclassified: {len(unclass)} emails in {UNCLASSIFIED_PATH}")


def cmd_reprocess(args):
    """Re-run parse on existing raw emails for a project."""
    code = args.project
    raw_dir = pmo_path(code) / "emails" / "raw"
    if not raw_dir.exists():
        print(f"No raw emails for project {code}", file=sys.stderr)
        sys.exit(1)

    # Clear index to force reparse
    parse_args = argparse.Namespace(project=code, force=True)
    cmd_parse(parse_args)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        prog="email-organizer",
        description="JARVIS Email Organizer — Fetch, classify, parse, and store project emails",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # fetch
    p_fetch = sub.add_parser("fetch", help="Download new emails via IMAP")
    p_fetch.add_argument("--classify", action="store_true", default=True,
                         help="Auto-classify fetched emails (default: true)")
    p_fetch.add_argument("--no-classify", dest="classify", action="store_false")

    # classify
    p_classify = sub.add_parser("classify", help="Classify emails from staging")
    p_classify.add_argument("--source", help="Source directory (default: staging)")

    # parse
    p_parse = sub.add_parser("parse", help="Parse raw emails for a project")
    p_parse.add_argument("project", help="Project code (e.g. 02008)")
    p_parse.add_argument("--force", action="store_true", help="Re-parse already parsed emails")

    # ingest
    sub.add_parser("ingest", help="Full pipeline: fetch → classify → parse")

    # list
    p_list = sub.add_parser("list", help="Show ingested emails")
    p_list.add_argument("--project", help="Filter to specific project code")

    # reprocess
    p_reprocess = sub.add_parser("reprocess", help="Re-parse all emails for a project")
    p_reprocess.add_argument("project", help="Project code")

    args = parser.parse_args()

    handlers = {
        "fetch": cmd_fetch,
        "classify": cmd_classify,
        "parse": cmd_parse,
        "ingest": cmd_ingest,
        "list": cmd_list,
        "reprocess": cmd_reprocess,
    }
    handlers[args.command](args)


if __name__ == "__main__":
    main()
