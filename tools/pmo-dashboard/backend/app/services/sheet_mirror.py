"""
Google Sheets Bidirectional Sync for Supplier Data

Required dependencies (add to requirements.txt):
    google-auth
    google-api-python-client

Uses a GCP service account for authentication.
The sheet must be shared with the service account email.
"""

import asyncio
import logging
from datetime import date, datetime
from functools import partial

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Supplier,
    SupplierContact,
    SupplierProject,
    SupplierCatalog,
    SupplierQuote,
)

logger = logging.getLogger(__name__)

# Google Sheets API scopes
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

# Sheet names and their column headers
SHEET_CONFIG = {
    "Suppliers": [
        "ID", "Company", "Domain", "Category", "Country", "Website", "Notes",
    ],
    "Contacts": [
        "ID", "Supplier ID", "Company", "Name", "Email", "Phone", "Role",
        "Primary",
    ],
    "Quotes": [
        "ID", "Supplier ID", "Company", "Project", "Reference",
        "Description", "Amount", "Currency", "Lead Time (days)",
        "Valid Until", "Status", "Received Date",
    ],
    "Catalogs": [
        "ID", "Supplier ID", "Company", "Title", "Description", "Type",
        "File Path", "URL",
    ],
}


def _to_str(value) -> str:
    """Convert a value to a string safe for Google Sheets."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _parse_int(value) -> int | None:
    """Parse an integer from a sheet cell value."""
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return None


def _parse_float(value) -> float | None:
    """Parse a float from a sheet cell value."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _parse_bool(value) -> bool:
    """Parse a boolean from a sheet cell value."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().upper() in ("TRUE", "1", "YES")
    return bool(value) if value else False


class SheetMirror:
    """Bidirectional sync between SQLite supplier data and Google Sheets."""

    def __init__(self, credentials_path: str, sheet_id: str):
        """
        Initialize with GCP service account credentials and target sheet ID.

        Args:
            credentials_path: Path to the service account JSON key file.
            sheet_id: Google Sheets spreadsheet ID.
        """
        self.credentials_path = credentials_path
        self.sheet_id = sheet_id
        self._creds: Credentials | None = None
        self._service = None

    def _get_service(self):
        """Lazily build the Google Sheets API service."""
        if self._service is None:
            self._creds = Credentials.from_service_account_file(
                self.credentials_path, scopes=SCOPES
            )
            self._service = build(
                "sheets", "v4", credentials=self._creds, cache_discovery=False
            )
        return self._service

    def _sheets_api(self):
        """Get the spreadsheets resource."""
        return self._get_service().spreadsheets()

    # ── Helpers for running blocking API calls in async context ────────────

    async def _run_in_executor(self, func, *args, **kwargs):
        """Run a blocking function in the default executor."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, partial(func, *args, **kwargs)
        )

    # ── Ensure sheet tabs exist ───────────────────────────────────────────

    def _ensure_sheets_exist_sync(self):
        """Create sheet tabs if they don't already exist."""
        api = self._sheets_api()
        spreadsheet = api.get(spreadsheetId=self.sheet_id).execute()
        existing_titles = {
            s["properties"]["title"]
            for s in spreadsheet.get("sheets", [])
        }

        requests = []
        for title in SHEET_CONFIG:
            if title not in existing_titles:
                requests.append({
                    "addSheet": {
                        "properties": {"title": title}
                    }
                })

        if requests:
            api.batchUpdate(
                spreadsheetId=self.sheet_id,
                body={"requests": requests},
            ).execute()

    # ── Sync TO Sheet (DB -> Sheet) ───────────────────────────────────────

    async def sync_to_sheet(self, db: AsyncSession) -> dict:
        """
        Export all supplier data to the Google Sheet.

        Clears existing content and rewrites everything.

        Returns:
            dict with status, sheet_url, and row counts.
        """
        # Fetch all data from DB
        suppliers_result = await db.execute(
            select(Supplier).order_by(Supplier.id)
        )
        suppliers = suppliers_result.scalars().all()

        contacts_result = await db.execute(
            select(SupplierContact).order_by(SupplierContact.id)
        )
        contacts = contacts_result.scalars().all()

        quotes_result = await db.execute(
            select(SupplierQuote).order_by(SupplierQuote.id)
        )
        quotes = quotes_result.scalars().all()

        catalogs_result = await db.execute(
            select(SupplierCatalog).order_by(SupplierCatalog.id)
        )
        catalogs = catalogs_result.scalars().all()

        # Build supplier ID -> company name lookup
        supplier_map: dict[int, str] = {s.id: s.company for s in suppliers}

        # Build sheet data
        suppliers_data = [SHEET_CONFIG["Suppliers"]]  # Header row
        for s in suppliers:
            suppliers_data.append([
                _to_str(s.id),
                _to_str(s.company),
                _to_str(s.domain),
                _to_str(s.category),
                _to_str(s.country),
                _to_str(s.website),
                _to_str(s.notes),
            ])

        contacts_data = [SHEET_CONFIG["Contacts"]]
        for c in contacts:
            contacts_data.append([
                _to_str(c.id),
                _to_str(c.supplier_id),
                _to_str(supplier_map.get(c.supplier_id, "")),
                _to_str(c.name),
                _to_str(c.email),
                _to_str(c.phone),
                _to_str(c.role),
                _to_str(c.is_primary),
            ])

        quotes_data = [SHEET_CONFIG["Quotes"]]
        for q in quotes:
            quotes_data.append([
                _to_str(q.id),
                _to_str(q.supplier_id),
                _to_str(supplier_map.get(q.supplier_id, "")),
                _to_str(q.project_code),
                _to_str(q.reference),
                _to_str(q.description),
                _to_str(q.amount),
                _to_str(q.currency),
                _to_str(q.lead_time_days),
                _to_str(q.valid_until),
                _to_str(q.status),
                _to_str(q.received_at),
            ])

        catalogs_data = [SHEET_CONFIG["Catalogs"]]
        for cat in catalogs:
            catalogs_data.append([
                _to_str(cat.id),
                _to_str(cat.supplier_id),
                _to_str(supplier_map.get(cat.supplier_id, "")),
                _to_str(cat.title),
                _to_str(cat.description),
                _to_str(cat.doc_type),
                _to_str(cat.file_path),
                _to_str(cat.file_url),
            ])

        # Write to sheet (blocking calls via executor)
        def _write_all():
            self._ensure_sheets_exist_sync()
            api = self._sheets_api().values()

            # Clear and write each sheet
            for sheet_name, data in [
                ("Suppliers", suppliers_data),
                ("Contacts", contacts_data),
                ("Quotes", quotes_data),
                ("Catalogs", catalogs_data),
            ]:
                # Clear the entire sheet
                api.clear(
                    spreadsheetId=self.sheet_id,
                    range=f"'{sheet_name}'",
                ).execute()

                # Write data
                if data:
                    api.update(
                        spreadsheetId=self.sheet_id,
                        range=f"'{sheet_name}'!A1",
                        valueInputOption="RAW",
                        body={"values": data},
                    ).execute()

        await self._run_in_executor(_write_all)

        sheet_url = f"https://docs.google.com/spreadsheets/d/{self.sheet_id}"
        result = {
            "status": "success",
            "sheet_url": sheet_url,
            "rows_synced": {
                "suppliers": len(suppliers),
                "contacts": len(contacts),
                "quotes": len(quotes),
                "catalogs": len(catalogs),
            },
        }
        logger.info("Synced to sheet: %s", result)
        return result

    # ── Sync FROM Sheet (Sheet -> DB) ─────────────────────────────────────

    async def sync_from_sheet(self, db: AsyncSession) -> dict:
        """
        Read the Google Sheet and upsert into SQLite.

        - Rows with an ID column value: matched and updated in DB.
        - Rows without an ID (empty or zero): created as new records.
        - Rows deleted from the sheet are NOT deleted from DB (safety).

        Returns:
            dict with status and counts of imported/updated records.
        """
        stats = {
            "status": "success",
            "suppliers": {"imported": 0, "updated": 0},
            "contacts": {"imported": 0, "updated": 0},
            "quotes": {"imported": 0, "updated": 0},
            "catalogs": {"imported": 0, "updated": 0},
        }

        # Read all sheets
        def _read_all():
            self._ensure_sheets_exist_sync()
            api = self._sheets_api().values()
            result = {}
            for sheet_name in SHEET_CONFIG:
                try:
                    resp = api.get(
                        spreadsheetId=self.sheet_id,
                        range=f"'{sheet_name}'",
                    ).execute()
                    result[sheet_name] = resp.get("values", [])
                except Exception as e:
                    logger.warning(
                        "Failed to read sheet '%s': %s", sheet_name, e
                    )
                    result[sheet_name] = []
            return result

        all_data = await self._run_in_executor(_read_all)

        # ── Process Suppliers ──
        supplier_rows = all_data.get("Suppliers", [])
        if len(supplier_rows) > 1:  # Skip header
            for row in supplier_rows[1:]:
                row = _pad_row(row, 7)
                row_id = _parse_int(row[0])
                company = row[1].strip() if row[1] else ""
                if not company:
                    continue

                if row_id:
                    # Update existing
                    result = await db.execute(
                        select(Supplier).where(Supplier.id == row_id)
                    )
                    supplier = result.scalar_one_or_none()
                    if supplier:
                        supplier.company = company
                        supplier.domain = row[2].strip() or supplier.domain
                        supplier.category = row[3].strip() or None
                        supplier.country = row[4].strip() or None
                        supplier.website = row[5].strip() or None
                        supplier.notes = row[6].strip() or None
                        stats["suppliers"]["updated"] += 1
                        continue

                # Try to match by company name
                result = await db.execute(
                    select(Supplier).where(Supplier.company == company)
                )
                existing = result.scalar_one_or_none()

                if existing:
                    existing.domain = row[2].strip() or existing.domain
                    existing.category = row[3].strip() or None
                    existing.country = row[4].strip() or None
                    existing.website = row[5].strip() or None
                    existing.notes = row[6].strip() or None
                    stats["suppliers"]["updated"] += 1
                else:
                    new_supplier = Supplier(
                        company=company,
                        domain=row[2].strip() or None,
                        category=row[3].strip() or None,
                        country=row[4].strip() or None,
                        website=row[5].strip() or None,
                        notes=row[6].strip() or None,
                    )
                    db.add(new_supplier)
                    stats["suppliers"]["imported"] += 1

        await db.flush()

        # Rebuild supplier lookup for contacts/quotes/catalogs matching
        suppliers_result = await db.execute(select(Supplier))
        supplier_by_id: dict[int, Supplier] = {}
        supplier_by_name: dict[str, Supplier] = {}
        for s in suppliers_result.scalars().all():
            supplier_by_id[s.id] = s
            supplier_by_name[s.company.lower()] = s

        # ── Process Contacts ──
        contact_rows = all_data.get("Contacts", [])
        if len(contact_rows) > 1:
            for row in contact_rows[1:]:
                row = _pad_row(row, 8)
                row_id = _parse_int(row[0])
                supplier_id = _parse_int(row[1])
                company_name = row[2].strip() if row[2] else ""
                name = row[3].strip() if row[3] else ""
                email = row[4].strip() if row[4] else ""

                if not name:
                    continue

                # Resolve supplier_id
                resolved_supplier_id = _resolve_supplier_id(
                    supplier_id, company_name, supplier_by_id, supplier_by_name
                )
                if not resolved_supplier_id:
                    logger.warning(
                        "Could not resolve supplier for contact '%s'", name
                    )
                    continue

                if row_id:
                    result = await db.execute(
                        select(SupplierContact).where(
                            SupplierContact.id == row_id
                        )
                    )
                    contact = result.scalar_one_or_none()
                    if contact:
                        contact.supplier_id = resolved_supplier_id
                        contact.name = name
                        contact.email = email or contact.email
                        contact.phone = row[5].strip() or contact.phone
                        contact.role = row[6].strip() or contact.role
                        contact.is_primary = _parse_bool(row[7])
                        stats["contacts"]["updated"] += 1
                        continue

                # Match by email (composite key)
                if email:
                    result = await db.execute(
                        select(SupplierContact).where(
                            SupplierContact.email == email,
                            SupplierContact.supplier_id == resolved_supplier_id,
                        )
                    )
                    existing = result.scalar_one_or_none()
                    if existing:
                        existing.name = name
                        existing.phone = row[5].strip() or existing.phone
                        existing.role = row[6].strip() or existing.role
                        existing.is_primary = _parse_bool(row[7])
                        stats["contacts"]["updated"] += 1
                        continue

                new_contact = SupplierContact(
                    supplier_id=resolved_supplier_id,
                    name=name,
                    email=email or None,
                    phone=row[5].strip() or None,
                    role=row[6].strip() or None,
                    is_primary=_parse_bool(row[7]),
                )
                db.add(new_contact)
                stats["contacts"]["imported"] += 1

        # ── Process Quotes ──
        quote_rows = all_data.get("Quotes", [])
        if len(quote_rows) > 1:
            for row in quote_rows[1:]:
                row = _pad_row(row, 12)
                row_id = _parse_int(row[0])
                supplier_id = _parse_int(row[1])
                company_name = row[2].strip() if row[2] else ""
                description = row[5].strip() if row[5] else ""

                if not description:
                    continue

                resolved_supplier_id = _resolve_supplier_id(
                    supplier_id, company_name, supplier_by_id, supplier_by_name
                )
                if not resolved_supplier_id:
                    logger.warning(
                        "Could not resolve supplier for quote '%s'",
                        description,
                    )
                    continue

                if row_id:
                    result = await db.execute(
                        select(SupplierQuote).where(
                            SupplierQuote.id == row_id
                        )
                    )
                    quote = result.scalar_one_or_none()
                    if quote:
                        quote.supplier_id = resolved_supplier_id
                        quote.project_code = row[3].strip() or None
                        quote.reference = row[4].strip() or None
                        quote.description = description
                        quote.amount = _parse_float(row[6])
                        quote.currency = row[7].strip() or "USD"
                        quote.lead_time_days = _parse_int(row[8])
                        quote.valid_until = row[9].strip() or None
                        quote.status = row[10].strip() or "received"
                        quote.received_at = row[11].strip() or None
                        stats["quotes"]["updated"] += 1
                        continue

                # Match by reference + supplier (composite key)
                reference = row[4].strip() if row[4] else ""
                if reference:
                    result = await db.execute(
                        select(SupplierQuote).where(
                            SupplierQuote.reference == reference,
                            SupplierQuote.supplier_id == resolved_supplier_id,
                        )
                    )
                    existing = result.scalar_one_or_none()
                    if existing:
                        existing.project_code = row[3].strip() or None
                        existing.description = description
                        existing.amount = _parse_float(row[6])
                        existing.currency = row[7].strip() or "USD"
                        existing.lead_time_days = _parse_int(row[8])
                        existing.valid_until = row[9].strip() or None
                        existing.status = row[10].strip() or "received"
                        existing.received_at = row[11].strip() or None
                        stats["quotes"]["updated"] += 1
                        continue

                new_quote = SupplierQuote(
                    supplier_id=resolved_supplier_id,
                    project_code=row[3].strip() or None,
                    reference=reference or None,
                    description=description,
                    amount=_parse_float(row[6]),
                    currency=row[7].strip() or "USD",
                    lead_time_days=_parse_int(row[8]),
                    valid_until=row[9].strip() or None,
                    status=row[10].strip() or "received",
                    received_at=row[11].strip() or None,
                )
                db.add(new_quote)
                stats["quotes"]["imported"] += 1

        # ── Process Catalogs ──
        catalog_rows = all_data.get("Catalogs", [])
        if len(catalog_rows) > 1:
            for row in catalog_rows[1:]:
                row = _pad_row(row, 8)
                row_id = _parse_int(row[0])
                supplier_id = _parse_int(row[1])
                company_name = row[2].strip() if row[2] else ""
                title = row[3].strip() if row[3] else ""

                if not title:
                    continue

                resolved_supplier_id = _resolve_supplier_id(
                    supplier_id, company_name, supplier_by_id, supplier_by_name
                )
                if not resolved_supplier_id:
                    logger.warning(
                        "Could not resolve supplier for catalog '%s'", title
                    )
                    continue

                if row_id:
                    result = await db.execute(
                        select(SupplierCatalog).where(
                            SupplierCatalog.id == row_id
                        )
                    )
                    catalog = result.scalar_one_or_none()
                    if catalog:
                        catalog.supplier_id = resolved_supplier_id
                        catalog.title = title
                        catalog.description = row[4].strip() or None
                        catalog.doc_type = row[5].strip() or None
                        catalog.file_path = row[6].strip() or None
                        catalog.file_url = row[7].strip() or None
                        stats["catalogs"]["updated"] += 1
                        continue

                # Match by title + supplier (composite key)
                result = await db.execute(
                    select(SupplierCatalog).where(
                        SupplierCatalog.title == title,
                        SupplierCatalog.supplier_id == resolved_supplier_id,
                    )
                )
                existing = result.scalar_one_or_none()
                if existing:
                    existing.description = row[4].strip() or None
                    existing.doc_type = row[5].strip() or None
                    existing.file_path = row[6].strip() or None
                    existing.file_url = row[7].strip() or None
                    stats["catalogs"]["updated"] += 1
                    continue

                new_catalog = SupplierCatalog(
                    supplier_id=resolved_supplier_id,
                    title=title,
                    description=row[4].strip() or None,
                    doc_type=row[5].strip() or None,
                    file_path=row[6].strip() or None,
                    file_url=row[7].strip() or None,
                )
                db.add(new_catalog)
                stats["catalogs"]["imported"] += 1

        await db.commit()
        logger.info("Synced from sheet: %s", stats)
        return stats


def _pad_row(row: list, length: int) -> list:
    """Pad a row with empty strings to ensure it has the expected length."""
    return row + [""] * max(0, length - len(row))


def _resolve_supplier_id(
    supplier_id: int | None,
    company_name: str,
    supplier_by_id: dict[int, Supplier],
    supplier_by_name: dict[str, Supplier],
) -> int | None:
    """
    Resolve a supplier ID from either the explicit ID column or the
    company name.
    """
    if supplier_id and supplier_id in supplier_by_id:
        return supplier_id
    if company_name:
        supplier = supplier_by_name.get(company_name.lower())
        if supplier:
            return supplier.id
    return None
