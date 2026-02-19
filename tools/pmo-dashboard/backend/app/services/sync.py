"""
PMO Filesystem Sync Service

Scans the PMO filesystem (email indexes, schedule files) and populates
the SQLite database with supplier, contact, and schedule data.

Called from main.py on application startup.
"""

import json
import logging
import re
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Supplier,
    SupplierContact,
    SupplierProject,
    ScheduleTask,
    ScheduleMilestone,
)

logger = logging.getLogger(__name__)

# ── Free / internal email domains to exclude from supplier extraction ──────

FREE_EMAIL_DOMAINS = frozenset({
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "outlook.es",
    "outlook.it",
    "hotmail.com",
    "hotmail.es",
    "hotmail.it",
    "yahoo.com",
    "yahoo.es",
    "yahoo.it",
    "yahoo.co.uk",
    "live.com",
    "aol.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "protonmail.com",
    "proton.me",
    "zoho.com",
    "yandex.com",
    "mail.com",
    "gmx.com",
    "gmx.net",
})

INTERNAL_DOMAINS = frozenset({
    "strokmatic.com",
    "lumesolutions.com",
    "lume-solutions.com",
})

# OEM / client domains — these are customers, not suppliers
CLIENT_DOMAINS = frozenset({
    "nissan-usa.com",
    "nissan.com",
    "nissan.co.jp",
    "hyundai.com",
    "hyundai-brasil.com",
    "hyundai-motor.com",
    "gm.com",
    "gmc.com",
    "chevrolet.com",
    "stellantis.com",
    "fiat.com",
    "vw.com",
    "volkswagen.com",
    "usiminas.com",
    "arcelormittal.com",
    "arcelormittal.com.br",
    "fundep.com.br",
    "fundep.ufmg.br",
})

# Automated service domains that are not real suppliers
SERVICE_DOMAINS = frozenset({
    "google.com",
    "docs.google.com",
    "calendar.google.com",
    "linkedin.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "slack.com",
    "teams.microsoft.com",
    "microsoft.com",
    "zoom.us",
    "clickup.com",
    "tasks.clickup.com",
    "thereceptionist.com",
    "processunity.com",
    "mcafee.com",
    "noreply.github.com",
    "github.com",
    "atlassian.com",
    "jira.com",
    "confluence.com",
    "trello.com",
    "notion.so",
    "mailchimp.com",
    "sendgrid.net",
    "amazonses.com",
})


def _prettify_domain(domain: str) -> str:
    """
    Convert an email domain into a human-friendly company name.

    Examples:
        comau.com        -> "Comau"
        nissan-usa.com   -> "Nissan Usa"
        abb.co.uk        -> "Abb"
        siemens-ag.de    -> "Siemens Ag"
        kuka-robotics.it -> "Kuka Robotics"
    """
    # Strip the TLD (handle multi-part TLDs like .co.uk, .com.br)
    parts = domain.split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "com", "org", "net", "gov", "ac"):
        # e.g., abb.co.uk -> take everything before the last two parts
        name_parts = parts[:-2]
    else:
        # e.g., comau.com -> take everything before the last part
        name_parts = parts[:-1]

    name = ".".join(name_parts)
    # Replace hyphens and underscores with spaces, then title-case
    name = name.replace("-", " ").replace("_", " ")
    return name.title()


def _extract_domain(email: str) -> str | None:
    """Extract domain from an email address, lowercased."""
    if not email or "@" not in email:
        return None
    return email.split("@", 1)[1].strip().lower()


def _should_exclude_domain(domain: str) -> bool:
    """Check if a domain is a free provider, internal, client, or service domain."""
    return (
        domain in FREE_EMAIL_DOMAINS
        or domain in INTERNAL_DOMAINS
        or domain in SERVICE_DOMAINS
        or domain in CLIENT_DOMAINS
    )


# ── Supplier sync from email indexes ──────────────────────────────────────

