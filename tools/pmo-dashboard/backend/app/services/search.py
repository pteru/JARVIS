"""
Full-Text Search Service

Provides search across email indexes and document directories in the
PMO filesystem. Returns results with snippets for display in the
dashboard search bar.
"""

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

# Maximum snippet length in characters
SNIPPET_MAX_LEN = 200


def _make_snippet(text: str, query: str, max_len: int = SNIPPET_MAX_LEN) -> str:
    """
    Extract a snippet from text around the first occurrence of query.
    Highlights are not added here (frontend handles that).
    """
    if not text:
        return ""

    lower_text = text.lower()
    lower_query = query.lower()
    idx = lower_text.find(lower_query)

    if idx == -1:
        # No exact match found, return the beginning of the text
        return text[:max_len] + ("..." if len(text) > max_len else "")

    # Center the snippet around the match
    start = max(0, idx - max_len // 3)
    end = min(len(text), start + max_len)

    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."

    return snippet


def _matches_query(text: str, query: str) -> bool:
    """Case-insensitive substring match."""
    if not text or not query:
        return False
    return query.lower() in text.lower()


def _get_project_dirs(pmo_root: Path, project_code: str | None) -> list[tuple[str, Path]]:
    """
    Return list of (project_code, project_dir) tuples to search.
    If project_code is given, return only that project.
    Otherwise, return all project directories found under pmo_root.
    """
    pmo_root = Path(pmo_root)
    if project_code:
        project_dir = pmo_root / project_code
        if project_dir.is_dir():
            return [(project_code, project_dir)]
        return []

    results = []
    if pmo_root.is_dir():
        for child in sorted(pmo_root.iterdir()):
            if child.is_dir() and not child.name.startswith("."):
                results.append((child.name, child))
    return results


# ── Email search ──────────────────────────────────────────────────────────

async def search_emails(
    pmo_root: Path,
    query: str,
    project_code: str | None = None,
) -> list[dict]:
    """
    Search email index.json files for matching subjects/senders.

    Returns list of dicts with keys:
        type, project_code, title, snippet, hash
    """
    if not query or not query.strip():
        return []

    query = query.strip()
    pmo_root = Path(pmo_root)
    results: list[dict] = []

    project_dirs = _get_project_dirs(pmo_root, project_code)

    for code, project_dir in project_dirs:
        index_path = project_dir / "emails" / "index.json"
        if not index_path.exists():
            continue

        try:
            with open(index_path, "r", encoding="utf-8") as f:
                emails = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue

        if not isinstance(emails, list):
            continue

        for email_entry in emails:
            if not isinstance(email_entry, dict):
                continue

            subject = email_entry.get("subject", "")
            sender_name = (
                email_entry.get("sender_name")
                or email_entry.get("from_name")
                or ""
            )
            sender_email = (
                email_entry.get("sender_email")
                or email_entry.get("from_email")
                or email_entry.get("from")
                or ""
            )
            body_preview = email_entry.get("body_preview", "")
            email_hash = (
                email_entry.get("hash")
                or email_entry.get("message_id")
                or email_entry.get("id")
                or ""
            )

            # Check if query matches subject, sender, or body preview
            matched = False
            snippet = ""

            if _matches_query(subject, query):
                matched = True
                snippet = _make_snippet(subject, query)
            elif _matches_query(sender_name, query) or _matches_query(
                sender_email, query
            ):
                matched = True
                snippet = f"From: {sender_name} <{sender_email}>"
                if subject:
                    snippet += f" | {subject}"
                snippet = snippet[:SNIPPET_MAX_LEN]
            elif _matches_query(body_preview, query):
                matched = True
                snippet = _make_snippet(body_preview, query)

            if matched:
                results.append({
                    "type": "email",
                    "project_code": code,
                    "title": subject or "(No Subject)",
                    "snippet": snippet,
                    "hash": str(email_hash),
                })

    return results


# ── Document search ───────────────────────────────────────────────────────

async def search_documents(
    pmo_root: Path,
    query: str,
    project_code: str | None = None,
) -> list[dict]:
    """
    Search document filenames in reference/, meetings/, reports/ directories.

    Returns list of dicts with keys:
        type, project_code, title, snippet, path
    """
    if not query or not query.strip():
        return []

    query = query.strip()
    pmo_root = Path(pmo_root)
    results: list[dict] = []

    # Directories to scan for documents
    doc_subdirs = ["reference", "meetings", "reports"]

    project_dirs = _get_project_dirs(pmo_root, project_code)

    for code, project_dir in project_dirs:
        for subdir_name in doc_subdirs:
            subdir = project_dir / subdir_name
            if not subdir.is_dir():
                continue

            try:
                for file_path in subdir.rglob("*"):
                    if not file_path.is_file():
                        continue
                    if file_path.name.startswith("."):
                        continue

                    filename = file_path.name
                    # Also build a readable name from the filename
                    readable_name = (
                        file_path.stem.replace("_", " ")
                        .replace("-", " ")
                        .strip()
                    )

                    if _matches_query(filename, query) or _matches_query(
                        readable_name, query
                    ):
                        # Build relative path from pmo_root
                        try:
                            rel_path = str(
                                file_path.relative_to(pmo_root)
                            )
                        except ValueError:
                            rel_path = str(file_path)

                        results.append({
                            "type": "document",
                            "project_code": code,
                            "title": filename,
                            "snippet": (
                                f"{subdir_name}/{filename} "
                                f"({_human_file_size(file_path)})"
                            ),
                            "path": rel_path,
                        })
            except OSError as e:
                logger.warning(
                    "Error scanning %s/%s: %s", code, subdir_name, e
                )

    return results


def _human_file_size(path: Path) -> str:
    """Return human-readable file size."""
    try:
        size = path.stat().st_size
    except OSError:
        return "unknown size"

    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"
