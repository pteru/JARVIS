"""Supplier CRUD REST API router."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    Supplier,
    SupplierCatalog,
    SupplierContact,
    SupplierProject,
    SupplierQuote,
)
from ..schemas import (
    CatalogCreate,
    CatalogOut,
    ContactCreate,
    ContactOut,
    ContactUpdate,
    QuoteCreate,
    QuoteOut,
    QuoteUpdate,
    SupplierCreate,
    SupplierDetail,
    SupplierProjectCreate,
    SupplierProjectOut,
    SupplierSummary,
    SupplierUpdate,
)

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_supplier_or_404(
    db: AsyncSession, supplier_id: int
) -> Supplier:
    result = await db.execute(
        select(Supplier)
        .options(
            selectinload(Supplier.contacts),
            selectinload(Supplier.projects),
            selectinload(Supplier.quotes),
            selectinload(Supplier.catalogs),
        )
        .where(Supplier.id == supplier_id)
    )
    supplier = result.scalar_one_or_none()
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Supplier {supplier_id} not found",
        )
    return supplier


def _supplier_to_detail(supplier: Supplier) -> SupplierDetail:
    return SupplierDetail(
        id=supplier.id,
        company=supplier.company,
        domain=supplier.domain,
        category=supplier.category,
        country=supplier.country,
        website=supplier.website,
        notes=supplier.notes,
        created_at=supplier.created_at,
        updated_at=supplier.updated_at,
        contact_count=len(supplier.contacts),
        project_codes=[p.project_code for p in supplier.projects],
        quote_count=len(supplier.quotes),
        catalog_count=len(supplier.catalogs),
        contacts=[ContactOut.model_validate(c) for c in supplier.contacts],
        projects=[SupplierProjectOut.model_validate(p) for p in supplier.projects],
        quotes=[QuoteOut.model_validate(q) for q in supplier.quotes],
        catalogs=[CatalogOut.model_validate(c) for c in supplier.catalogs],
    )


# ---------------------------------------------------------------------------
# Supplier CRUD
# ---------------------------------------------------------------------------


@router.get("", response_model=list[SupplierSummary])
async def list_suppliers(
    search: Optional[str] = Query(None, description="Search by company name"),
    category: Optional[str] = Query(None, description="Filter by category"),
    project_code: Optional[str] = Query(None, description="Filter by project code"),
    db: AsyncSession = Depends(get_db),
):
    """List all suppliers with summary statistics."""
    # Build base query with eager loading for counts
    stmt = (
        select(Supplier)
        .options(
            selectinload(Supplier.contacts),
            selectinload(Supplier.projects),
            selectinload(Supplier.quotes),
            selectinload(Supplier.catalogs),
        )
    )

    if search:
        stmt = stmt.where(Supplier.company.ilike(f"%{search}%"))
    if category:
        stmt = stmt.where(Supplier.category == category)
    if project_code:
        stmt = stmt.join(Supplier.projects).where(
            SupplierProject.project_code == project_code
        )

    result = await db.execute(stmt)
    suppliers = result.scalars().unique().all()

    return [
        SupplierSummary(
            id=s.id,
            company=s.company,
            category=s.category,
            country=s.country,
            contact_count=len(s.contacts),
            project_codes=[p.project_code for p in s.projects],
            quote_count=len(s.quotes),
            catalog_count=len(s.catalogs),
        )
        for s in suppliers
    ]


@router.post("", response_model=SupplierDetail, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    body: SupplierCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new supplier."""
    # Check for duplicate company name
    existing = await db.execute(
        select(Supplier).where(Supplier.company == body.company)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Supplier '{body.company}' already exists",
        )

    supplier = Supplier(**body.model_dump())
    db.add(supplier)
    await db.flush()
    await db.refresh(supplier)
    return _supplier_to_detail(supplier)


