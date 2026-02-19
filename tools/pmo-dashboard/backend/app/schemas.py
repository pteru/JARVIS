"""Pydantic v2 schemas for all API request/response models."""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


# ---- Project Schemas ----


class ProjectSummary(BaseModel):
    code: str
    name: str
    language: str
    email_count: int = 0
    unread_count: int = 0
    latest_email_date: str | None = None
    document_count: int = 0
    phase: str | None = None
    product_line: str = ""


class TimelineEvent(BaseModel):
    date: str
    event: str
    sender: str | None = None
    category: str | None = None
    details: str | None = None


class ProjectDetail(ProjectSummary):
    technical_report: str | None = None
    timeline: list[TimelineEvent] = []


# ---- Email Schemas ----


class EmailAttachment(BaseModel):
    filename: str
    path: str
    text_preview: str = ""


class EmailSummary(BaseModel):
    hash: str
    source_file: str | None = None
    subject: str
    sender_name: str
    sender_email: str
    recipients: list[str] = []
    date: str
    project_code: str
    attachments: list[EmailAttachment] = []
    category: str | None = None


class EmailDetail(EmailSummary):
    body_text: str | None = None
    body_html: str | None = None
    headers: dict[str, Any] = {}
    heuristics: dict[str, Any] = {}
    message_id: str | None = None
    in_reply_to: str | None = None
    references: str | None = None


# ---- Document Schemas ----


class Document(BaseModel):
    name: str
    path: str
    directory: str
    size_bytes: int = 0
    modified_at: str | None = None


# ---- Supplier Schemas ----


class SupplierCreate(BaseModel):
    company: str
    domain: str | None = None
    category: str | None = None
    country: str | None = None
    website: str | None = None
    notes: str | None = None


class SupplierUpdate(BaseModel):
    company: str | None = None
    domain: str | None = None
    category: str | None = None
    country: str | None = None
    website: str | None = None
    notes: str | None = None


class SupplierSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company: str
    category: str | None = None
    country: str | None = None
    contact_count: int = 0
    project_codes: list[str] = []
    quote_count: int = 0
    catalog_count: int = 0


class ContactCreate(BaseModel):
    name: str
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    is_primary: bool = False


class ContactUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    role: str | None = None
    is_primary: bool | None = None


class Contact(ContactCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    created_at: datetime | None = None


class CatalogCreate(BaseModel):
    title: str
    description: str | None = None
    file_path: str | None = None
    file_url: str | None = None
    doc_type: str | None = None


class Catalog(CatalogCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    uploaded_at: datetime | None = None


class QuoteCreate(BaseModel):
    project_code: str | None = None
    reference: str | None = None
    description: str
    amount: float | None = None
    currency: str = "USD"
    lead_time_days: int | None = None
    valid_until: str | None = None
    status: str = "received"
    attachment_path: str | None = None
    notes: str | None = None
    received_at: str | None = None


class QuoteUpdate(BaseModel):
    project_code: str | None = None
    reference: str | None = None
    description: str | None = None
    amount: float | None = None
    currency: str | None = None
    lead_time_days: int | None = None
    valid_until: str | None = None
    status: str | None = None
    attachment_path: str | None = None
    notes: str | None = None
    received_at: str | None = None


class Quote(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    project_code: str | None = None
    reference: str | None = None
    description: str
    amount: float | None = None
    currency: str = "USD"
    lead_time_days: int | None = None
    valid_until: str | None = None
    status: str = "received"
    attachment_path: str | None = None
    notes: str | None = None
    received_at: str | None = None


class SupplierProjectCreate(BaseModel):
    project_code: str
    role: str | None = None
    status: str = "active"


class SupplierProjectInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    supplier_id: int
    project_code: str
    role: str | None = None
    status: str = "active"


class SupplierDetail(SupplierSummary):
    domain: str | None = None
    website: str | None = None
    notes: str | None = None
    contacts: list[Contact] = []
    projects: list[SupplierProjectInfo] = []
    quotes: list[Quote] = []
    catalogs: list[Catalog] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ---- Schedule Schemas ----


class ScheduleTaskCreate(BaseModel):
    task_id: str
    name: str
    category: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: str = "pending"
    depends_on: str | None = None
    assignee: str | None = None
    supplier: str | None = None
    notes: str | None = None
    is_critical: bool = False


class ScheduleTaskUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: str | None = None
    depends_on: str | None = None
    assignee: str | None = None
    supplier: str | None = None
    notes: str | None = None
    is_critical: bool | None = None


class ScheduleTask(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_code: str
    task_id: str
    name: str
    category: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    status: str = "pending"
    depends_on: str | None = None
    assignee: str | None = None
    supplier: str | None = None
    notes: str | None = None
    is_critical: bool = False


class ScheduleMilestone(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_code: str
    milestone_id: str
    name: str
    target_date: str | None = None
    status: str = "on_track"


class ScheduleData(BaseModel):
    tasks: list[ScheduleTask] = []
    milestones: list[ScheduleMilestone] = []


# ---- Alert Schemas ----


class AlertCreate(BaseModel):
    project_code: str | None = None
    alert_type: str
    severity: str = "warning"
    title: str
    message: str | None = None


class Alert(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_code: str | None = None
    alert_type: str
    severity: str = "warning"
    title: str
    message: str | None = None
    is_read: bool = False
    dismissed_at: datetime | None = None
    created_at: datetime | None = None


# ---- Search & Pagination Schemas ----


class SearchResult(BaseModel):
    type: str
    project_code: str | None = None
    title: str
    snippet: str = ""
    path: str | None = None
    score: float = 0.0


class PaginatedResponse(BaseModel):
    items: list[Any] = []
    total: int = 0
    page: int = 1
    per_page: int = 50
    pages: int = 1


class SearchResponse(BaseModel):
    query: str
    total: int
    results: list[SearchResult] = []


# ---- Aliases for backward compatibility ----

ContactOut = Contact
CatalogOut = Catalog
QuoteOut = Quote
SupplierProjectOut = SupplierProjectInfo
AlertOut = Alert
ScheduleTaskOut = ScheduleTask
ScheduleMilestoneOut = ScheduleMilestone