async def sync_suppliers_from_emails(
    db: AsyncSession,
    pmo_root: Path,
    config_root: Path,
) -> dict:
    """
    Scan all project email indexes, extract unique sender domains,
    create/update supplier entries and contacts.

    Returns a summary dict with counts.
    """
    stats = {
        "projects_scanned": 0,
        "suppliers_created": 0,
        "suppliers_existing": 0,
        "contacts_created": 0,
        "contacts_existing": 0,
        "links_created": 0,
    }

    # Step a: Load project codes
    project_codes_path = config_root / "project-codes.json"
    if not project_codes_path.exists():
        logger.warning("project-codes.json not found at %s", project_codes_path)
        return stats

    try:
        with open(project_codes_path, "r", encoding="utf-8") as f:
            project_codes_data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.error("Failed to read project-codes.json: %s", e)
        return stats

    # project_codes_data can be a list of dicts or a dict keyed by code
    if isinstance(project_codes_data, list):
        project_codes = [
            p.get("code") or p.get("project_code")
            for p in project_codes_data
            if isinstance(p, dict)
        ]
    elif isinstance(project_codes_data, dict):
        project_codes = list(project_codes_data.keys())
    else:
        logger.error("Unexpected project-codes.json format")
        return stats

    project_codes = [c for c in project_codes if c]

    # Build caches of existing suppliers (by domain) and contacts (by email)
    existing_suppliers_result = await db.execute(select(Supplier))
    existing_suppliers = existing_suppliers_result.scalars().all()
    domain_to_supplier: dict[str, Supplier] = {}
    for s in existing_suppliers:
        if s.domain:
            domain_to_supplier[s.domain.lower()] = s

    existing_contacts_result = await db.execute(select(SupplierContact))
    existing_contacts = existing_contacts_result.scalars().all()
    email_to_contact: dict[str, SupplierContact] = {}
    for c in existing_contacts:
        if c.email:
            email_to_contact[c.email.lower()] = c

    # Cache supplier-project links
    existing_links_result = await db.execute(select(SupplierProject))
    existing_links = existing_links_result.scalars().all()
    link_keys: set[tuple[int, str]] = {
        (lnk.supplier_id, lnk.project_code) for lnk in existing_links
    }

    # Step b-g: For each project, read emails/index.json
    for project_code in project_codes:
        email_index_path = pmo_root / project_code / "emails" / "index.json"
        if not email_index_path.exists():
            continue

        stats["projects_scanned"] += 1

        try:
            with open(email_index_path, "r", encoding="utf-8") as f:
                emails = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(
                "Failed to read email index for %s: %s", project_code, e
            )
            continue

        if not isinstance(emails, list):
            continue

        # Step c-d: Extract sender_email and sender_name, group by domain
        domain_senders: dict[str, list[tuple[str, str]]] = {}

        for email_entry in emails:
            if not isinstance(email_entry, dict):
                continue

            sender_email = (
                email_entry.get("sender_email")
                or email_entry.get("from_email")
                or email_entry.get("from")
                or ""
            ).strip().lower()

            sender_name = (
                email_entry.get("sender_name")
                or email_entry.get("from_name")
                or ""
            ).strip()

            # If sender_email contains "Name <email>" format, parse it
            match = re.match(r"^(.+?)\s*<(.+?)>$", sender_email)
            if match:
                if not sender_name:
                    sender_name = match.group(1).strip()
                sender_email = match.group(2).strip().lower()

            domain = _extract_domain(sender_email)
            if not domain or _should_exclude_domain(domain):
                continue

            if domain not in domain_senders:
                domain_senders[domain] = []
            domain_senders[domain].append((sender_email, sender_name))

        # Step e: For each unique domain -> create or find supplier
        for domain, senders in domain_senders.items():
            if domain in domain_to_supplier:
                supplier = domain_to_supplier[domain]
                stats["suppliers_existing"] += 1
            else:
                company_name = _prettify_domain(domain)
                supplier = Supplier(
                    company=company_name,
                    domain=domain,
                )
                db.add(supplier)
                await db.flush()  # Get the ID assigned
                domain_to_supplier[domain] = supplier
                stats["suppliers_created"] += 1
                logger.info(
                    "Created supplier: %s (domain: %s)", company_name, domain
                )

            # Step f: For each unique email -> create or find contact
            seen_emails_in_domain: set[str] = set()
            for sender_email, sender_name in senders:
                if sender_email in seen_emails_in_domain:
                    continue
                seen_emails_in_domain.add(sender_email)

                if sender_email in email_to_contact:
                    stats["contacts_existing"] += 1
                else:
                    contact = SupplierContact(
                        supplier_id=supplier.id,
                        name=(
                            sender_name
                            or sender_email.split("@")[0]
                            .replace(".", " ")
                            .title()
                        ),
                        email=sender_email,
                    )
                    db.add(contact)
                    email_to_contact[sender_email] = contact
                    stats["contacts_created"] += 1

            # Step g: Link supplier to project
            link_key = (supplier.id, project_code)
            if link_key not in link_keys:
                link = SupplierProject(
                    supplier_id=supplier.id,
                    project_code=project_code,
                    status="active",
                )
                db.add(link)
                link_keys.add(link_key)
                stats["links_created"] += 1

    await db.commit()
    logger.info("Supplier sync complete: %s", stats)
    return stats


# ── Schedule sync from filesystem ─────────────────────────────────────────

