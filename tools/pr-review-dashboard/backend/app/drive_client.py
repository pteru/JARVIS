"""Google Drive API client for reading PR review data.

Uses service account with domain-wide delegation to read files
from the JARVIS Shared Drive "PR Reviews" folder.
"""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache

from google.auth.transport.requests import Request
from google.oauth2 import service_account
from googleapiclient.discovery import build

from .config import settings

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/drive"]

# Cached Drive service and folder IDs
_drive_service = None
_folder_cache: dict[str, str] = {}


def _get_credentials():
    """Build service account credentials with domain-wide delegation."""
    creds_path = settings.gcp_credentials_path
    if not os.path.isfile(creds_path):
        raise RuntimeError(f"GCP credentials not found: {creds_path}")

    creds = service_account.Credentials.from_service_account_file(
        creds_path,
        scopes=_SCOPES,
        subject=settings.impersonate_email,
    )
    return creds


def get_drive_service():
    """Get or create a cached Drive API service instance."""
    global _drive_service
    if _drive_service is None:
        creds = _get_credentials()
        _drive_service = build("drive", "v3", credentials=creds)
        logger.info("Google Drive service initialized")
    return _drive_service


def _find_folder(name: str, parent_id: str | None = None) -> str | None:
    """Find a folder by name in the shared drive, optionally within a parent."""
    drive = get_drive_service()
    q_parts = [
        f"name = '{name}'",
        "mimeType = 'application/vnd.google-apps.folder'",
        "trashed = false",
    ]
    if parent_id:
        q_parts.append(f"'{parent_id}' in parents")

    res = drive.files().list(
        q=" and ".join(q_parts),
        driveId=settings.drive_shared_drive_id,
        corpora="drive",
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
        fields="files(id, name)",
    ).execute()

    files = res.get("files", [])
    return files[0]["id"] if files else None


def get_root_folder_id() -> str:
    """Get the "PR Reviews" root folder ID (cached)."""
    if "root" not in _folder_cache:
        folder_id = _find_folder(settings.drive_folder_name)
        if not folder_id:
            raise RuntimeError(
                f"Folder '{settings.drive_folder_name}' not found in shared drive"
            )
        _folder_cache["root"] = folder_id
        logger.info("PR Reviews root folder: %s", folder_id)
    return _folder_cache["root"]


def get_subfolder_id(name: str) -> str | None:
    """Get a subfolder ID within the PR Reviews root (cached)."""
    if name not in _folder_cache:
        root_id = get_root_folder_id()
        _folder_cache[name] = _find_folder(name, parent_id=root_id)
    return _folder_cache.get(name)


def list_files(folder_id: str, mime_filter: str | None = None) -> list[dict]:
    """List files in a folder. Returns list of {id, name, modifiedTime, webViewLink}."""
    drive = get_drive_service()
    q_parts = [f"'{folder_id}' in parents", "trashed = false"]
    if mime_filter:
        q_parts.append(f"mimeType = '{mime_filter}'")

    results = []
    page_token = None

    while True:
        res = drive.files().list(
            q=" and ".join(q_parts),
            driveId=settings.drive_shared_drive_id,
            corpora="drive",
            includeItemsFromAllDrives=True,
            supportsAllDrives=True,
            fields="nextPageToken, files(id, name, modifiedTime, webViewLink, mimeType)",
            pageToken=page_token,
            pageSize=100,
        ).execute()

        results.extend(res.get("files", []))
        page_token = res.get("nextPageToken")
        if not page_token:
            break

    return results


def read_file_content(file_id: str) -> str:
    """Download the content of a file as a string."""
    drive = get_drive_service()
    content = drive.files().get_media(
        fileId=file_id,
        supportsAllDrives=True,
    ).execute()

    if isinstance(content, bytes):
        return content.decode("utf-8")
    return str(content)


def find_file_in_folder(folder_id: str, filename: str) -> dict | None:
    """Find a specific file by name in a folder. Returns {id, name, webViewLink} or None."""
    drive = get_drive_service()
    res = drive.files().list(
        q=f"name = '{filename}' and '{folder_id}' in parents and trashed = false",
        driveId=settings.drive_shared_drive_id,
        corpora="drive",
        includeItemsFromAllDrives=True,
        supportsAllDrives=True,
        fields="files(id, name, webViewLink, mimeType)",
    ).execute()

    files = res.get("files", [])
    return files[0] if files else None


def find_google_doc_for_review(repo: str, number: int) -> str | None:
    """Find the Google Doc URL for a review.

    Looks in the "docs" subfolder for a Doc whose name starts with
    the review identifier pattern (e.g., "diemaster-5" or "PR Review: diemaster#5").
    """
    docs_folder_id = get_subfolder_id("docs")
    if not docs_folder_id:
        return None

    drive = get_drive_service()
    # Search for Google Docs matching the review identifier
    search_terms = [f"{repo}-{number}", f"{repo}#{number}"]

    for term in search_terms:
        res = drive.files().list(
            q=(
                f"name contains '{term}' "
                f"and '{docs_folder_id}' in parents "
                f"and mimeType = 'application/vnd.google-apps.document' "
                f"and trashed = false"
            ),
            driveId=settings.drive_shared_drive_id,
            corpora="drive",
            includeItemsFromAllDrives=True,
            supportsAllDrives=True,
            fields="files(id, name, webViewLink)",
            pageSize=1,
        ).execute()

        files = res.get("files", [])
        if files:
            return files[0].get("webViewLink")

    return None


def read_inbox_json() -> dict | None:
    """Read pr-inbox.json from the PR Reviews root folder on Drive."""
    try:
        root_id = get_root_folder_id()
        file_info = find_file_in_folder(root_id, "pr-inbox.json")
        if not file_info:
            return None
        content = read_file_content(file_info["id"])
        return json.loads(content)
    except Exception:
        logger.exception("Failed to read pr-inbox.json from Drive")
        return None


def read_review_markdown(repo: str, number: int) -> str | None:
    """Read a review markdown file from Drive's markdown/ subfolder."""
    try:
        md_folder_id = get_subfolder_id("markdown")
        if not md_folder_id:
            # Fall back to root folder
            md_folder_id = get_root_folder_id()

        filename = f"{repo}-{number}.md"
        file_info = find_file_in_folder(md_folder_id, filename)
        if not file_info:
            # Try root folder as fallback
            root_id = get_root_folder_id()
            file_info = find_file_in_folder(root_id, filename)
        if not file_info:
            return None

        return read_file_content(file_info["id"])
    except Exception:
        logger.exception("Failed to read review %s-%d from Drive", repo, number)
        return None


def list_review_files() -> list[dict]:
    """List all review .md files from Drive.

    Searches both the markdown/ subfolder and the root folder.
    Returns list of {id, name, webViewLink}.
    """
    files = []

    try:
        # Check markdown subfolder first
        md_folder_id = get_subfolder_id("markdown")
        if md_folder_id:
            md_files = list_files(md_folder_id)
            files.extend(f for f in md_files if f["name"].endswith(".md"))

        # Also check root folder for .md files
        root_id = get_root_folder_id()
        root_files = list_files(root_id)
        # Only include .md files that aren't pr-inbox.md
        root_md = [
            f for f in root_files
            if f["name"].endswith(".md") and f["name"] != "pr-inbox.md"
        ]

        # Merge, deduplicating by name (prefer markdown/ subfolder)
        seen_names = {f["name"] for f in files}
        for f in root_md:
            if f["name"] not in seen_names:
                files.append(f)

    except Exception:
        logger.exception("Failed to list review files from Drive")

    return files