@router.get("/{supplier_id}", response_model=SupplierDetail)
async def get_supplier(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get full supplier detail with nested contacts, projects, quotes, and catalogs."""
    supplier = await _get_supplier_or_404(db, supplier_id)
    return _supplier_to_detail(supplier)


@router.put("/{supplier_id}", response_model=SupplierDetail)
async def update_supplier(
    supplier_id: int,
    body: SupplierUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update supplier fields."""
    supplier = await _get_supplier_or_404(db, supplier_id)
    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(supplier, key, value)
    await db.flush()
    await db.refresh(supplier)
    # Re-fetch with relationships loaded
    supplier = await _get_supplier_or_404(db, supplier_id)
    return _supplier_to_detail(supplier)


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_supplier(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a supplier and all related records (cascade)."""
    supplier = await _get_supplier_or_404(db, supplier_id)
    await db.delete(supplier)
    await db.flush()
    return None


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------


@router.post(
    "/{supplier_id}/contacts",
    response_model=ContactOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_contact(
    supplier_id: int,
    body: ContactCreate,
    db: AsyncSession = Depends(get_db),
):
    """Add a contact to a supplier."""
    await _get_supplier_or_404(db, supplier_id)
    contact = SupplierContact(supplier_id=supplier_id, **body.model_dump())
    db.add(contact)
    await db.flush()
    await db.refresh(contact)
    return ContactOut.model_validate(contact)


@router.put(
    "/{supplier_id}/contacts/{contact_id}",
    response_model=ContactOut,
)
async def update_contact(
    supplier_id: int,
    contact_id: int,
    body: ContactUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a supplier contact."""
    await _get_supplier_or_404(db, supplier_id)
    result = await db.execute(
        select(SupplierContact).where(
            SupplierContact.id == contact_id,
            SupplierContact.supplier_id == supplier_id,
        )
    )
    contact = result.scalar_one_or_none()
    if contact is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Contact {contact_id} not found for supplier {supplier_id}",
        )
    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(contact, key, value)
    await db.flush()
    await db.refresh(contact)
    return ContactOut.model_validate(contact)


@router.delete(
    "/{supplier_id}/contacts/{contact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_contact(
    supplier_id: int,
    contact_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Remove a contact from a supplier."""
    result = await db.execute(
        select(SupplierContact).where(
            SupplierContact.id == contact_id,
            SupplierContact.supplier_id == supplier_id,
        )
    )
    contact = result.scalar_one_or_none()
    if contact is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Contact {contact_id} not found for supplier {supplier_id}",
        )
    await db.delete(contact)
    await db.flush()
    return None


# ---------------------------------------------------------------------------
# Catalogs
# ---------------------------------------------------------------------------


@router.post(
    "/{supplier_id}/catalogs",
    response_model=CatalogOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_catalog(
    supplier_id: int,
    body: CatalogCreate,
    db: AsyncSession = Depends(get_db),
):
    """Add a catalog/document to a supplier."""
    await _get_supplier_or_404(db, supplier_id)
    catalog = SupplierCatalog(supplier_id=supplier_id, **body.model_dump())
    db.add(catalog)
    await db.flush()
    await db.refresh(catalog)
    return CatalogOut.model_validate(catalog)


@router.delete(
    "/{supplier_id}/catalogs/{catalog_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_catalog(
    supplier_id: int,
    catalog_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Remove a catalog entry from a supplier."""
    result = await db.execute(
        select(SupplierCatalog).where(
            SupplierCatalog.id == catalog_id,
            SupplierCatalog.supplier_id == supplier_id,
        )
    )
    catalog = result.scalar_one_or_none()
    if catalog is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Catalog {catalog_id} not found for supplier {supplier_id}",
        )
    await db.delete(catalog)
    await db.flush()
    return None


# ---------------------------------------------------------------------------
# Quotes
# ---------------------------------------------------------------------------


@router.get("/{supplier_id}/quotes", response_model=list[QuoteOut])
async def list_quotes(
    supplier_id: int,
    db: AsyncSession = Depends(get_db),
):
    """List all quotes for a supplier."""
    await _get_supplier_or_404(db, supplier_id)
    result = await db.execute(
        select(SupplierQuote)
        .where(SupplierQuote.supplier_id == supplier_id)
        .order_by(SupplierQuote.created_at.desc())
    )
    quotes = result.scalars().all()
    return [QuoteOut.model_validate(q) for q in quotes]


@router.post(
    "/{supplier_id}/quotes",
    response_model=QuoteOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_quote(
    supplier_id: int,
    body: QuoteCreate,
    db: AsyncSession = Depends(get_db),
):
    """Add a quote to a supplier."""
    await _get_supplier_or_404(db, supplier_id)
    quote = SupplierQuote(supplier_id=supplier_id, **body.model_dump())
    db.add(quote)
    await db.flush()
    await db.refresh(quote)
    return QuoteOut.model_validate(quote)


@router.put("/{supplier_id}/quotes/{quote_id}", response_model=QuoteOut)
async def update_quote(
    supplier_id: int,
    quote_id: int,
    body: QuoteUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a quote."""
    result = await db.execute(
        select(SupplierQuote).where(
            SupplierQuote.id == quote_id,
            SupplierQuote.supplier_id == supplier_id,
        )
    )
    quote = result.scalar_one_or_none()
    if quote is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quote {quote_id} not found for supplier {supplier_id}",
        )
    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(quote, key, value)
    await db.flush()
    await db.refresh(quote)
    return QuoteOut.model_validate(quote)


@router.delete(
    "/{supplier_id}/quotes/{quote_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_quote(
    supplier_id: int,
    quote_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Remove a quote from a supplier."""
    result = await db.execute(
        select(SupplierQuote).where(
            SupplierQuote.id == quote_id,
            SupplierQuote.supplier_id == supplier_id,
        )
    )
    quote = result.scalar_one_or_none()
    if quote is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quote {quote_id} not found for supplier {supplier_id}",
        )
    await db.delete(quote)
    await db.flush()
    return None


# ---------------------------------------------------------------------------
# Supplier-Project Links
# ---------------------------------------------------------------------------


@router.post(
    "/{supplier_id}/projects",
    response_model=SupplierProjectOut,
    status_code=status.HTTP_201_CREATED,
)
async def link_project(
    supplier_id: int,
    body: SupplierProjectCreate,
    db: AsyncSession = Depends(get_db),
):
    """Link a supplier to a project."""
    await _get_supplier_or_404(db, supplier_id)
    # Check for existing link
    existing = await db.execute(
        select(SupplierProject).where(
            SupplierProject.supplier_id == supplier_id,
            SupplierProject.project_code == body.project_code,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Supplier {supplier_id} is already linked to "
                f"project {body.project_code}"
            ),
        )
    sp = SupplierProject(supplier_id=supplier_id, **body.model_dump())
    db.add(sp)
    await db.flush()
    await db.refresh(sp)
    return SupplierProjectOut.model_validate(sp)