async def sync_schedule_from_filesystem(
    db: AsyncSession,
    pmo_root: Path,
    project_code: str,
) -> dict:
    """
    Read schedule.json from a project folder, upsert tasks and milestones.

    Returns a summary dict with counts.
    """
    stats = {
        "tasks_created": 0,
        "tasks_updated": 0,
        "milestones_created": 0,
        "milestones_updated": 0,
    }

    schedule_path = pmo_root / project_code / "schedule.json"
    if not schedule_path.exists():
        return stats

    try:
        with open(schedule_path, "r", encoding="utf-8") as f:
            schedule_data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(
            "Failed to read schedule.json for %s: %s", project_code, e
        )
        return stats

    if not isinstance(schedule_data, dict):
        logger.warning("schedule.json for %s is not a dict", project_code)
        return stats

    # ── Tasks ──
    tasks = schedule_data.get("tasks", [])
    for task_data in tasks:
        if not isinstance(task_data, dict):
            continue

        task_id = task_data.get("task_id") or task_data.get("id")
        if not task_id:
            continue

        # Check if task already exists
        result = await db.execute(
            select(ScheduleTask).where(
                ScheduleTask.project_code == project_code,
                ScheduleTask.task_id == str(task_id),
            )
        )
        existing_task = result.scalar_one_or_none()

        task_fields = {
            "name": task_data.get("name", ""),
            "category": task_data.get("category"),
            "start_date": _parse_date(task_data.get("start_date")),
            "end_date": _parse_date(task_data.get("end_date")),
            "status": task_data.get("status", "pending"),
            "depends_on": (
                json.dumps(task_data["depends_on"])
                if task_data.get("depends_on")
                else None
            ),
            "assignee": task_data.get("assignee"),
            "supplier": task_data.get("supplier"),
            "notes": task_data.get("notes"),
            "is_critical": task_data.get("is_critical", False),
        }

        if existing_task:
            for key, value in task_fields.items():
                setattr(existing_task, key, value)
            stats["tasks_updated"] += 1
        else:
            new_task = ScheduleTask(
                project_code=project_code,
                task_id=str(task_id),
                **task_fields,
            )
            db.add(new_task)
            stats["tasks_created"] += 1

    # ── Milestones ──
    milestones = schedule_data.get("milestones", [])
    for ms_data in milestones:
        if not isinstance(ms_data, dict):
            continue

        milestone_id = ms_data.get("milestone_id") or ms_data.get("id")
        if not milestone_id:
            continue

        result = await db.execute(
            select(ScheduleMilestone).where(
                ScheduleMilestone.project_code == project_code,
                ScheduleMilestone.milestone_id == str(milestone_id),
            )
        )
        existing_ms = result.scalar_one_or_none()

        ms_fields = {
            "name": ms_data.get("name", ""),
            "target_date": _parse_date(ms_data.get("target_date")),
            "status": ms_data.get("status", "on_track"),
        }

        if existing_ms:
            for key, value in ms_fields.items():
                setattr(existing_ms, key, value)
            stats["milestones_updated"] += 1
        else:
            new_ms = ScheduleMilestone(
                project_code=project_code,
                milestone_id=str(milestone_id),
                **ms_fields,
            )
            db.add(new_ms)
            stats["milestones_created"] += 1

    await db.commit()
    logger.info("Schedule sync for %s complete: %s", project_code, stats)
    return stats


def _parse_date(value) -> date | None:
    """Parse a date string in ISO format or common formats."""
    if value is None:
        return None
    if isinstance(value, date):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(value, fmt).date()
            except ValueError:
                continue
        # Try ISO 8601 with time component
        try:
            return datetime.fromisoformat(
                value.replace("Z", "+00:00")
            ).date()
        except (ValueError, TypeError):
            pass
    return None


# ── Full initial sync ─────────────────────────────────────────────────────

async def run_initial_sync(
    db: AsyncSession,
    pmo_root: Path,
    config_root: Path,
) -> dict:
    """
    Run full sync on startup: suppliers from emails + schedules for all
    projects.

    Returns combined stats.
    """
    logger.info("Starting initial sync...")

    pmo_root = Path(pmo_root)
    config_root = Path(config_root)

    # Sync suppliers from emails
    supplier_stats = await sync_suppliers_from_emails(
        db, pmo_root, config_root
    )

    # Sync schedules for all projects
    schedule_stats: dict[str, dict] = {}
    project_codes_path = config_root / "project-codes.json"
    if project_codes_path.exists():
        try:
            with open(project_codes_path, "r", encoding="utf-8") as f:
                project_codes_data = json.load(f)

            if isinstance(project_codes_data, list):
                project_codes = [
                    p.get("code") or p.get("project_code")
                    for p in project_codes_data
                    if isinstance(p, dict)
                ]
            elif isinstance(project_codes_data, dict):
                project_codes = list(project_codes_data.keys())
            else:
                project_codes = []

            for code in project_codes:
                if code:
                    s = await sync_schedule_from_filesystem(
                        db, pmo_root, code
                    )
                    if any(v > 0 for v in s.values()):
                        schedule_stats[code] = s

        except (json.JSONDecodeError, OSError) as e:
            logger.error(
                "Failed to load project codes for schedule sync: %s", e
            )

    combined = {
        "suppliers": supplier_stats,
        "schedules": schedule_stats,
    }
    logger.info("Initial sync complete: %s", combined)
    return combined
