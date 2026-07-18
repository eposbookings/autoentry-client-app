from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import hmac
import base64
import hashlib
import asyncio
import calendar
import csv
import difflib
import io
import json
import logging
import mimetypes
import os
import re
import smtplib
import socket
import textwrap
import uuid
import zipfile
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from email.message import EmailMessage
from typing import Any, List, Optional
from urllib.parse import urlencode

import bcrypt
import httpx
import jwt
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel, EmailStr
from sqlalchemy import (
    Boolean,
    Column,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    and_,
    delete,
    func,
    insert,
    inspect,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.exc import OperationalError
from starlette.middleware.cors import CORSMiddleware

# ---------- Config ----------
JWT_ALGORITHM = "HS256"
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(ROOT_DIR / "uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DOWNLOADS_DIR = ROOT_DIR / "downloads"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
SUPPORTED_DOCUMENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}
SUPPORTED_DOCUMENT_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
SUPPORTED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}

FONTS_DIR = ROOT_DIR / "assets" / "fonts"
FONT_BOLD_PATH = str(FONTS_DIR / "DejaVuSans-Bold.ttf")
FONT_REGULAR_PATH = str(FONTS_DIR / "DejaVuSans.ttf")


def load_font(bold: bool, size: int):
    """Load a bundled TrueType font at the requested size, with graceful fallback."""
    path = FONT_BOLD_PATH if bold else FONT_REGULAR_PATH
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        for alt in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(alt, size)
            except Exception:
                continue
        logger.warning("DejaVu fonts not found; watermark falling back to tiny default bitmap font. Expected at %s", FONT_BOLD_PATH)
        return ImageFont.load_default()


fernet = Fernet(os.environ["FERNET_KEY"].encode())


def get_database_url() -> str:
    url = (
        os.environ.get("DATABASE_URL")
        or os.environ.get("MYSQL_URL")
        or os.environ.get("SQLALCHEMY_DATABASE_URL")
    )
    if not url:
        url = "sqlite+aiosqlite:///./autoentry_portal.db"
    if url.startswith("mysql://"):
        url = "mysql+asyncmy://" + url[len("mysql://") :]
    return url


DATABASE_URL = get_database_url()
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

metadata = MetaData()

users = Table(
    "users",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("email", String(255), nullable=False, unique=True, index=True),
    Column("password_hash", String(255), nullable=False),
    Column("role", String(32), nullable=False, index=True),
    Column("first_name", String(255)),
    Column("last_name", String(255)),
    Column("business_name", String(255), index=True),
    Column("client_type", String(64)),
    Column("industry", String(255)),
    Column("company_number", String(32)),
    Column("company_status", String(64)),
    Column("incorporation_date", String(32)),
    Column("registered_office_address", Text),
    Column("trading_address", Text),
    Column("phone", String(64)),
    Column("utr", String(64)),
    Column("vat_number", String(64)),
    Column("paye_reference", String(64)),
    Column("accounts_office_reference", String(64)),
    Column("authorisation_codes", Text),
    Column("services_required", Text),
    Column("service_settings", Text),
    Column("statutory_deadlines", Text),
    Column("deadline_tasks", Text),
    Column("bookkeeping_frequency", String(64)),
    Column("payroll_frequency", String(64)),
    Column("year_end", String(32)),
    Column("practice_manager", String(255)),
    Column("companies_house_last_checked", String(64)),
    Column("main_contact_name", String(255)),
    Column("main_contact_role", String(255)),
    Column("company_directors", Text),
    Column("company_pscs", Text),
    Column("company_contacts", Text),
    Column("companies_house_filings", Text),
    Column("autoentry_email", String(255)),
    Column("sales_autoentry_email", String(255)),
    Column("is_vat_client", Boolean, default=False),
    Column("ai_analysis_enabled", Boolean, default=False),
    Column("accounting_destination", String(32), default="external"),
    Column("native_accounting_enabled", Boolean, default=False),
    Column("native_accounting_created_at", String(64)),
    Column("status", String(32), nullable=False, default="active"),
    Column("created_at", String(64)),
)

outstanding_items = Table(
    "outstanding_items",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("type", String(32), nullable=False, index=True),
    Column("description", Text, nullable=False),
    Column("date", String(32)),
    Column("amount", String(64)),
    Column("status", String(32), nullable=False, default="outstanding", index=True),
    Column("created_at", String(64)),
)

submissions = Table(
    "submissions",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("type", String(32), nullable=False, index=True),
    Column("description", Text),
    Column("date", String(32)),
    Column("amount", String(64)),
    Column("comment", Text),
    Column("image_filename", String(255)),
    Column("is_additional", Boolean, default=False),
    Column("ai_review_status", String(32)),
    Column("ai_review_message", Text),
    Column("ai_document_type", String(64)),
    Column("ai_extracted_fields", Text),
    Column("coding_fields", Text),
    Column("ai_client_approved", Boolean, default=False),
    Column("review_status", String(32), default="inbox", index=True),
    Column("reviewed_at", String(64)),
    Column("submitted_at", String(64), index=True),
    Column("client_business_name", String(255)),
    Column("client_first_name", String(255)),
    Column("client_last_name", String(255)),
)

settings = Table(
    "settings",
    metadata,
    Column("key", String(64), primary_key=True),
    Column("host", String(255)),
    Column("port", Integer),
    Column("username", String(255)),
    Column("password_enc", Text),
    Column("sender_email", String(255)),
    Column("sender_name", String(255)),
    Column("use_tls", Boolean, default=True),
    Column("openai_api_key_enc", Text),
    Column("openai_model", String(128)),
    Column("document_processing_enabled", Boolean, default=True),
    Column("quickbooks_enabled", Boolean, default=True),
    Column("quickbooks_client_id", String(255)),
    Column("quickbooks_client_secret_enc", Text),
    Column("quickbooks_environment", String(32)),
    Column("quickbooks_redirect_uri", String(512)),
    Column("companies_house_enabled", Boolean, default=True),
    Column("companies_house_api_key_enc", Text),
    Column("accountancy_services", Text),
    Column("accountancy_client_types", Text),
    Column("accountancy_statutory_deadlines", Text),
)

client_integrations = Table(
    "client_integrations",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, unique=True, index=True),
    Column("provider", String(32), default="quickbooks", index=True),
    Column("status", String(32), default="not_connected", index=True),
    Column("company_id", String(255)),
    Column("company_name", String(255)),
    Column("sandbox", Boolean, default=False),
    Column("auto_create_suppliers", Boolean, default=True),
    Column("auto_create_customers", Boolean, default=True),
    Column("default_purchase_account", String(255)),
    Column("default_sales_account", String(255)),
    Column("default_vat_code", String(255)),
    Column("notes", Text),
    Column("access_token_enc", Text),
    Column("refresh_token_enc", Text),
    Column("token_expires_at", String(64)),
    Column("refresh_expires_at", String(64)),
    Column("scope", Text),
    Column("last_sync_at", String(64)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

integration_records = Table(
    "integration_records",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("provider", String(32), default="quickbooks", index=True),
    Column("record_type", String(32), nullable=False, index=True),
    Column("external_id", String(255)),
    Column("code", String(255)),
    Column("name", String(255), nullable=False, index=True),
    Column("email", String(255)),
    Column("description", Text),
    Column("active", Boolean, default=True),
    Column("raw_json", Text),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_accounts = Table(
    "accounting_accounts",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("code", String(32), nullable=False, index=True),
    Column("name", String(255), nullable=False, index=True),
    Column("category", String(64), default="Expense", index=True),
    Column("account_type", String(64), nullable=False, index=True),
    Column("purpose", String(64), default="Standard Nominal", index=True),
    Column("normal_balance", String(16), nullable=False),
    Column("control_account", Boolean, default=False),
    Column("is_control_account", Boolean, default=False),
    Column("active", Boolean, default=True),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_settings = Table(
    "accounting_settings",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, unique=True, index=True),
    Column("default_sales_account", String(32)),
    Column("default_purchase_account", String(32)),
    Column("default_vat_control_account", String(32)),
    Column("default_bank_account", String(32)),
    Column("default_suspense_account", String(32)),
    Column("default_debtors_control_account", String(32)),
    Column("default_creditors_control_account", String(32)),
    Column("default_retained_earnings_account", String(32)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_contacts = Table(
    "accounting_contacts",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("contact_type", String(32), nullable=False, index=True),
    Column("name", String(255), nullable=False, index=True),
    Column("email", String(255)),
    Column("external_id", String(255)),
    Column("account_code", String(64)),
    Column("active", Boolean, default=True),
    Column("raw_json", Text),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_settings = Table(
    "accounting_ap_settings",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, unique=True, index=True),
    Column("approval_required", Boolean, default=True),
    Column("default_payment_terms_days", Integer, default=30),
    Column("default_purchase_account", String(32)),
    Column("default_vat_code", String(255)),
    Column("duplicate_invoice_warning", Boolean, default=True),
    Column("allow_future_posting_dates", Boolean, default=False),
    Column("automatic_invoice_numbering", Boolean, default=False),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_supplier_profiles = Table(
    "accounting_ap_supplier_profiles",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("contact_id", String(36), nullable=False, index=True),
    Column("supplier_code", String(64), index=True),
    Column("trading_name", String(255)),
    Column("phone", String(64)),
    Column("website", String(255)),
    Column("vat_number", String(64)),
    Column("company_number", String(64)),
    Column("payment_terms_days", Integer, default=30),
    Column("default_currency", String(8), default="GBP"),
    Column("default_purchase_account", String(32)),
    Column("default_vat_code", String(255)),
    Column("bank_name", String(255)),
    Column("bank_sort_code", String(32)),
    Column("bank_account_number", String(64)),
    Column("cis_registered", Boolean, default=False),
    Column("reverse_charge", Boolean, default=False),
    Column("status", String(32), default="active", index=True),
    Column("notes", Text),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_supplier_addresses = Table(
    "accounting_ap_supplier_addresses",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("supplier_id", String(36), nullable=False, index=True),
    Column("address_type", String(32), default="main"),
    Column("line1", String(255)),
    Column("line2", String(255)),
    Column("city", String(128)),
    Column("postcode", String(32)),
    Column("country", String(128)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_supplier_contacts = Table(
    "accounting_ap_supplier_contacts",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("supplier_id", String(36), nullable=False, index=True),
    Column("name", String(255)),
    Column("email", String(255)),
    Column("phone", String(64)),
    Column("role", String(128)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_invoices = Table(
    "accounting_ap_invoices",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("supplier_id", String(36), nullable=False, index=True),
    Column("contact_id", String(36), index=True),
    Column("invoice_number", String(255), index=True),
    Column("reference", String(255)),
    Column("invoice_date", String(32), index=True),
    Column("due_date", String(32), index=True),
    Column("currency", String(8), default="GBP"),
    Column("status", String(32), default="draft", index=True),
    Column("net_amount", String(64), default="0.00"),
    Column("vat_amount", String(64), default="0.00"),
    Column("gross_amount", String(64), default="0.00"),
    Column("outstanding_amount", String(64), default="0.00"),
    Column("source_submission_id", String(36), index=True),
    Column("attachment_path", Text),
    Column("extracted_json", Text),
    Column("posted_journal_id", String(36)),
    Column("approved_by", String(36)),
    Column("approved_at", String(64)),
    Column("posted_by", String(36)),
    Column("posted_at", String(64)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_invoice_lines = Table(
    "accounting_ap_invoice_lines",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("invoice_id", String(36), nullable=False, index=True),
    Column("line_number", Integer, default=1),
    Column("description", Text),
    Column("nominal_account_code", String(32)),
    Column("quantity", String(64), default="1.00"),
    Column("unit_price", String(64), default="0.00"),
    Column("discount_amount", String(64), default="0.00"),
    Column("vat_code", String(255)),
    Column("net_amount", String(64), default="0.00"),
    Column("vat_amount", String(64), default="0.00"),
    Column("gross_amount", String(64), default="0.00"),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_credit_notes = Table(
    "accounting_ap_credit_notes",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("supplier_id", String(36), nullable=False, index=True),
    Column("contact_id", String(36), index=True),
    Column("credit_note_number", String(255), index=True),
    Column("reference", String(255)),
    Column("credit_note_date", String(32), index=True),
    Column("currency", String(8), default="GBP"),
    Column("status", String(32), default="draft", index=True),
    Column("net_amount", String(64), default="0.00"),
    Column("vat_amount", String(64), default="0.00"),
    Column("gross_amount", String(64), default="0.00"),
    Column("unallocated_amount", String(64), default="0.00"),
    Column("posted_journal_id", String(36)),
    Column("posted_by", String(36)),
    Column("posted_at", String(64)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_credit_note_lines = Table(
    "accounting_ap_credit_note_lines",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("credit_note_id", String(36), nullable=False, index=True),
    Column("line_number", Integer, default=1),
    Column("description", Text),
    Column("nominal_account_code", String(32)),
    Column("quantity", String(64), default="1.00"),
    Column("unit_price", String(64), default="0.00"),
    Column("vat_code", String(255)),
    Column("net_amount", String(64), default="0.00"),
    Column("vat_amount", String(64), default="0.00"),
    Column("gross_amount", String(64), default="0.00"),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_payments = Table(
    "accounting_ap_payments",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("supplier_id", String(36), nullable=False, index=True),
    Column("contact_id", String(36), index=True),
    Column("payment_date", String(32), index=True),
    Column("bank_account_code", String(32)),
    Column("reference", String(255)),
    Column("amount", String(64), default="0.00"),
    Column("currency", String(8), default="GBP"),
    Column("status", String(32), default="posted", index=True),
    Column("posted_journal_id", String(36)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ap_payment_allocations = Table(
    "accounting_ap_payment_allocations",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("payment_id", String(36), nullable=False, index=True),
    Column("invoice_id", String(36), index=True),
    Column("credit_note_id", String(36), index=True),
    Column("amount", String(64), default="0.00"),
    Column("created_at", String(64)),
)

accounting_ar_settings = Table(
    "accounting_ar_settings",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, unique=True, index=True),
    Column("approval_required", Boolean, default=True),
    Column("default_payment_terms_days", Integer, default=30),
    Column("default_sales_account", String(32)),
    Column("default_vat_code", String(255)),
    Column("invoice_number_prefix", String(32), default="SINV"),
    Column("next_invoice_number", Integer, default=1),
    Column("duplicate_invoice_warning", Boolean, default=True),
    Column("credit_limit_warnings", Boolean, default=True),
    Column("automatic_customer_numbering", Boolean, default=True),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ar_customer_profiles = Table(
    "accounting_ar_customer_profiles",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("contact_id", String(36), nullable=False, index=True),
    Column("customer_code", String(64), index=True),
    Column("trading_name", String(255)),
    Column("phone", String(64)),
    Column("website", String(255)),
    Column("vat_number", String(64)),
    Column("company_number", String(64)),
    Column("payment_terms_days", Integer, default=30),
    Column("default_currency", String(8), default="GBP"),
    Column("default_sales_account", String(32)),
    Column("default_vat_code", String(255)),
    Column("credit_limit", String(64), default="0.00"),
    Column("status", String(32), default="active", index=True),
    Column("notes", Text),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ar_customer_addresses = Table(
    "accounting_ar_customer_addresses",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("customer_id", String(36), nullable=False, index=True),
    Column("address_type", String(32), default="billing"),
    Column("line1", String(255)),
    Column("line2", String(255)),
    Column("city", String(128)),
    Column("postcode", String(32)),
    Column("country", String(128)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ar_customer_contacts = Table(
    "accounting_ar_customer_contacts",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("customer_id", String(36), nullable=False, index=True),
    Column("name", String(255)),
    Column("email", String(255)),
    Column("phone", String(64)),
    Column("role", String(128)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ar_invoices = Table(
    "accounting_ar_invoices",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("customer_id", String(36), nullable=False, index=True),
    Column("contact_id", String(36), index=True),
    Column("invoice_number", String(255), index=True),
    Column("reference", String(255)),
    Column("invoice_date", String(32), index=True),
    Column("due_date", String(32), index=True),
    Column("currency", String(8), default="GBP"),
    Column("status", String(32), default="draft", index=True),
    Column("net_amount", String(64), default="0.00"),
    Column("vat_amount", String(64), default="0.00"),
    Column("gross_amount", String(64), default="0.00"),
    Column("outstanding_amount", String(64), default="0.00"),
    Column("source_submission_id", String(36), index=True),
    Column("attachment_path", Text),
    Column("extracted_json", Text),
    Column("posted_journal_id", String(36)),
    Column("approved_by", String(36)),
    Column("approved_at", String(64)),
    Column("posted_by", String(36)),
    Column("posted_at", String(64)),
    Column("archived_at", String(64)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ar_invoice_lines = Table(
    "accounting_ar_invoice_lines",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("invoice_id", String(36), nullable=False, index=True),
    Column("line_number", Integer, default=1),
    Column("description", Text),
    Column("nominal_account_code", String(32)),
    Column("quantity", String(64), default="1.00"),
    Column("unit_price", String(64), default="0.00"),
    Column("discount_amount", String(64), default="0.00"),
    Column("vat_code", String(255)),
    Column("net_amount", String(64), default="0.00"),
    Column("vat_amount", String(64), default="0.00"),
    Column("gross_amount", String(64), default="0.00"),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ar_credit_notes = Table(
    "accounting_ar_credit_notes",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("customer_id", String(36), nullable=False, index=True),
    Column("contact_id", String(36), index=True),
    Column("credit_note_number", String(255), index=True),
    Column("reference", String(255)),
    Column("credit_note_date", String(32), index=True),
    Column("currency", String(8), default="GBP"),
    Column("status", String(32), default="draft", index=True),
    Column("net_amount", String(64), default="0.00"),
    Column("vat_amount", String(64), default="0.00"),
    Column("gross_amount", String(64), default="0.00"),
    Column("unallocated_amount", String(64), default="0.00"),
    Column("posted_journal_id", String(36)),
    Column("posted_by", String(36)),
    Column("posted_at", String(64)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ar_credit_note_lines = Table(
    "accounting_ar_credit_note_lines",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("credit_note_id", String(36), nullable=False, index=True),
    Column("line_number", Integer, default=1),
    Column("description", Text),
    Column("nominal_account_code", String(32)),
    Column("quantity", String(64), default="1.00"),
    Column("unit_price", String(64), default="0.00"),
    Column("vat_code", String(255)),
    Column("net_amount", String(64), default="0.00"),
    Column("vat_amount", String(64), default="0.00"),
    Column("gross_amount", String(64), default="0.00"),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ar_receipts = Table(
    "accounting_ar_receipts",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("customer_id", String(36), nullable=False, index=True),
    Column("contact_id", String(36), index=True),
    Column("receipt_date", String(32), index=True),
    Column("bank_account_code", String(32)),
    Column("payment_method", String(64)),
    Column("reference", String(255)),
    Column("amount", String(64), default="0.00"),
    Column("currency", String(8), default="GBP"),
    Column("status", String(32), default="posted", index=True),
    Column("posted_journal_id", String(36)),
    Column("bank_transaction_id", String(36)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_ar_receipt_allocations = Table(
    "accounting_ar_receipt_allocations",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("receipt_id", String(36), nullable=False, index=True),
    Column("invoice_id", String(36), index=True),
    Column("credit_note_id", String(36), index=True),
    Column("amount", String(64), default="0.00"),
    Column("created_at", String(64)),
)

accounting_journal_entries = Table(
    "accounting_journal_entries",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("source_type", String(64), index=True),
    Column("source_id", String(64), index=True),
    Column("entry_date", String(32), index=True),
    Column("reference", String(255)),
    Column("description", Text),
    Column("status", String(32), default="posted", index=True),
    Column("total_debit", String(64)),
    Column("total_credit", String(64)),
    Column("created_at", String(64)),
    Column("posted_at", String(64)),
)

accounting_journal_lines = Table(
    "accounting_journal_lines",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("entry_id", String(36), nullable=False, index=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("account_id", String(36)),
    Column("account_code", String(32), index=True),
    Column("account_name", String(255)),
    Column("contact_id", String(36)),
    Column("debit", String(64), default="0.00"),
    Column("credit", String(64), default="0.00"),
    Column("vat_code", String(255)),
    Column("description", Text),
    Column("created_at", String(64)),
)

accounting_audit_log = Table(
    "accounting_audit_log",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("actor_id", String(36)),
    Column("module", String(64), index=True),
    Column("record_type", String(64), index=True),
    Column("record_id", String(64), index=True),
    Column("action", String(64), nullable=False, index=True),
    Column("entity_type", String(64), index=True),
    Column("entity_id", String(64), index=True),
    Column("previous_value", Text),
    Column("new_value", Text),
    Column("ip_address", String(64)),
    Column("details_json", Text),
    Column("created_at", String(64)),
)

accounting_bank_transactions = Table(
    "accounting_bank_transactions",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("bank_account_id", String(36), index=True),
    Column("bank_account_code", String(32), default="1200", index=True),
    Column("transaction_date", String(32), index=True),
    Column("description", Text),
    Column("reference", String(255)),
    Column("transaction_type", String(64), default="statement_import", index=True),
    Column("source_type", String(64), default="manual", index=True),
    Column("import_id", String(36), index=True),
    Column("money_in", String(64), default="0.00"),
    Column("money_out", String(64), default="0.00"),
    Column("balance", String(64), default="0.00"),
    Column("status", String(32), default="unreconciled", index=True),
    Column("matched_to", String(255)),
    Column("suggested_match", String(255)),
    Column("confidence", Integer, default=0),
    Column("ignored", Boolean, default=False),
    Column("matched_contact_id", String(36)),
    Column("matched_account_code", String(32)),
    Column("journal_entry_id", String(36)),
    Column("raw_json", Text),
    Column("reconciled_at", String(64)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_bank_accounts = Table(
    "accounting_bank_accounts",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("account_name", String(255), nullable=False, index=True),
    Column("bank_name", String(255)),
    Column("account_number", String(64)),
    Column("sort_code", String(32)),
    Column("currency", String(8), default="GBP"),
    Column("nominal_account_code", String(32), nullable=False, index=True),
    Column("opening_balance", String(64), default="0.00"),
    Column("default_account", Boolean, default=False),
    Column("allow_payments", Boolean, default=True),
    Column("allow_receipts", Boolean, default=True),
    Column("active", Boolean, default=True, index=True),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_bank_imports = Table(
    "accounting_bank_imports",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("bank_account_id", String(36), index=True),
    Column("provider", String(64), default="csv", index=True),
    Column("source_type", String(64), default="csv", index=True),
    Column("filename", String(255)),
    Column("imported_by", String(36)),
    Column("rows_imported", Integer, default=0),
    Column("duplicates", Integer, default=0),
    Column("errors", Integer, default=0),
    Column("status", String(32), default="imported", index=True),
    Column("raw_summary", Text),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_bank_rules = Table(
    "accounting_bank_rules",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("name", String(255), nullable=False),
    Column("active", Boolean, default=True, index=True),
    Column("bank_account_id", String(36), index=True),
    Column("field", String(64), default="description"),
    Column("operator", String(32), default="contains"),
    Column("value", String(255)),
    Column("amount_operator", String(32)),
    Column("amount_value", String(64)),
    Column("target_action", String(64), default="post_to_account"),
    Column("target_account_code", String(32)),
    Column("transaction_type", String(64)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_bank_matches = Table(
    "accounting_bank_matches",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("bank_transaction_id", String(36), nullable=False, index=True),
    Column("match_type", String(64), index=True),
    Column("matched_record_type", String(64), index=True),
    Column("matched_record_id", String(36), index=True),
    Column("amount", String(64), default="0.00"),
    Column("confidence", Integer, default=0),
    Column("status", String(32), default="matched", index=True),
    Column("journal_entry_id", String(36)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_bank_transfers = Table(
    "accounting_bank_transfers",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("from_bank_account_id", String(36), nullable=False),
    Column("to_bank_account_id", String(36), nullable=False),
    Column("transfer_date", String(32), index=True),
    Column("reference", String(255)),
    Column("amount", String(64), default="0.00"),
    Column("status", String(32), default="posted", index=True),
    Column("posted_journal_id", String(36)),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_bank_settings = Table(
    "accounting_bank_settings",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, unique=True, index=True),
    Column("default_bank_account_id", String(36)),
    Column("default_transfer_account", String(32)),
    Column("default_bank_charges_account", String(32)),
    Column("default_interest_account", String(32)),
    Column("default_suspense_account", String(32)),
    Column("statement_number_prefix", String(32), default="STMT"),
    Column("automatic_matching_threshold", Integer, default=85),
    Column("duplicate_detection", Boolean, default=True),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_vat_returns = Table(
    "accounting_vat_returns",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("period_start", String(32), index=True),
    Column("period_end", String(32), index=True),
    Column("status", String(32), default="draft", index=True),
    Column("vat_due_sales", String(64), default="0.00"),
    Column("vat_reclaimed_purchases", String(64), default="0.00"),
    Column("net_vat_due", String(64), default="0.00"),
    Column("sales_net", String(64), default="0.00"),
    Column("purchase_net", String(64), default="0.00"),
    Column("prepared_json", Text),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_periods = Table(
    "accounting_periods",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("financial_year_id", String(36), index=True),
    Column("period_name", String(64)),
    Column("period_number", Integer, default=1),
    Column("period_start", String(32), index=True),
    Column("period_end", String(32), index=True),
    Column("status", String(32), default="open", index=True),
    Column("transactions_posted", Integer, default=0),
    Column("notes", Text),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

accounting_financial_years = Table(
    "accounting_financial_years",
    metadata,
    Column("id", String(36), primary_key=True),
    Column("client_id", String(36), nullable=False, index=True),
    Column("name", String(128), nullable=False),
    Column("start_date", String(32), index=True),
    Column("end_date", String(32), index=True),
    Column("status", String(32), default="open", index=True),
    Column("created_at", String(64)),
    Column("updated_at", String(64)),
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("portal")


def quote_ident(name: str, dialect_name: str) -> str:
    quote = "`" if dialect_name == "mysql" else '"'
    return f"{quote}{name}{quote}"


def column_sql_type(column: Column) -> str:
    if isinstance(column.type, Text):
        return "TEXT"
    if isinstance(column.type, String):
        return f"VARCHAR({column.type.length or 255})"
    if isinstance(column.type, Integer):
        return "INTEGER"
    if isinstance(column.type, Boolean):
        return "BOOLEAN"
    return "TEXT"


async def ensure_schema_columns(conn):
    """Add columns introduced after the first SQL deployment.

    SQLAlchemy's create_all creates missing tables, but it will not alter an
    existing table. This keeps early VPS databases compatible without a full
    migration framework yet.
    """
    dialect_name = conn.dialect.name
    for table in (
        users,
        outstanding_items,
        submissions,
        settings,
        client_integrations,
        integration_records,
        accounting_accounts,
        accounting_settings,
        accounting_contacts,
        accounting_ap_settings,
        accounting_ap_supplier_profiles,
        accounting_ap_supplier_addresses,
        accounting_ap_supplier_contacts,
        accounting_ap_invoices,
        accounting_ap_invoice_lines,
        accounting_ap_credit_notes,
        accounting_ap_credit_note_lines,
        accounting_ap_payments,
        accounting_ap_payment_allocations,
        accounting_ar_settings,
        accounting_ar_customer_profiles,
        accounting_ar_customer_addresses,
        accounting_ar_customer_contacts,
        accounting_ar_invoices,
        accounting_ar_invoice_lines,
        accounting_ar_credit_notes,
        accounting_ar_credit_note_lines,
        accounting_ar_receipts,
        accounting_ar_receipt_allocations,
        accounting_journal_entries,
        accounting_journal_lines,
        accounting_audit_log,
        accounting_bank_transactions,
        accounting_bank_accounts,
        accounting_bank_imports,
        accounting_bank_rules,
        accounting_bank_matches,
        accounting_bank_transfers,
        accounting_bank_settings,
        accounting_vat_returns,
        accounting_periods,
        accounting_financial_years,
    ):
        existing_column_info = await conn.run_sync(
            lambda sync_conn, table_name=table.name: {
                col["name"]: col for col in inspect(sync_conn).get_columns(table_name)
            }
        )
        existing_columns = set(existing_column_info)
        for column in table.columns:
            if column.primary_key or column.name in existing_columns:
                continue
            column_def = f"{quote_ident(column.name, dialect_name)} {column_sql_type(column)}"
            if column.name == "status":
                column_def += " DEFAULT 'active'"
            elif column.name == "review_status":
                column_def += " DEFAULT 'inbox'"
            await conn.execute(
                text(
                    f"ALTER TABLE {quote_ident(table.name, dialect_name)} "
                    f"ADD COLUMN {column_def}"
                )
            )
            logger.info("Added missing column %s.%s", table.name, column.name)
        if dialect_name == "mysql":
            for column in table.columns:
                if column.name not in existing_column_info or not isinstance(column.type, Text):
                    continue
                existing_type = str(existing_column_info[column.name]["type"]).lower()
                if "text" in existing_type:
                    continue
                await conn.execute(
                    text(
                        f"ALTER TABLE {quote_ident(table.name, dialect_name)} "
                        f"MODIFY COLUMN {quote_ident(column.name, dialect_name)} TEXT"
                    )
                )
                logger.info("Widened column %s.%s to TEXT", table.name, column.name)


@asynccontextmanager
async def lifespan(app: FastAPI):
    for attempt in range(1, 31):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(metadata.create_all)
                await ensure_schema_columns(conn)
            break
        except OperationalError:
            if attempt == 30:
                raise
            logger.info("Database not ready yet; retrying startup (%s/30)", attempt)
            await asyncio.sleep(2)

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower().strip()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    async with SessionLocal() as session:
        existing = await get_user_by_email(session, admin_email)
        if existing is None:
            await session.execute(
                insert(users).values(
                    id=new_id(),
                    email=admin_email,
                    password_hash=hash_password(admin_password),
                    role="admin",
                    first_name="Practice",
                    last_name="Admin",
                    status="active",
                    created_at=utc_now_iso(),
                )
            )
            await session.commit()
            logger.info("Admin seeded: %s", admin_email)
        elif not verify_password(admin_password, existing["password_hash"]):
            await session.execute(
                update(users)
                .where(users.c.id == existing["id"])
                .values(password_hash=hash_password(admin_password), role="admin")
            )
            await session.commit()
            logger.info("Admin password updated.")
    yield
    await engine.dispose()


app = FastAPI(lifespan=lifespan)
api = APIRouter(prefix="/api")


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ClientCreate(BaseModel):
    first_name: str
    last_name: str
    business_name: str
    email: EmailStr
    autoentry_email: EmailStr
    sales_autoentry_email: Optional[EmailStr] = None
    password: str
    status: str = "active"
    is_vat_client: bool = False
    ai_analysis_enabled: bool = False
    accounting_destination: str = "external"
    native_accounting_enabled: bool = False
    client_type: Optional[str] = None
    industry: Optional[str] = None
    company_number: Optional[str] = None
    company_status: Optional[str] = None
    incorporation_date: Optional[str] = None
    registered_office_address: Optional[str] = None
    trading_address: Optional[str] = None
    phone: Optional[str] = None
    utr: Optional[str] = None
    vat_number: Optional[str] = None
    paye_reference: Optional[str] = None
    accounts_office_reference: Optional[str] = None
    authorisation_codes: Optional[str] = None
    services_required: Optional[str] = None
    service_settings: Optional[str] = None
    statutory_deadlines: Optional[str] = None
    deadline_tasks: Optional[str] = None
    bookkeeping_frequency: Optional[str] = None
    payroll_frequency: Optional[str] = None
    year_end: Optional[str] = None
    practice_manager: Optional[str] = None
    companies_house_last_checked: Optional[str] = None
    main_contact_name: Optional[str] = None
    main_contact_role: Optional[str] = None
    company_directors: Optional[str] = None
    company_pscs: Optional[str] = None
    company_contacts: Optional[str] = None
    companies_house_filings: Optional[str] = None


class ClientUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    business_name: Optional[str] = None
    email: Optional[EmailStr] = None
    autoentry_email: Optional[EmailStr] = None
    sales_autoentry_email: Optional[EmailStr] = None
    status: Optional[str] = None
    is_vat_client: Optional[bool] = None
    ai_analysis_enabled: Optional[bool] = None
    accounting_destination: Optional[str] = None
    native_accounting_enabled: Optional[bool] = None
    client_type: Optional[str] = None
    industry: Optional[str] = None
    company_number: Optional[str] = None
    company_status: Optional[str] = None
    incorporation_date: Optional[str] = None
    registered_office_address: Optional[str] = None
    trading_address: Optional[str] = None
    phone: Optional[str] = None
    utr: Optional[str] = None
    vat_number: Optional[str] = None
    paye_reference: Optional[str] = None
    accounts_office_reference: Optional[str] = None
    authorisation_codes: Optional[str] = None
    services_required: Optional[str] = None
    service_settings: Optional[str] = None
    statutory_deadlines: Optional[str] = None
    deadline_tasks: Optional[str] = None
    bookkeeping_frequency: Optional[str] = None
    payroll_frequency: Optional[str] = None
    year_end: Optional[str] = None
    practice_manager: Optional[str] = None
    companies_house_last_checked: Optional[str] = None
    main_contact_name: Optional[str] = None
    main_contact_role: Optional[str] = None
    company_directors: Optional[str] = None
    company_pscs: Optional[str] = None
    company_contacts: Optional[str] = None
    companies_house_filings: Optional[str] = None


class PasswordReset(BaseModel):
    new_password: str


class SMTPSettingsIn(BaseModel):
    host: str
    port: int
    username: str
    password: Optional[str] = None
    sender_email: EmailStr
    sender_name: str
    use_tls: bool = True
    aws_iam_secret: bool = False


class OpenAISettingsIn(BaseModel):
    api_key: Optional[str] = None
    model: str = "gpt-5.6-luna"


class FeatureSettingsIn(BaseModel):
    document_processing_enabled: bool = True


DEFAULT_ACCOUNTANCY_SERVICES = [
    {"key": "accounts", "label": "Accounts", "deadline": "statutory", "recurrence": None, "start_date": None, "statutory_key": "companies_house_accounts_due", "enabled": True},
    {"key": "bookkeeping", "label": "Bookkeeping", "deadline": None, "recurrence": None, "start_date": None, "enabled": True},
    {"key": "ct600_return", "label": "CT600 Return", "deadline": "statutory", "recurrence": None, "start_date": None, "statutory_key": "hmrc_ct600_filing_due", "enabled": True},
    {"key": "corporation_tax_payment", "label": "Corporation Tax Payment", "deadline": "statutory", "recurrence": None, "start_date": None, "statutory_key": "hmrc_corporation_tax_payment_due", "enabled": True},
    {"key": "payroll", "label": "Payroll", "deadline": "scheduled", "recurrence": "monthly", "start_date": None, "enabled": True},
    {"key": "auto_enrolment", "label": "Auto-Enrolment", "deadline": "scheduled", "recurrence": "annual", "start_date": None, "enabled": True},
    {"key": "vat_returns", "label": "VAT Returns", "deadline": "statutory", "recurrence": None, "start_date": None, "statutory_key": "hmrc_vat_return_due", "enabled": True},
    {"key": "management_accounts", "label": "Management Accounts", "deadline": "scheduled", "recurrence": "monthly", "start_date": None, "enabled": True},
    {"key": "confirmation_statement", "label": "Confirmation Statement", "deadline": "statutory", "recurrence": None, "start_date": None, "statutory_key": "companies_house_confirmation_due", "enabled": True},
    {"key": "cis", "label": "CIS", "deadline": "scheduled", "recurrence": "monthly", "start_date": None, "enabled": True},
    {"key": "p11d", "label": "P11D", "deadline": "scheduled", "recurrence": "annual", "start_date": None, "enabled": True},
    {"key": "fee_protection", "label": "Fee Protection Service", "deadline": None, "recurrence": None, "start_date": None, "enabled": True},
    {"key": "registered_address", "label": "Registered Address", "deadline": None, "recurrence": None, "start_date": None, "enabled": True},
    {"key": "bill_payment", "label": "Bill Payment", "deadline": None, "recurrence": None, "start_date": None, "enabled": True},
    {"key": "consultation_advice", "label": "Consultation/Advice", "deadline": None, "recurrence": None, "start_date": None, "enabled": True},
    {"key": "software", "label": "Software", "deadline": None, "recurrence": None, "start_date": None, "enabled": True},
    {"key": "ct600e", "label": "CT600E", "deadline": "scheduled", "recurrence": "annual", "start_date": None, "enabled": True},
    {"key": "self_assessment", "label": "Self Assessment", "deadline": "scheduled", "recurrence": "annual", "start_date": None, "enabled": True},
    {"key": "self_assessment_payment", "label": "Self Assessment Payment", "deadline": "scheduled", "recurrence": "annual", "start_date": None, "enabled": True},
    {"key": "payment_on_account", "label": "Payment on Account", "deadline": "scheduled", "recurrence": "annual", "start_date": None, "enabled": True},
]

NATIVE_ACCOUNTING_MODULES = [
    {"key": "payables", "label": "Accounts Payable", "description": "Supplier bills, credit notes, payments, and aged payables."},
    {"key": "receivables", "label": "Accounts Receivable", "description": "Customer invoices, receipts, and aged receivables."},
    {"key": "banking", "label": "Banking", "description": "Bank accounts, statement imports, matching, and payment runs."},
    {"key": "vat", "label": "VAT", "description": "VAT control, return boxes, audit trail, and MTD-ready summaries."},
    {"key": "general_ledger", "label": "General Ledger", "description": "Double-entry journals and account activity."},
    {"key": "chart_of_accounts", "label": "Chart of Accounts", "description": "Nominal codes, control accounts, and reporting structure."},
    {"key": "audit", "label": "Audit Trail", "description": "Permanent accounting activity history across all modules."},
    {"key": "reports", "label": "Reports", "description": "Profit and loss, balance sheet, trial balance, and ledgers."},
    {"key": "settings", "label": "Settings", "description": "Accounting periods, defaults, VAT basis, and locks."},
    {"key": "fixed_assets", "label": "Fixed Assets", "description": "Coming next: asset register and depreciation journals."},
    {"key": "payroll", "label": "Payroll", "description": "Placeholder for payroll summaries and posting journals."},
]

DEFAULT_NATIVE_ACCOUNTS = [
    {"code": "1100", "name": "Trade debtors", "category": "Asset", "account_type": "Receivable", "purpose": "Sales Ledger", "normal_balance": "debit", "control_account": True, "is_control_account": True},
    {"code": "1200", "name": "Bank", "category": "Asset", "account_type": "Bank", "purpose": "Bank Account", "normal_balance": "debit", "control_account": True, "is_control_account": True},
    {"code": "2000", "name": "Trade creditors", "category": "Liability", "account_type": "Payable", "purpose": "Purchase Ledger", "normal_balance": "credit", "control_account": True, "is_control_account": True},
    {"code": "2200", "name": "VAT control", "category": "Liability", "account_type": "VAT", "purpose": "VAT Control", "normal_balance": "credit", "control_account": True, "is_control_account": True},
    {"code": "2210", "name": "Payroll control", "category": "Liability", "account_type": "Payroll", "purpose": "Payroll Control", "normal_balance": "credit", "control_account": True, "is_control_account": True},
    {"code": "2300", "name": "Corporation Tax", "category": "Liability", "account_type": "Tax", "purpose": "Corporation Tax", "normal_balance": "credit", "control_account": True, "is_control_account": True},
    {"code": "3200", "name": "Retained earnings", "category": "Equity", "account_type": "Equity", "purpose": "Retained Earnings", "normal_balance": "credit", "control_account": True, "is_control_account": True},
    {"code": "4000", "name": "Sales", "category": "Income", "account_type": "Sales", "purpose": "Standard Nominal", "normal_balance": "credit", "control_account": False, "is_control_account": False},
    {"code": "5000", "name": "Purchases", "category": "Expense", "account_type": "Purchases", "purpose": "Standard Nominal", "normal_balance": "debit", "control_account": False, "is_control_account": False},
    {"code": "5100", "name": "Subcontractors", "category": "Expense", "account_type": "Cost of Sales", "purpose": "Standard Nominal", "normal_balance": "debit", "control_account": False, "is_control_account": False},
    {"code": "5200", "name": "Materials", "category": "Expense", "account_type": "Cost of Sales", "purpose": "Standard Nominal", "normal_balance": "debit", "control_account": False, "is_control_account": False},
    {"code": "5300", "name": "Motor and travel", "category": "Expense", "account_type": "Overheads", "purpose": "Standard Nominal", "normal_balance": "debit", "control_account": False, "is_control_account": False},
    {"code": "5400", "name": "Office and software", "category": "Expense", "account_type": "Overheads", "purpose": "Standard Nominal", "normal_balance": "debit", "control_account": False, "is_control_account": False},
    {"code": "9999", "name": "Suspense", "category": "Asset", "account_type": "Suspense", "purpose": "Suspense", "normal_balance": "debit", "control_account": True, "is_control_account": True},
]


DEFAULT_ACCOUNTANCY_STATUTORY_DEADLINES = [
    {"key": "companies_house_accounts_due", "label": "Accounts due", "source": "Companies House", "description": "Next accounts filing deadline from Companies House.", "rule_description": "Used by the Accounts service. The app stores the Companies House returned accounts due date on the client as 'Accounts due' and uses that exact date when creating the next accounts deadline task. This is preferred over a local formula because Companies House already handles first accounts, changed accounting periods, and overdue flags. Human check: private company annual accounts are normally due 9 months after the accounting reference date; first accounts or changed periods can differ.", "ai_update_enabled": True, "enabled": True},
    {"key": "companies_house_accounts_made_up_to", "label": "Accounts made up to", "source": "Companies House", "description": "Next accounts period end from Companies House.", "rule_description": "Reference date only. The app stores the Companies House returned next accounts period end as 'Accounts next made up to'. Use it to verify the accounts period, but do not use it as the filing deadline.", "ai_update_enabled": True, "enabled": True},
    {"key": "companies_house_confirmation_due", "label": "Confirmation statement due", "source": "Companies House", "description": "Next confirmation statement filing deadline from Companies House.", "rule_description": "Used by the Confirmation Statement service. The app stores the Companies House returned confirmation statement due date and uses that exact date for the next deadline task.", "ai_update_enabled": True, "enabled": True},
    {"key": "companies_house_confirmation_next_statement", "label": "Confirmation statement date", "source": "Companies House", "description": "Next statement date from Companies House.", "rule_description": "Reference date only. This is the next confirmation statement date/period date from Companies House, not the filing deadline.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_ct600_filing_due", "label": "CT600 filing due", "source": "HMRC", "description": "Corporation Tax return filing deadline.", "rule_description": "Rule: file the Company Tax Return 12 months after the end of the Corporation Tax accounting period. Data needed: accounting period end date, normally aligned to the accounts period. If HMRC CT data is not connected, the app can calculate this from the client accounting period/account year end and show it for review.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_corporation_tax_payment_due", "label": "Corporation Tax payment due", "source": "HMRC", "description": "Corporation Tax payment deadline.", "rule_description": "Rule: Corporation Tax is usually payable 9 months and 1 day after the end of the Corporation Tax accounting period. Data needed: accounting period end date. Exception: large and very large companies may pay by quarterly instalments, so those clients need a separate rule later.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_vat_return_due", "label": "VAT return due", "source": "HMRC", "description": "VAT return deadline from HMRC MTD obligations or VAT period settings.", "rule_description": "Best source: HMRC VAT MTD API obligations endpoint, which returns the period due date. Fallback rule: VAT returns are normally due 1 month and 7 days after the VAT period end. Data needed: VAT registration, VAT period frequency and period end date.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_vat_payment_due", "label": "VAT payment due", "source": "HMRC", "description": "VAT payment deadline from HMRC MTD obligations or VAT period settings.", "rule_description": "Best source: HMRC VAT MTD API liabilities/payments and obligations where connected. Fallback rule: VAT payment is normally due on the same 1 month and 7 days deadline as the VAT return, but Direct Debit and special schemes may differ.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_paye_monthly_due", "label": "PAYE monthly due", "source": "HMRC", "description": "PAYE/NIC monthly payment deadline.", "rule_description": "Rule: PAYE/NIC for a tax month ending on the 5th is due by the 22nd of the following month if paid electronically, or the 19th if paid by post. App default should be the 22nd, with an option to use the 19th for cheque/post clients.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_cis_return_due", "label": "CIS return due", "source": "HMRC", "description": "Monthly CIS contractor return deadline.", "rule_description": "Rule: the CIS tax month runs from the 6th to the 5th. The contractor monthly return is due within 14 days of the tax month end, which is normally the 19th of the month. Example: 6 May to 5 June is due by 19 June. CIS deductions are paid with PAYE/CIS payments by the 22nd electronically, or 19th by post.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_p11d_due", "label": "P11D due", "source": "HMRC", "description": "Annual P11D and P11D(b) submission deadline.", "rule_description": "Rule: P11D and P11D(b) are due by 6 July after the tax year ends on 5 April. Related payment: Class 1A National Insurance is due by 22 July if paid electronically, or 19 July by cheque/post.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_self_assessment_due", "label": "Self Assessment return due", "source": "HMRC", "description": "Self Assessment tax return filing deadline.", "rule_description": "Rule: online Self Assessment returns are normally due by 31 January after the tax year. Paper returns are normally due by 31 October. App default should be online filing on 31 January, with paper filing as an optional client setting later.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_self_assessment_payment_due", "label": "Self Assessment payment due", "source": "HMRC", "description": "Self Assessment balancing payment and first payment on account deadline.", "rule_description": "Rule: the balancing payment for the previous tax year and the first payment on account are normally due by 31 January after the tax year.", "ai_update_enabled": True, "enabled": True},
    {"key": "hmrc_payment_on_account_due", "label": "Payment on account due", "source": "HMRC", "description": "Self Assessment second payment on account deadline.", "rule_description": "Rule: the second Self Assessment payment on account is normally due by 31 July after the tax year.", "ai_update_enabled": True, "enabled": True},
]


DEFAULT_ACCOUNTANCY_CLIENT_TYPES = [
    {"key": "limited_company", "label": "Limited company", "service_keys": ["accounts", "bookkeeping", "ct600_return", "corporation_tax_payment", "confirmation_statement"]},
    {"key": "sole_trader", "label": "Sole trader", "service_keys": ["bookkeeping", "self_assessment", "self_assessment_payment", "payment_on_account"]},
    {"key": "partnership", "label": "Partnership", "service_keys": ["bookkeeping", "self_assessment", "self_assessment_payment", "payment_on_account"]},
    {"key": "llp", "label": "LLP", "service_keys": ["accounts", "bookkeeping", "confirmation_statement"]},
    {"key": "charity", "label": "Charity", "service_keys": ["accounts", "bookkeeping"]},
    {"key": "community_interest_company", "label": "CIC", "service_keys": ["accounts", "bookkeeping", "ct600_return", "confirmation_statement"]},
    {"key": "club_or_association", "label": "Club / association", "service_keys": ["accounts", "bookkeeping"]},
    {"key": "landlord", "label": "Landlord", "service_keys": ["bookkeeping", "self_assessment", "self_assessment_payment", "payment_on_account"]},
    {"key": "individual", "label": "Individual", "service_keys": ["self_assessment", "self_assessment_payment", "payment_on_account"]},
    {"key": "other", "label": "Other", "service_keys": []},
]


class AccountancyServiceIn(BaseModel):
    key: str
    label: str
    deadline: Optional[str] = None
    recurrence: Optional[str] = None
    start_date: Optional[str] = None
    statutory_key: Optional[str] = None
    day_of_month: Optional[int] = None
    enabled: bool = True


class AccountancyServicesIn(BaseModel):
    services: List[AccountancyServiceIn]


class AccountancyClientTypeIn(BaseModel):
    key: str
    label: str
    service_keys: List[str] = []


class AccountancyClientTypesIn(BaseModel):
    client_types: List[AccountancyClientTypeIn]


class AccountancyStatutoryDeadlineIn(BaseModel):
    key: str
    label: str
    source: str
    description: Optional[str] = None
    rule_description: Optional[str] = None
    ai_update_enabled: bool = True
    enabled: bool = True


class AccountancyStatutoryDeadlinesIn(BaseModel):
    statutory_deadlines: List[AccountancyStatutoryDeadlineIn]


CLIENT_PRACTICE_FIELDS = [
    "client_type",
    "industry",
    "company_number",
    "company_status",
    "incorporation_date",
    "registered_office_address",
    "trading_address",
    "phone",
    "utr",
    "vat_number",
    "paye_reference",
    "accounts_office_reference",
    "authorisation_codes",
    "services_required",
    "service_settings",
    "statutory_deadlines",
    "deadline_tasks",
    "bookkeeping_frequency",
    "payroll_frequency",
    "year_end",
    "practice_manager",
    "companies_house_last_checked",
    "main_contact_name",
    "main_contact_role",
    "company_directors",
    "company_pscs",
    "company_contacts",
    "companies_house_filings",
]


def clean_optional_text(value):
    if value is None:
        return None
    return str(value).strip() or None


class SubmissionReviewStatusIn(BaseModel):
    review_status: str
    coding_fields: Optional[dict] = None


class SubmissionDownloadIn(BaseModel):
    ids: List[str]


class SubmissionLineSuggestionIn(BaseModel):
    coding_fields: dict
    pattern_line: dict


class ClientIntegrationSettingsIn(BaseModel):
    provider: str = "quickbooks"
    status: str = "not_connected"
    company_id: Optional[str] = None
    company_name: Optional[str] = None
    sandbox: bool = False
    auto_create_suppliers: bool = True
    auto_create_customers: bool = True
    default_purchase_account: Optional[str] = None
    default_sales_account: Optional[str] = None
    default_vat_code: Optional[str] = None
    notes: Optional[str] = None


class QuickBooksAppSettingsIn(BaseModel):
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    environment: str = "sandbox"
    redirect_uri: Optional[str] = None
    enabled: bool = True


class CompaniesHouseSettingsIn(BaseModel):
    api_key: Optional[str] = None
    enabled: bool = True


class IntegrationRecordIn(BaseModel):
    record_type: str
    external_id: Optional[str] = None
    code: Optional[str] = None
    name: str
    email: Optional[EmailStr] = None
    description: Optional[str] = None
    active: bool = True


# ---------- Helpers ----------
def new_id() -> str:
    return str(uuid.uuid4())


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def row_dict(row) -> Optional[dict]:
    return dict(row) if row else None


async def get_db():
    async with SessionLocal() as session:
        yield session


async def one(session: AsyncSession, stmt) -> Optional[dict]:
    result = await session.execute(stmt)
    return row_dict(result.mappings().first())


async def many(session: AsyncSession, stmt) -> list[dict]:
    result = await session.execute(stmt)
    return [dict(row) for row in result.mappings().all()]


def money(value: Any, default: str = "0.00") -> Decimal:
    raw = str(value if value not in (None, "") else default).strip()
    raw = raw.replace("£", "").replace(",", "")
    if not raw:
        raw = default
    try:
        return Decimal(raw).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return Decimal(default).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def money_str(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def clean_accounting_destination(value: Optional[str], native_enabled: bool = False) -> str:
    destination = (value or "").strip().lower()
    if destination not in {"external", "native"}:
        destination = "native" if native_enabled else "external"
    return destination


def is_native_accounting_client(client: Optional[dict]) -> bool:
    if not client:
        return False
    return bool(client.get("native_accounting_enabled")) or (client.get("accounting_destination") or "").lower() == "native"


def account_matches(account: dict, value: Optional[str]) -> bool:
    candidate = (value or "").strip().lower()
    if not candidate:
        return False
    return candidate in {
        str(account.get("code") or "").strip().lower(),
        str(account.get("name") or "").strip().lower(),
        f"{account.get('code') or ''} - {account.get('name') or ''}".strip().lower(),
    }


async def ensure_native_accounting_client(session: AsyncSession, client_id: str) -> list[dict]:
    now = utc_now_iso()
    existing = await many(
        session,
        select(accounting_accounts)
        .where(accounting_accounts.c.client_id == client_id)
        .order_by(accounting_accounts.c.code.asc()),
    )
    if existing:
        defaults_by_code = {item["code"]: item for item in DEFAULT_NATIVE_ACCOUNTS}
        for account in existing:
            defaults = defaults_by_code.get(str(account.get("code") or ""), {})
            values = {}
            if not account.get("category"):
                values["category"] = defaults.get("category") or infer_account_category(account.get("account_type"))
            if not account.get("purpose"):
                values["purpose"] = defaults.get("purpose") or infer_account_purpose(account)
            if account.get("is_control_account") is None:
                values["is_control_account"] = bool(account.get("control_account")) or bool(defaults.get("is_control_account"))
            if values:
                values["updated_at"] = now
                await session.execute(update(accounting_accounts).where(accounting_accounts.c.id == account["id"]).values(**values))
        await ensure_accounting_settings(session, client_id)
        await session.flush()
        return existing
    for account in DEFAULT_NATIVE_ACCOUNTS:
        await session.execute(
            insert(accounting_accounts).values(
                id=new_id(),
                client_id=client_id,
                created_at=now,
                updated_at=now,
                active=True,
                **account,
            )
        )
    await session.execute(
        update(users)
        .where(users.c.id == client_id, users.c.role == "client")
        .values(
            accounting_destination="native",
            native_accounting_enabled=True,
            native_accounting_created_at=now,
        )
    )
    await session.flush()
    await ensure_accounting_settings(session, client_id)
    await session.flush()
    return await many(
        session,
        select(accounting_accounts)
        .where(accounting_accounts.c.client_id == client_id)
        .order_by(accounting_accounts.c.code.asc()),
    )


def find_native_account(accounts: list[dict], preferred: Optional[str], fallback_code: str) -> dict:
    for account in accounts:
        if account_matches(account, preferred):
            return account
    for account in accounts:
        if str(account.get("code") or "") == fallback_code:
            return account
    raise HTTPException(status_code=400, detail=f"Native accounting account {fallback_code} is missing.")


async def get_or_create_native_contact(session: AsyncSession, client_id: str, name: str, contact_type: str) -> Optional[dict]:
    clean_name = (name or "").strip()
    if not clean_name:
        return None
    existing = await one(
        session,
        select(accounting_contacts).where(
            accounting_contacts.c.client_id == client_id,
            accounting_contacts.c.contact_type == contact_type,
            func.lower(accounting_contacts.c.name) == clean_name.lower(),
        ),
    )
    if existing:
        return existing
    now = utc_now_iso()
    contact = {
        "id": new_id(),
        "client_id": client_id,
        "contact_type": contact_type,
        "name": clean_name,
        "active": True,
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_contacts).values(**contact))
    return contact


def submission_entry_date(submission: dict, coding_fields: dict) -> str:
    return quickbooks_date(coding_fields.get("date") or submission.get("date")) or datetime.now(timezone.utc).date().isoformat()


async def post_native_journal(
    session: AsyncSession,
    client_id: str,
    source_type: str,
    source_id: str,
    entry_date: str,
    reference: str,
    description: str,
    lines: list[dict],
    actor_id: Optional[str] = None,
) -> dict:
    locked_period = await one(
        session,
        select(accounting_periods).where(
            accounting_periods.c.client_id == client_id,
            accounting_periods.c.period_start <= entry_date,
            accounting_periods.c.period_end >= entry_date,
            accounting_periods.c.status.in_(["locked", "closed"]),
        ),
    )
    if locked_period:
        raise HTTPException(status_code=400, detail=f"Accounting period is {locked_period.get('status')}; reopen it before posting.")
    total_debit = sum((money(line.get("debit")) for line in lines), Decimal("0.00"))
    total_credit = sum((money(line.get("credit")) for line in lines), Decimal("0.00"))
    if total_debit <= Decimal("0.00") or total_credit <= Decimal("0.00"):
        raise HTTPException(status_code=400, detail="Native accounting journal needs debit and credit values.")
    if total_debit != total_credit:
        raise HTTPException(status_code=400, detail=f"Native accounting journal is not balanced: debit {money_str(total_debit)} / credit {money_str(total_credit)}.")
    now = utc_now_iso()
    entry_id = new_id()
    await session.execute(
        insert(accounting_journal_entries).values(
            id=entry_id,
            client_id=client_id,
            source_type=source_type,
            source_id=source_id,
            entry_date=entry_date,
            reference=reference[:255],
            description=description,
            status="posted",
            total_debit=money_str(total_debit),
            total_credit=money_str(total_credit),
            created_at=now,
            posted_at=now,
        )
    )
    for line in lines:
        account = line["account"]
        await session.execute(
            insert(accounting_journal_lines).values(
                id=new_id(),
                entry_id=entry_id,
                client_id=client_id,
                account_id=account.get("id"),
                account_code=account.get("code"),
                account_name=account.get("name"),
                contact_id=(line.get("contact") or {}).get("id"),
                debit=money_str(money(line.get("debit"))),
                credit=money_str(money(line.get("credit"))),
                vat_code=line.get("vat_code"),
                description=line.get("description"),
                created_at=now,
            )
        )
    await session.execute(
        insert(accounting_audit_log).values(
            id=new_id(),
            client_id=client_id,
            actor_id=actor_id,
            action="journal_posted",
            entity_type="journal_entry",
            entity_id=entry_id,
            details_json=json.dumps({"source_type": source_type, "source_id": source_id, "debit": money_str(total_debit), "credit": money_str(total_credit)}),
            created_at=now,
        )
    )
    return {
        "provider": "epos_native",
        "entity": "JournalEntry",
        "id": entry_id,
        "reference": reference,
        "total_debit": money_str(total_debit),
        "total_credit": money_str(total_credit),
        "posted_at": now,
    }


async def count_rows(session: AsyncSession, table: Table, *conditions) -> int:
    stmt = select(func.count()).select_from(table)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    result = await session.execute(stmt)
    return int(result.scalar_one())


async def get_user_by_email(session: AsyncSession, email: str) -> Optional[dict]:
    return await one(session, select(users).where(users.c.email == email.lower().strip()))


async def get_user_by_id(session: AsyncSession, user_id: str) -> Optional[dict]:
    return await one(session, select(users).where(users.c.id == user_id))


def parse_ses_region(host: str) -> Optional[str]:
    """Extract AWS region from an SES SMTP host like email-smtp.eu-west-2.amazonaws.com."""
    parts = (host or "").lower().strip().split(".")
    if len(parts) >= 4 and parts[0] == "email-smtp" and parts[-2] == "amazonaws" and parts[-1] == "com":
        return parts[1]
    return None


def derive_ses_smtp_password(secret_access_key: str, region: str) -> str:
    """Convert an AWS IAM secret access key into an Amazon SES SMTP password (AWS-documented algorithm)."""
    def sign(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
    sig = sign(("AWS4" + secret_access_key).encode("utf-8"), "11111111")
    sig = sign(sig, region)
    sig = sign(sig, "ses")
    sig = sign(sig, "aws4_request")
    sig = sign(sig, "SendRawEmail")
    return base64.b64encode(bytes([0x04]) + sig).decode("utf-8")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=8),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_ai_review_token(user_id: str, image_hash: str, review: dict) -> str:
    payload = {
        "sub": user_id,
        "type": "ai_review",
        "image_hash": image_hash,
        "status": review.get("status"),
        "message": review.get("message", ""),
        "document_type": review.get("document_type", ""),
        "payment_method": review.get("payment_method", "not_clear"),
        "coding_fields": review.get("coding_fields") or {},
        "exp": datetime.now(timezone.utc) + timedelta(minutes=20),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def verify_ai_review_token(token: str, user_id: str, image_hash: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    if (
        payload.get("type") != "ai_review"
        or payload.get("sub") != user_id
        or payload.get("image_hash") != image_hash
        or payload.get("status") not in ("needs_review", "rejected")
    ):
        return None
    return {
        "status": payload.get("status"),
        "message": payload.get("message", ""),
        "document_type": payload.get("document_type", ""),
        "payment_method": payload.get("payment_method", "not_clear"),
        "coding_fields": payload.get("coding_fields") or {},
        "confidence": "medium",
    }


def set_auth_cookie(response: Response, token: str):
    secure_cookie = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=secure_cookie,
        samesite="none" if secure_cookie else "lax",
        max_age=8 * 3600,
        path="/",
    )


def clear_auth_cookie(response: Response):
    response.delete_cookie("access_token", path="/")


async def get_current_user(request: Request, session: AsyncSession = Depends(get_db)) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await get_user_by_id(session, payload["sub"])
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


async def require_client(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "client":
        raise HTTPException(status_code=403, detail="Client only")
    return user


def serialize_user(u: dict) -> dict:
    uid = str(u["id"])
    return {
        "id": uid,
        "_id": uid,
        "email": u["email"],
        "role": u["role"],
        "first_name": u.get("first_name"),
        "last_name": u.get("last_name"),
        "business_name": u.get("business_name"),
        "client_type": u.get("client_type"),
        "industry": u.get("industry"),
        "company_number": u.get("company_number"),
        "company_status": u.get("company_status"),
        "incorporation_date": u.get("incorporation_date"),
        "registered_office_address": u.get("registered_office_address"),
        "trading_address": u.get("trading_address"),
        "phone": u.get("phone"),
        "utr": u.get("utr"),
        "vat_number": u.get("vat_number"),
        "paye_reference": u.get("paye_reference"),
        "accounts_office_reference": u.get("accounts_office_reference"),
        "authorisation_codes": u.get("authorisation_codes"),
        "services_required": u.get("services_required"),
        "service_settings": u.get("service_settings"),
        "statutory_deadlines": u.get("statutory_deadlines"),
        "deadline_tasks": u.get("deadline_tasks"),
        "bookkeeping_frequency": u.get("bookkeeping_frequency"),
        "payroll_frequency": u.get("payroll_frequency"),
        "year_end": u.get("year_end"),
        "practice_manager": u.get("practice_manager"),
        "companies_house_last_checked": u.get("companies_house_last_checked"),
        "main_contact_name": u.get("main_contact_name"),
        "main_contact_role": u.get("main_contact_role"),
        "company_directors": u.get("company_directors"),
        "company_pscs": u.get("company_pscs"),
        "company_contacts": u.get("company_contacts"),
        "companies_house_filings": u.get("companies_house_filings"),
        "autoentry_email": u.get("autoentry_email"),
        "sales_autoentry_email": u.get("sales_autoentry_email"),
        "is_vat_client": bool(u.get("is_vat_client")),
        "ai_analysis_enabled": bool(u.get("ai_analysis_enabled")),
        "accounting_destination": u.get("accounting_destination") or ("native" if u.get("native_accounting_enabled") else "external"),
        "native_accounting_enabled": bool(u.get("native_accounting_enabled")),
        "native_accounting_created_at": u.get("native_accounting_created_at"),
        "status": u.get("status", "active"),
    }


def serialize_item(d: dict) -> dict:
    d = dict(d)
    d["_id"] = str(d["id"])
    return d


def parse_item_date(value: Optional[str]) -> datetime:
    try:
        return datetime.strptime((value or "").strip(), "%d/%m/%Y")
    except (TypeError, ValueError):
        return datetime.max


def sort_items_by_date(docs: list[dict], newest_first: bool = False) -> list[dict]:
    return sorted(
        docs,
        key=lambda d: (parse_item_date(d.get("date")), (d.get("description") or "").lower()),
        reverse=newest_first,
    )


def serialize_submission(d: dict) -> dict:
    d = dict(d)
    d["_id"] = str(d["id"])
    d["review_status"] = d.get("review_status") or "inbox"
    d["ai_extracted_fields"] = parse_json_object(d.get("ai_extracted_fields")) or {}
    d["coding_fields"] = parse_json_object(d.get("coding_fields")) or {}
    return d


def format_companies_house_address(address: dict) -> str:
    if not address:
        return ""
    parts = [
        address.get("premises"),
        address.get("address_line_1"),
        address.get("address_line_2"),
        address.get("locality"),
        address.get("region"),
        address.get("postal_code"),
        address.get("country"),
    ]
    return ", ".join(str(part).strip() for part in parts if part)


def companies_house_error_detail(response: httpx.Response) -> str:
    detail = f"Companies House request failed ({response.status_code})"
    try:
        data = response.json()
        message = data.get("error") or data.get("message") or data.get("error_description")
        if isinstance(message, list):
            message = "; ".join(str(part) for part in message)
        if message:
            return f"{detail}: {message}"
    except ValueError:
        pass
    text_value = (response.text or "").strip()
    if text_value:
        return f"{detail}: {text_value[:300]}"
    return detail


def ch_person_name(item: dict) -> str:
    name = item.get("name") or item.get("title") or ""
    return str(name).strip()


def ch_date_of_birth(item: dict) -> str:
    dob = item.get("date_of_birth") or {}
    month = dob.get("month")
    year = dob.get("year")
    if month and year:
        return f"{int(month):02d}/{year}"
    return str(year or "")


def ch_director(item: dict) -> dict:
    return {
        "name": ch_person_name(item),
        "role": item.get("officer_role") or "director",
        "appointed_on": item.get("appointed_on") or "",
        "resigned_on": item.get("resigned_on") or "",
        "occupation": item.get("occupation") or "",
        "nationality": item.get("nationality") or "",
        "date_of_birth": ch_date_of_birth(item),
        "address": format_companies_house_address(item.get("address") or {}),
        "source": "officer",
    }


def ch_psc(item: dict) -> dict:
    return {
        "name": ch_person_name(item),
        "role": "PSC",
        "kind": item.get("kind") or "",
        "notified_on": item.get("notified_on") or "",
        "ceased_on": item.get("ceased_on") or "",
        "natures_of_control": ", ".join(item.get("natures_of_control") or []),
        "address": format_companies_house_address(item.get("address") or {}),
        "source": "psc",
    }


def ch_filing(item: dict) -> dict:
    return {
        "date": item.get("date") or "",
        "description": item.get("description") or "",
        "category": item.get("category") or "",
        "type": item.get("type") or "",
        "barcode": item.get("barcode") or "",
    }


def json_compact(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


async def get_companies_house_api_key(session: Optional[AsyncSession] = None) -> str:
    env_key = os.environ.get("COMPANIES_HOUSE_API_KEY", "").strip()
    if env_key:
        return env_key
    if session is None:
        return ""
    saved = await one(session, select(settings).where(settings.c.key == "companies_house"))
    if saved and saved.get("companies_house_api_key_enc"):
        try:
            return decrypt_secret(saved["companies_house_api_key_enc"]) or ""
        except Exception:
            logger.exception("Failed to decrypt saved Companies House API key")
    return ""


async def companies_house_enabled(session: AsyncSession) -> bool:
    saved = await one(session, select(settings).where(settings.c.key == "companies_house"))
    return True if not saved or saved.get("companies_house_enabled") is None else bool(saved.get("companies_house_enabled"))


async def companies_house_get(path: str, params: Optional[dict] = None, session: Optional[AsyncSession] = None) -> dict:
    if session is not None and not await companies_house_enabled(session):
        raise HTTPException(status_code=403, detail="Companies House integration is disabled")
    api_key = await get_companies_house_api_key(session)
    if not api_key:
        raise HTTPException(status_code=503, detail="Companies House API key is not configured")
    url = f"https://api.company-information.service.gov.uk{path}"
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(url, params=params or {}, auth=(api_key, ""))
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Company not found")
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=companies_house_error_detail(response))
    return response.json()


async def companies_house_get_optional(path: str, params: Optional[dict] = None, session: Optional[AsyncSession] = None) -> dict:
    try:
        return await companies_house_get(path, params=params, session=session)
    except HTTPException as exc:
        if exc.status_code == 404:
            return {}
        raise


# ---------- Auth ----------
@api.post("/auth/login")
async def login(payload: LoginIn, response: Response, session: AsyncSession = Depends(get_db)):
    email = payload.email.lower().strip()
    user = await get_user_by_email(session, email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("status") == "inactive":
        raise HTTPException(status_code=403, detail="Account is inactive. Contact your administrator.")
    token = create_access_token(str(user["id"]), user["role"])
    set_auth_cookie(response, token)
    return {"user": serialize_user(user), "access_token": token}


@api.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return serialize_user(user)


# ---------- Admin: Clients ----------
@api.get("/admin/clients")
async def list_clients(
    q: Optional[str] = None,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    stmt = select(users).where(users.c.role == "client")
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                users.c.first_name.ilike(like),
                users.c.last_name.ilike(like),
                users.c.business_name.ilike(like),
                users.c.email.ilike(like),
            )
        )
    docs = await many(session, stmt.order_by(users.c.business_name.asc()))
    result = []
    for d in docs:
        s = serialize_user(d)
        s["purchase_outstanding"] = await count_rows(
            session,
            outstanding_items,
            outstanding_items.c.client_id == str(d["id"]),
            outstanding_items.c.type == "purchase",
        )
        s["sales_outstanding"] = await count_rows(
            session,
            outstanding_items,
            outstanding_items.c.client_id == str(d["id"]),
            outstanding_items.c.type == "sales",
        )
        result.append(s)
    return result


@api.post("/admin/clients")
async def create_client(
    payload: ClientCreate,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    email = payload.email.lower().strip()
    if await get_user_by_email(session, email):
        raise HTTPException(status_code=400, detail="A user with this email already exists")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    doc = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(payload.password),
        "role": "client",
        "first_name": payload.first_name.strip(),
        "last_name": payload.last_name.strip(),
        "business_name": payload.business_name.strip(),
        "autoentry_email": payload.autoentry_email.lower().strip(),
        "sales_autoentry_email": payload.sales_autoentry_email.lower().strip() if payload.sales_autoentry_email else None,
        "is_vat_client": bool(payload.is_vat_client),
        "ai_analysis_enabled": bool(payload.ai_analysis_enabled),
        "accounting_destination": clean_accounting_destination(payload.accounting_destination, payload.native_accounting_enabled),
        "native_accounting_enabled": bool(payload.native_accounting_enabled or payload.accounting_destination == "native"),
        "native_accounting_created_at": utc_now_iso() if payload.native_accounting_enabled or payload.accounting_destination == "native" else None,
        "status": payload.status or "active",
        "created_at": utc_now_iso(),
    }
    for field in CLIENT_PRACTICE_FIELDS:
        doc[field] = clean_optional_text(getattr(payload, field, None))
    await session.execute(insert(users).values(**doc))
    if doc["native_accounting_enabled"]:
        await ensure_native_accounting_client(session, doc["id"])
    await session.commit()
    return serialize_user(doc)


@api.get("/admin/clients/{client_id}")
async def get_client(
    client_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    d = await one(session, select(users).where(users.c.id == client_id, users.c.role == "client"))
    if not d:
        raise HTTPException(status_code=404, detail="Client not found")
    return serialize_user(d)


@api.put("/admin/clients/{client_id}")
async def update_client(
    client_id: str,
    payload: ClientUpdate,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    values = {
        k: v
        for k, v in payload.model_dump(exclude_unset=True).items()
        if v is not None or k == "sales_autoentry_email"
    }
    if "email" in values:
        values["email"] = values["email"].lower().strip()
        other = await one(
            session,
            select(users).where(users.c.email == values["email"], users.c.id != client_id),
        )
        if other:
            raise HTTPException(status_code=400, detail="Email already in use")
    if "autoentry_email" in values:
        values["autoentry_email"] = values["autoentry_email"].lower().strip()
    if "sales_autoentry_email" in values:
        values["sales_autoentry_email"] = values["sales_autoentry_email"].lower().strip() if values["sales_autoentry_email"] else None
    if "accounting_destination" in values or "native_accounting_enabled" in values:
        native_enabled = bool(values.get("native_accounting_enabled", False))
        values["accounting_destination"] = clean_accounting_destination(values.get("accounting_destination"), native_enabled)
        values["native_accounting_enabled"] = native_enabled or values["accounting_destination"] == "native"
        if values["native_accounting_enabled"] and "native_accounting_created_at" not in values:
            current = await get_user_by_id(session, client_id)
            if current and not current.get("native_accounting_created_at"):
                values["native_accounting_created_at"] = utc_now_iso()
    for field in CLIENT_PRACTICE_FIELDS:
        if field in values:
            values[field] = clean_optional_text(values[field])
    if values:
        result = await session.execute(
            update(users).where(users.c.id == client_id, users.c.role == "client").values(**values)
        )
        if result.rowcount == 0:
            await session.rollback()
            raise HTTPException(status_code=404, detail="Client not found")
        if values.get("native_accounting_enabled"):
            await ensure_native_accounting_client(session, client_id)
        await session.commit()
    d = await get_user_by_id(session, client_id)
    if not d:
        raise HTTPException(status_code=404, detail="Client not found")
    return serialize_user(d)


@api.delete("/admin/clients/{client_id}")
async def delete_client(
    client_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(delete(users).where(users.c.id == client_id, users.c.role == "client"))
    if result.rowcount == 0:
        await session.rollback()
        raise HTTPException(status_code=404, detail="Client not found")
    await session.execute(delete(outstanding_items).where(outstanding_items.c.client_id == client_id))
    await session.execute(delete(submissions).where(submissions.c.client_id == client_id))
    await session.commit()
    return {"ok": True}


# ---------- Admin: Native Accountancy Software ----------
def serialize_native_account(row: dict) -> dict:
    row = dict(row)
    account_type = str(row.get("account_type") or "").strip()
    category = str(row.get("category") or "").strip() or infer_account_category(account_type)
    control = bool(row.get("is_control_account")) or bool(row.get("control_account"))
    row["category"] = category
    row["purpose"] = str(row.get("purpose") or "").strip() or infer_account_purpose(row)
    row["is_control_account"] = control
    row["control_account"] = control
    row["current_balance"] = row.get("current_balance") or "0.00"
    return row


def infer_account_category(account_type: str) -> str:
    lookup = {
        "asset": "Asset",
        "bank": "Asset",
        "receivable": "Asset",
        "liability": "Liability",
        "payable": "Liability",
        "vat": "Liability",
        "tax": "Liability",
        "payroll": "Liability",
        "equity": "Equity",
        "income": "Income",
        "sales": "Income",
        "expense": "Expense",
        "purchases": "Expense",
        "cost of sales": "Expense",
        "overheads": "Expense",
    }
    return lookup.get(str(account_type or "").strip().lower(), "Expense")


def infer_account_purpose(account: dict) -> str:
    code = str(account.get("code") or "")
    name = str(account.get("name") or "").lower()
    account_type = str(account.get("account_type") or "").lower()
    if code == "1100" or "debtor" in name or account_type == "receivable":
        return "Sales Ledger"
    if code == "2000" or "creditor" in name or account_type == "payable":
        return "Purchase Ledger"
    if code == "1200" or account_type == "bank":
        return "Bank Account"
    if code == "2200" or account_type == "vat":
        return "VAT Control"
    if code == "9999" or "suspense" in name:
        return "Suspense"
    if code == "3200" or "retained" in name:
        return "Retained Earnings"
    if code == "2300" or "corporation tax" in name:
        return "Corporation Tax"
    if code == "2210" or "payroll" in name:
        return "Payroll Control"
    return "Standard Nominal"


def default_accounting_settings(client_id: str, now: Optional[str] = None) -> dict:
    timestamp = now or utc_now_iso()
    return {
        "id": new_id(),
        "client_id": client_id,
        "default_sales_account": "4000",
        "default_purchase_account": "5000",
        "default_vat_control_account": "2200",
        "default_bank_account": "1200",
        "default_suspense_account": "9999",
        "default_debtors_control_account": "1100",
        "default_creditors_control_account": "2000",
        "default_retained_earnings_account": "3200",
        "created_at": timestamp,
        "updated_at": timestamp,
    }


async def ensure_accounting_settings(session: AsyncSession, client_id: str) -> dict:
    existing = await one(session, select(accounting_settings).where(accounting_settings.c.client_id == client_id))
    if existing:
        return existing
    row = default_accounting_settings(client_id)
    await session.execute(insert(accounting_settings).values(**row))
    await session.flush()
    return row


def default_ap_settings(client_id: str, accounting_defaults: Optional[dict] = None, now: Optional[str] = None) -> dict:
    defaults = accounting_defaults or {}
    timestamp = now or utc_now_iso()
    return {
        "id": new_id(),
        "client_id": client_id,
        "approval_required": True,
        "default_payment_terms_days": 30,
        "default_purchase_account": defaults.get("default_purchase_account") or "5000",
        "default_vat_code": "",
        "duplicate_invoice_warning": True,
        "allow_future_posting_dates": False,
        "automatic_invoice_numbering": False,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


async def ensure_ap_settings(session: AsyncSession, client_id: str) -> dict:
    existing = await one(session, select(accounting_ap_settings).where(accounting_ap_settings.c.client_id == client_id))
    if existing:
        return existing
    accounting_defaults = await ensure_accounting_settings(session, client_id)
    row = default_ap_settings(client_id, accounting_defaults)
    await session.execute(insert(accounting_ap_settings).values(**row))
    await session.flush()
    return row


def parse_date_or_today(value: Any) -> date:
    raw = str(value or "").strip()
    if raw:
        try:
            return datetime.fromisoformat(raw[:10]).date()
        except Exception:
            pass
    return datetime.now(timezone.utc).date()


def ap_line_values(raw_line: dict, default_account: str = "5000") -> dict:
    quantity = money(raw_line.get("quantity"), "1.00")
    unit_price = money(raw_line.get("unit_price") if raw_line.get("unit_price") not in (None, "") else raw_line.get("price"))
    discount = money(raw_line.get("discount_amount"))
    explicit_net = raw_line.get("net_amount")
    net_amount = money(explicit_net) if explicit_net not in (None, "") else (quantity * unit_price - discount).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    vat_amount = money(raw_line.get("vat_amount"))
    gross_amount = money(raw_line.get("gross_amount")) if raw_line.get("gross_amount") not in (None, "") else net_amount + vat_amount
    return {
        "description": str(raw_line.get("description") or "").strip(),
        "nominal_account_code": str(raw_line.get("nominal_account_code") or raw_line.get("account_code") or default_account or "5000").strip(),
        "quantity": money_str(quantity),
        "unit_price": money_str(unit_price),
        "discount_amount": money_str(discount),
        "vat_code": str(raw_line.get("vat_code") or "").strip(),
        "net_amount": money_str(net_amount),
        "vat_amount": money_str(vat_amount),
        "gross_amount": money_str(gross_amount),
    }


def ap_totals(lines: list[dict]) -> dict:
    net = sum((money(line.get("net_amount")) for line in lines), Decimal("0.00"))
    vat = sum((money(line.get("vat_amount")) for line in lines), Decimal("0.00"))
    gross = sum((money(line.get("gross_amount")) for line in lines), Decimal("0.00"))
    if gross == Decimal("0.00") and (net or vat):
        gross = net + vat
    return {"net_amount": money_str(net), "vat_amount": money_str(vat), "gross_amount": money_str(gross)}


def serialize_ap_settings(row: dict) -> dict:
    return dict(row)


def serialize_native_contact(row: dict) -> dict:
    row = dict(row)
    row["raw_json"] = parse_json_object(row.get("raw_json")) or {}
    return row


def serialize_ap_supplier(profile: dict, contact: Optional[dict] = None, balance: Decimal = Decimal("0.00")) -> dict:
    row = dict(profile)
    contact = contact or {}
    row["name"] = contact.get("name") or profile.get("trading_name") or profile.get("supplier_code") or "Supplier"
    row["email"] = contact.get("email") or ""
    row["external_id"] = contact.get("external_id") or ""
    row["account_code"] = contact.get("account_code") or ""
    row["balance"] = money_str(balance)
    return row


def serialize_ap_invoice(row: dict, lines: Optional[list[dict]] = None, supplier: Optional[dict] = None) -> dict:
    item = dict(row)
    item["extracted_json"] = parse_json_object(item.get("extracted_json")) or {}
    item["lines"] = [dict(line) for line in (lines or [])]
    if supplier:
        item["supplier_name"] = supplier.get("name")
        item["supplier_code"] = supplier.get("supplier_code")
    return item


def serialize_ap_credit_note(row: dict, lines: Optional[list[dict]] = None, supplier: Optional[dict] = None) -> dict:
    item = dict(row)
    item["lines"] = [dict(line) for line in (lines or [])]
    if supplier:
        item["supplier_name"] = supplier.get("name")
        item["supplier_code"] = supplier.get("supplier_code")
    return item


def serialize_ap_payment(row: dict, allocations: Optional[list[dict]] = None, supplier: Optional[dict] = None) -> dict:
    item = dict(row)
    item["allocations"] = [dict(allocation) for allocation in (allocations or [])]
    if supplier:
        item["supplier_name"] = supplier.get("name")
        item["supplier_code"] = supplier.get("supplier_code")
    return item


async def accounts_payable_workspace(session: AsyncSession, client_id: str) -> dict:
    ap_settings = await ensure_ap_settings(session, client_id)
    contacts = await many(session, select(accounting_contacts).where(accounting_contacts.c.client_id == client_id, accounting_contacts.c.contact_type == "supplier"))
    contact_by_id = {str(contact.get("id")): contact for contact in contacts}
    profiles = await many(
        session,
        select(accounting_ap_supplier_profiles).where(accounting_ap_supplier_profiles.c.client_id == client_id).order_by(accounting_ap_supplier_profiles.c.supplier_code.asc(), accounting_ap_supplier_profiles.c.created_at.asc()),
    )
    existing_profile_contact_ids = {str(profile.get("contact_id")) for profile in profiles}
    now = utc_now_iso()
    for contact in contacts:
        if str(contact.get("id")) in existing_profile_contact_ids:
            continue
        profile = {
            "id": new_id(),
            "client_id": client_id,
            "contact_id": contact.get("id"),
            "supplier_code": contact.get("account_code") or "",
            "trading_name": contact.get("name"),
            "payment_terms_days": int(ap_settings.get("default_payment_terms_days") or 30),
            "default_currency": "GBP",
            "default_purchase_account": ap_settings.get("default_purchase_account") or "5000",
            "default_vat_code": ap_settings.get("default_vat_code") or "",
            "status": "active" if contact.get("active", True) else "inactive",
            "created_at": now,
            "updated_at": now,
        }
        await session.execute(insert(accounting_ap_supplier_profiles).values(**profile))
        profiles.append(profile)
        existing_profile_contact_ids.add(str(contact.get("id")))
    await session.flush()

    supplier_by_id: dict[str, dict] = {}
    supplier_by_contact: dict[str, dict] = {}
    for profile in profiles:
        contact = contact_by_id.get(str(profile.get("contact_id"))) or {}
        supplier = serialize_ap_supplier(profile, contact)
        supplier_by_id[str(profile["id"])] = supplier
        supplier_by_contact[str(profile.get("contact_id"))] = supplier

    invoices = await many(
        session,
        select(accounting_ap_invoices).where(accounting_ap_invoices.c.client_id == client_id).order_by(accounting_ap_invoices.c.invoice_date.desc(), accounting_ap_invoices.c.created_at.desc()),
    )
    invoice_ids = [str(row["id"]) for row in invoices]
    invoice_lines = []
    if invoice_ids:
        invoice_lines = await many(session, select(accounting_ap_invoice_lines).where(accounting_ap_invoice_lines.c.invoice_id.in_(invoice_ids)).order_by(accounting_ap_invoice_lines.c.line_number.asc()))
    invoice_lines_by_id: dict[str, list[dict]] = {}
    for line in invoice_lines:
        invoice_lines_by_id.setdefault(str(line.get("invoice_id")), []).append(line)

    credit_notes = await many(
        session,
        select(accounting_ap_credit_notes).where(accounting_ap_credit_notes.c.client_id == client_id).order_by(accounting_ap_credit_notes.c.credit_note_date.desc(), accounting_ap_credit_notes.c.created_at.desc()),
    )
    credit_ids = [str(row["id"]) for row in credit_notes]
    credit_lines = []
    if credit_ids:
        credit_lines = await many(session, select(accounting_ap_credit_note_lines).where(accounting_ap_credit_note_lines.c.credit_note_id.in_(credit_ids)).order_by(accounting_ap_credit_note_lines.c.line_number.asc()))
    credit_lines_by_id: dict[str, list[dict]] = {}
    for line in credit_lines:
        credit_lines_by_id.setdefault(str(line.get("credit_note_id")), []).append(line)

    payments = await many(
        session,
        select(accounting_ap_payments).where(accounting_ap_payments.c.client_id == client_id).order_by(accounting_ap_payments.c.payment_date.desc(), accounting_ap_payments.c.created_at.desc()),
    )
    payment_ids = [str(row["id"]) for row in payments]
    allocations = []
    if payment_ids:
        allocations = await many(session, select(accounting_ap_payment_allocations).where(accounting_ap_payment_allocations.c.payment_id.in_(payment_ids)))
    allocations_by_payment: dict[str, list[dict]] = {}
    for allocation in allocations:
        allocations_by_payment.setdefault(str(allocation.get("payment_id")), []).append(allocation)

    supplier_balances: dict[str, Decimal] = {}
    for invoice in invoices:
        supplier_balances[str(invoice.get("supplier_id"))] = supplier_balances.get(str(invoice.get("supplier_id")), Decimal("0.00")) + money(invoice.get("outstanding_amount"))
    for credit in credit_notes:
        supplier_balances[str(credit.get("supplier_id"))] = supplier_balances.get(str(credit.get("supplier_id")), Decimal("0.00")) - money(credit.get("unallocated_amount"))

    serialized_suppliers = []
    for profile in profiles:
        contact = contact_by_id.get(str(profile.get("contact_id"))) or {}
        serialized_suppliers.append(serialize_ap_supplier(profile, contact, supplier_balances.get(str(profile.get("id")), Decimal("0.00"))))

    today = datetime.now(timezone.utc).date()
    aged: dict[str, dict] = {}
    for invoice in invoices:
        outstanding = money(invoice.get("outstanding_amount"))
        if outstanding <= 0 or invoice.get("status") in {"void", "draft"}:
            continue
        supplier = supplier_by_id.get(str(invoice.get("supplier_id"))) or {}
        due_raw = str(invoice.get("due_date") or invoice.get("invoice_date") or "")[:10]
        try:
            due_date = datetime.fromisoformat(due_raw).date()
            age_days = max(0, (today - due_date).days)
        except Exception:
            age_days = 0
        bucket = "current" if age_days <= 0 else "days_1_30" if age_days <= 30 else "days_31_60" if age_days <= 60 else "days_61_90" if age_days <= 90 else "days_90_plus"
        row = aged.setdefault(str(invoice.get("supplier_id")), {
            "supplier_id": invoice.get("supplier_id"),
            "supplier_name": supplier.get("name") or "Supplier",
            "current": Decimal("0.00"),
            "days_1_30": Decimal("0.00"),
            "days_31_60": Decimal("0.00"),
            "days_61_90": Decimal("0.00"),
            "days_90_plus": Decimal("0.00"),
            "total": Decimal("0.00"),
        })
        row[bucket] += outstanding
        row["total"] += outstanding

    dashboard = {
        "supplier_count": len(serialized_suppliers),
        "draft_invoices": len([i for i in invoices if i.get("status") == "draft"]),
        "awaiting_approval": len([i for i in invoices if i.get("status") == "awaiting_approval"]),
        "posted_invoices": len([i for i in invoices if i.get("status") in {"posted", "part_paid", "paid"}]),
        "overdue_invoices": len([i for i in invoices if money(i.get("outstanding_amount")) > 0 and str(i.get("due_date") or "9999-99-99") < today.isoformat()]),
        "outstanding_total": money_str(sum((money(i.get("outstanding_amount")) for i in invoices), Decimal("0.00"))),
        "unallocated_credits": money_str(sum((money(c.get("unallocated_amount")) for c in credit_notes), Decimal("0.00"))),
        "payments_total": money_str(sum((money(p.get("amount")) for p in payments), Decimal("0.00"))),
    }

    return {
        "settings": serialize_ap_settings(ap_settings),
        "dashboard": dashboard,
        "suppliers": serialized_suppliers,
        "invoices": [serialize_ap_invoice(row, invoice_lines_by_id.get(str(row["id"]), []), supplier_by_id.get(str(row.get("supplier_id")))) for row in invoices],
        "credit_notes": [serialize_ap_credit_note(row, credit_lines_by_id.get(str(row["id"]), []), supplier_by_id.get(str(row.get("supplier_id")))) for row in credit_notes],
        "payments": [serialize_ap_payment(row, allocations_by_payment.get(str(row["id"]), []), supplier_by_id.get(str(row.get("supplier_id")))) for row in payments],
        "aged_creditors": [
            {**item, **{key: money_str(value) for key, value in item.items() if isinstance(value, Decimal)}}
            for item in sorted(aged.values(), key=lambda x: str(x.get("supplier_name") or ""))
        ],
    }


def default_ar_settings(client_id: str, accounting_defaults: Optional[dict] = None, now: Optional[str] = None) -> dict:
    defaults = accounting_defaults or {}
    timestamp = now or utc_now_iso()
    return {
        "id": new_id(),
        "client_id": client_id,
        "approval_required": True,
        "default_payment_terms_days": 30,
        "default_sales_account": defaults.get("default_sales_account") or "4000",
        "default_vat_code": "",
        "invoice_number_prefix": "SINV",
        "next_invoice_number": 1,
        "duplicate_invoice_warning": True,
        "credit_limit_warnings": True,
        "automatic_customer_numbering": True,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


async def ensure_ar_settings(session: AsyncSession, client_id: str) -> dict:
    existing = await one(session, select(accounting_ar_settings).where(accounting_ar_settings.c.client_id == client_id))
    if existing:
        return existing
    accounting_defaults = await ensure_accounting_settings(session, client_id)
    row = default_ar_settings(client_id, accounting_defaults)
    await session.execute(insert(accounting_ar_settings).values(**row))
    await session.flush()
    return row


def ar_line_values(raw_line: dict, default_account: str = "4000") -> dict:
    return ap_line_values(raw_line, default_account or "4000")


def ar_totals(lines: list[dict]) -> dict:
    return ap_totals(lines)


def serialize_ar_settings(row: dict) -> dict:
    return dict(row)


def serialize_ar_customer(profile: dict, contact: Optional[dict] = None, balance: Decimal = Decimal("0.00"), invoices: Optional[list[dict]] = None, receipts: Optional[list[dict]] = None) -> dict:
    row = dict(profile)
    contact = contact or {}
    invoices = invoices or []
    receipts = receipts or []
    row["name"] = contact.get("name") or profile.get("trading_name") or profile.get("customer_code") or "Customer"
    row["email"] = contact.get("email") or ""
    row["external_id"] = contact.get("external_id") or ""
    row["account_code"] = contact.get("account_code") or ""
    row["outstanding_balance"] = money_str(balance)
    row["current_balance"] = money_str(balance)
    row["last_invoice"] = max([str(invoice.get("invoice_date") or "") for invoice in invoices] or [""])
    row["last_receipt"] = max([str(receipt.get("receipt_date") or "") for receipt in receipts] or [""])
    return row


def serialize_ar_invoice(row: dict, lines: Optional[list[dict]] = None, customer: Optional[dict] = None) -> dict:
    item = dict(row)
    item["extracted_json"] = parse_json_object(item.get("extracted_json")) or {}
    item["lines"] = [dict(line) for line in (lines or [])]
    if customer:
        item["customer_name"] = customer.get("name")
        item["customer_code"] = customer.get("customer_code")
    return item


def serialize_ar_credit_note(row: dict, lines: Optional[list[dict]] = None, customer: Optional[dict] = None) -> dict:
    item = dict(row)
    item["lines"] = [dict(line) for line in (lines or [])]
    if customer:
        item["customer_name"] = customer.get("name")
        item["customer_code"] = customer.get("customer_code")
    return item


def serialize_ar_receipt(row: dict, allocations: Optional[list[dict]] = None, customer: Optional[dict] = None) -> dict:
    item = dict(row)
    item["allocations"] = [dict(allocation) for allocation in (allocations or [])]
    if customer:
        item["customer_name"] = customer.get("name")
        item["customer_code"] = customer.get("customer_code")
    return item


def ar_sales_summary(invoices: list[dict]) -> dict:
    today = datetime.now(timezone.utc).date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)

    def total_since(start: date) -> str:
        total = Decimal("0.00")
        for invoice in invoices:
            try:
                invoice_date = datetime.fromisoformat(str(invoice.get("invoice_date") or "")[:10]).date()
            except Exception:
                continue
            if invoice_date >= start and invoice.get("status") not in {"void", "draft"}:
                total += money(invoice.get("gross_amount"))
        return money_str(total)

    return {
        "today": total_since(today),
        "this_week": total_since(week_start),
        "this_month": total_since(month_start),
        "financial_year": total_since(year_start),
    }


async def accounts_receivable_workspace(session: AsyncSession, client_id: str) -> dict:
    ar_settings = await ensure_ar_settings(session, client_id)
    contacts = await many(session, select(accounting_contacts).where(accounting_contacts.c.client_id == client_id, accounting_contacts.c.contact_type == "customer"))
    contact_by_id = {str(contact.get("id")): contact for contact in contacts}
    profiles = await many(
        session,
        select(accounting_ar_customer_profiles).where(accounting_ar_customer_profiles.c.client_id == client_id).order_by(accounting_ar_customer_profiles.c.customer_code.asc(), accounting_ar_customer_profiles.c.created_at.asc()),
    )
    existing_profile_contact_ids = {str(profile.get("contact_id")) for profile in profiles}
    now = utc_now_iso()
    for contact in contacts:
        if str(contact.get("id")) in existing_profile_contact_ids:
            continue
        profile = {
            "id": new_id(),
            "client_id": client_id,
            "contact_id": contact.get("id"),
            "customer_code": contact.get("account_code") or "",
            "trading_name": contact.get("name"),
            "payment_terms_days": int(ar_settings.get("default_payment_terms_days") or 30),
            "default_currency": "GBP",
            "default_sales_account": ar_settings.get("default_sales_account") or "4000",
            "default_vat_code": ar_settings.get("default_vat_code") or "",
            "credit_limit": "0.00",
            "status": "active" if contact.get("active", True) else "inactive",
            "created_at": now,
            "updated_at": now,
        }
        await session.execute(insert(accounting_ar_customer_profiles).values(**profile))
        profiles.append(profile)
        existing_profile_contact_ids.add(str(contact.get("id")))
    await session.flush()

    customer_by_id: dict[str, dict] = {}
    for profile in profiles:
        customer_by_id[str(profile["id"])] = serialize_ar_customer(profile, contact_by_id.get(str(profile.get("contact_id"))) or {})

    invoices = await many(
        session,
        select(accounting_ar_invoices).where(accounting_ar_invoices.c.client_id == client_id).order_by(accounting_ar_invoices.c.invoice_date.desc(), accounting_ar_invoices.c.created_at.desc()),
    )
    invoice_ids = [str(row["id"]) for row in invoices]
    invoice_lines = []
    if invoice_ids:
        invoice_lines = await many(session, select(accounting_ar_invoice_lines).where(accounting_ar_invoice_lines.c.invoice_id.in_(invoice_ids)).order_by(accounting_ar_invoice_lines.c.line_number.asc()))
    invoice_lines_by_id: dict[str, list[dict]] = {}
    for line in invoice_lines:
        invoice_lines_by_id.setdefault(str(line.get("invoice_id")), []).append(line)

    credit_notes = await many(
        session,
        select(accounting_ar_credit_notes).where(accounting_ar_credit_notes.c.client_id == client_id).order_by(accounting_ar_credit_notes.c.credit_note_date.desc(), accounting_ar_credit_notes.c.created_at.desc()),
    )
    credit_ids = [str(row["id"]) for row in credit_notes]
    credit_lines = []
    if credit_ids:
        credit_lines = await many(session, select(accounting_ar_credit_note_lines).where(accounting_ar_credit_note_lines.c.credit_note_id.in_(credit_ids)).order_by(accounting_ar_credit_note_lines.c.line_number.asc()))
    credit_lines_by_id: dict[str, list[dict]] = {}
    for line in credit_lines:
        credit_lines_by_id.setdefault(str(line.get("credit_note_id")), []).append(line)

    receipts = await many(
        session,
        select(accounting_ar_receipts).where(accounting_ar_receipts.c.client_id == client_id).order_by(accounting_ar_receipts.c.receipt_date.desc(), accounting_ar_receipts.c.created_at.desc()),
    )
    receipt_ids = [str(row["id"]) for row in receipts]
    allocations = []
    if receipt_ids:
        allocations = await many(session, select(accounting_ar_receipt_allocations).where(accounting_ar_receipt_allocations.c.receipt_id.in_(receipt_ids)))
    allocations_by_receipt: dict[str, list[dict]] = {}
    for allocation in allocations:
        allocations_by_receipt.setdefault(str(allocation.get("receipt_id")), []).append(allocation)

    invoices_by_customer: dict[str, list[dict]] = {}
    receipts_by_customer: dict[str, list[dict]] = {}
    balances_by_customer: dict[str, Decimal] = {}
    for invoice in invoices:
        customer_id = str(invoice.get("customer_id"))
        invoices_by_customer.setdefault(customer_id, []).append(invoice)
        balances_by_customer[customer_id] = balances_by_customer.get(customer_id, Decimal("0.00")) + money(invoice.get("outstanding_amount"))
    for credit in credit_notes:
        customer_id = str(credit.get("customer_id"))
        balances_by_customer[customer_id] = balances_by_customer.get(customer_id, Decimal("0.00")) - money(credit.get("unallocated_amount"))
    for receipt in receipts:
        receipts_by_customer.setdefault(str(receipt.get("customer_id")), []).append(receipt)

    serialized_customers = []
    for profile in profiles:
        customer_id = str(profile.get("id"))
        serialized_customers.append(serialize_ar_customer(profile, contact_by_id.get(str(profile.get("contact_id"))) or {}, balances_by_customer.get(customer_id, Decimal("0.00")), invoices_by_customer.get(customer_id, []), receipts_by_customer.get(customer_id, [])))

    today = datetime.now(timezone.utc).date()
    aged: dict[str, dict] = {}
    overdue_invoices = []
    collection_days = []
    for invoice in invoices:
        outstanding = money(invoice.get("outstanding_amount"))
        if outstanding <= 0 or invoice.get("status") in {"void", "draft", "archived"}:
            continue
        customer = customer_by_id.get(str(invoice.get("customer_id"))) or {}
        due_raw = str(invoice.get("due_date") or invoice.get("invoice_date") or "")[:10]
        try:
            due_date = datetime.fromisoformat(due_raw).date()
            age_days = max(0, (today - due_date).days)
        except Exception:
            due_date = today
            age_days = 0
        bucket = "current" if age_days <= 0 else "days_1_30" if age_days <= 30 else "days_31_60" if age_days <= 60 else "days_61_90" if age_days <= 90 else "days_90_plus"
        row = aged.setdefault(str(invoice.get("customer_id")), {
            "customer_id": invoice.get("customer_id"),
            "customer_name": customer.get("name") or "Customer",
            "current": Decimal("0.00"),
            "days_1_30": Decimal("0.00"),
            "days_31_60": Decimal("0.00"),
            "days_61_90": Decimal("0.00"),
            "days_90_plus": Decimal("0.00"),
            "total": Decimal("0.00"),
        })
        row[bucket] += outstanding
        row["total"] += outstanding
        if due_date < today:
            overdue_invoices.append({**serialize_ar_invoice(invoice, invoice_lines_by_id.get(str(invoice["id"]), []), customer), "days_overdue": age_days})
    for invoice in invoices:
        if invoice.get("status") == "paid":
            try:
                collection_days.append(max(0, (datetime.fromisoformat(str(invoice.get("updated_at") or "")[:10]).date() - datetime.fromisoformat(str(invoice.get("invoice_date") or "")[:10]).date()).days))
            except Exception:
                pass

    customer_attention = []
    for customer in serialized_customers:
        balance = money(customer.get("outstanding_balance"))
        credit_limit = money(customer.get("credit_limit"))
        old_total = money((aged.get(str(customer.get("id"))) or {}).get("days_90_plus"))
        reasons = []
        if balance > 0:
            reasons.append("High balance")
        if old_total > 0:
            reasons.append("Long outstanding")
        if credit_limit > 0 and balance > credit_limit:
            reasons.append("Credit limit exceeded")
        if reasons:
            customer_attention.append({"customer_id": customer.get("id"), "customer_name": customer.get("name"), "balance": money_str(balance), "reasons": reasons})

    current_month = datetime.now(timezone.utc).date().strftime("%Y-%m")
    dashboard = {
        "customer_count": len(serialized_customers),
        "outstanding_invoices": len([i for i in invoices if money(i.get("outstanding_amount")) > 0 and i.get("status") not in {"void", "draft"}]),
        "overdue_invoices": len(overdue_invoices),
        "customers_with_balances": len([c for c in serialized_customers if money(c.get("outstanding_balance")) > 0]),
        "receipts_this_month": money_str(sum((money(r.get("amount")) for r in receipts if str(r.get("receipt_date") or "").startswith(current_month)), Decimal("0.00"))),
        "average_collection_days": int(sum(collection_days) / len(collection_days)) if collection_days else 0,
        "sales_this_month": ar_sales_summary(invoices)["this_month"],
        "outstanding_total": money_str(sum((money(i.get("outstanding_amount")) for i in invoices), Decimal("0.00"))),
        "unallocated_credits": money_str(sum((money(c.get("unallocated_amount")) for c in credit_notes), Decimal("0.00"))),
    }
    recent_activity = []
    for customer in serialized_customers:
        recent_activity.append({"date": customer.get("created_at"), "type": "Customer Created", "description": customer.get("name")})
    for invoice in invoices:
        recent_activity.append({"date": invoice.get("created_at"), "type": "Invoice Raised", "description": invoice.get("invoice_number"), "amount": invoice.get("gross_amount")})
        if invoice.get("posted_at"):
            recent_activity.append({"date": invoice.get("posted_at"), "type": "Invoice Posted", "description": invoice.get("invoice_number"), "amount": invoice.get("gross_amount")})
    for receipt in receipts:
        recent_activity.append({"date": receipt.get("created_at"), "type": "Receipt Allocated", "description": receipt.get("reference"), "amount": receipt.get("amount")})
    for credit in credit_notes:
        recent_activity.append({"date": credit.get("created_at"), "type": "Credit Note Issued", "description": credit.get("credit_note_number"), "amount": credit.get("gross_amount")})
    recent_activity = sorted([item for item in recent_activity if item.get("date")], key=lambda item: str(item.get("date")), reverse=True)[:12]

    serialized_invoices = [serialize_ar_invoice(row, invoice_lines_by_id.get(str(row["id"]), []), customer_by_id.get(str(row.get("customer_id")))) for row in invoices]
    serialized_receipts = [serialize_ar_receipt(row, allocations_by_receipt.get(str(row["id"]), []), customer_by_id.get(str(row.get("customer_id")))) for row in receipts]
    return {
        "settings": serialize_ar_settings(ar_settings),
        "dashboard": dashboard,
        "customers": serialized_customers,
        "invoices": serialized_invoices,
        "credit_notes": [serialize_ar_credit_note(row, credit_lines_by_id.get(str(row["id"]), []), customer_by_id.get(str(row.get("customer_id")))) for row in credit_notes],
        "receipts": serialized_receipts,
        "aged_debtors": [
            {**item, **{key: money_str(value) for key, value in item.items() if isinstance(value, Decimal)}}
            for item in sorted(aged.values(), key=lambda x: str(x.get("customer_name") or ""))
        ],
        "recent_activity": recent_activity,
        "overdue_invoices": sorted(overdue_invoices, key=lambda item: int(item.get("days_overdue") or 0), reverse=True),
        "customers_requiring_attention": customer_attention,
        "sales_summary": ar_sales_summary(invoices),
        "reports": {
            "sales_day_book": serialized_invoices,
            "outstanding_invoices": [invoice for invoice in serialized_invoices if money(invoice.get("outstanding_amount")) > 0],
            "receipts_analysis": serialized_receipts,
            "sales_analysis": ar_sales_summary(invoices),
        },
    }


async def native_accounting_summary(session: AsyncSession, client_id: str) -> dict:
    journals = await many(session, select(accounting_journal_entries).where(accounting_journal_entries.c.client_id == client_id))
    lines = await many(session, select(accounting_journal_lines).where(accounting_journal_lines.c.client_id == client_id))
    bank_transactions = await many(session, select(accounting_bank_transactions).where(accounting_bank_transactions.c.client_id == client_id))
    vat_returns = await many(session, select(accounting_vat_returns).where(accounting_vat_returns.c.client_id == client_id))
    ap_invoices = await many(session, select(accounting_ap_invoices).where(accounting_ap_invoices.c.client_id == client_id))
    ar_invoices = await many(session, select(accounting_ar_invoices).where(accounting_ar_invoices.c.client_id == client_id))
    payables = Decimal("0.00")
    receivables = Decimal("0.00")
    vat = Decimal("0.00")
    bank = Decimal("0.00")
    for line in lines:
        code = str(line.get("account_code") or "")
        movement = money(line.get("debit")) - money(line.get("credit"))
        if code == "2000":
            payables += -movement
        elif code == "1100":
            receivables += movement
        elif code == "2200":
            vat += -movement
        elif code == "1200":
            bank += movement
    return {
        "journals": len(journals),
        "payables": money_str(payables),
        "receivables": money_str(receivables),
        "vat": money_str(vat),
        "vat_balance": money_str(vat),
        "bank": money_str(bank),
        "bank_balance": money_str(bank),
        "bank_transactions": len(bank_transactions),
        "unreconciled_bank_transactions": len([t for t in bank_transactions if t.get("status") != "reconciled"]),
        "vat_returns": len(vat_returns),
        "draft_vat_returns": len([r for r in vat_returns if r.get("status") == "draft"]),
        "ap_open_invoices": len([i for i in ap_invoices if money(i.get("outstanding_amount")) > 0]),
        "ap_outstanding": money_str(sum((money(i.get("outstanding_amount")) for i in ap_invoices), Decimal("0.00"))),
        "ar_open_invoices": len([i for i in ar_invoices if money(i.get("outstanding_amount")) > 0]),
        "ar_outstanding": money_str(sum((money(i.get("outstanding_amount")) for i in ar_invoices), Decimal("0.00"))),
    }


async def add_accounting_audit(
    session: AsyncSession,
    client_id: str,
    actor_id: Optional[str],
    action: str,
    entity_type: str,
    entity_id: str,
    details: Optional[dict] = None,
):
    await session.execute(
        insert(accounting_audit_log).values(
            id=new_id(),
            client_id=client_id,
            actor_id=actor_id,
            module=entity_type,
            record_type=entity_type,
            record_id=entity_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            previous_value=None,
            new_value=json.dumps(details or {}),
            ip_address=None,
            details_json=json.dumps(details or {}),
            created_at=utc_now_iso(),
        )
    )


def serialize_bank_transaction(row: dict) -> dict:
    row = dict(row)
    row["raw_json"] = parse_json_object(row.get("raw_json")) or {}
    row["money_in"] = money_str(money(row.get("money_in")))
    row["money_out"] = money_str(money(row.get("money_out")))
    return row


def serialize_bank_account(row: dict, balance: Decimal = Decimal("0.00"), reconciled: Decimal = Decimal("0.00")) -> dict:
    item = dict(row)
    item["current_balance"] = money_str(balance)
    item["reconciled_balance"] = money_str(reconciled)
    return item


def serialize_bank_import(row: dict) -> dict:
    item = dict(row)
    item["raw_summary"] = parse_json_object(item.get("raw_summary")) or {}
    return item


def serialize_bank_rule(row: dict) -> dict:
    return dict(row)


def serialize_bank_transfer(row: dict) -> dict:
    return dict(row)


def bank_transaction_amount(row: dict) -> Decimal:
    return money(row.get("money_in")) - money(row.get("money_out"))


async def ensure_bank_settings(session: AsyncSession, client_id: str) -> dict:
    existing = await one(session, select(accounting_bank_settings).where(accounting_bank_settings.c.client_id == client_id))
    if existing:
        return existing
    settings_row = await ensure_accounting_settings(session, client_id)
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "default_transfer_account": settings_row.get("default_bank_account") or "1200",
        "default_bank_charges_account": "7000",
        "default_interest_account": "4000",
        "default_suspense_account": settings_row.get("default_suspense_account") or "9999",
        "statement_number_prefix": "STMT",
        "automatic_matching_threshold": 85,
        "duplicate_detection": True,
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_bank_settings).values(**row))
    await session.flush()
    return row


async def ensure_default_bank_account(session: AsyncSession, client_id: str, accounts: Optional[list[dict]] = None) -> dict:
    existing = await many(session, select(accounting_bank_accounts).where(accounting_bank_accounts.c.client_id == client_id).order_by(accounting_bank_accounts.c.default_account.desc(), accounting_bank_accounts.c.created_at.asc()))
    if existing:
        return existing[0]
    accounts = accounts or await ensure_native_accounting_client(session, client_id)
    settings_row = await ensure_accounting_settings(session, client_id)
    bank_account = find_native_account(accounts, settings_row.get("default_bank_account"), "1200")
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "account_name": bank_account.get("name") or "Current Account",
        "bank_name": "",
        "account_number": "",
        "sort_code": "",
        "currency": "GBP",
        "nominal_account_code": bank_account.get("code") or "1200",
        "opening_balance": "0.00",
        "default_account": True,
        "allow_payments": True,
        "allow_receipts": True,
        "active": True,
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_bank_accounts).values(**row))
    await session.flush()
    return row


def match_bank_rule(rule: dict, transaction: dict) -> bool:
    field = str(rule.get("field") or "description")
    value = str(rule.get("value") or "").lower().strip()
    haystack = str(transaction.get(field) or transaction.get("description") or "").lower()
    if value:
        operator = str(rule.get("operator") or "contains")
        if operator == "starts_with" and not haystack.startswith(value):
            return False
        if operator == "ends_with" and not haystack.endswith(value):
            return False
        if operator == "equals" and haystack != value:
            return False
        if operator == "contains" and value not in haystack:
            return False
    amount_value = money(rule.get("amount_value"))
    if amount_value:
        amount = abs(bank_transaction_amount(transaction))
        op = str(rule.get("amount_operator") or "equals")
        if op == "greater_than" and not amount > amount_value:
            return False
        if op == "less_than" and not amount < amount_value:
            return False
        if op == "equals" and amount != amount_value:
            return False
    return True


def suggest_bank_matches(transaction: dict, ap_invoices: list[dict], suppliers: list[dict], rules: list[dict], ar_invoices: Optional[list[dict]] = None, customers: Optional[list[dict]] = None) -> list[dict]:
    suggestions = []
    amount = abs(bank_transaction_amount(transaction))
    description = f"{transaction.get('description') or ''} {transaction.get('reference') or ''}".lower()
    if money(transaction.get("money_out")):
        supplier_by_id = {str(s.get("id")): s for s in suppliers}
        for invoice in ap_invoices:
            outstanding = money(invoice.get("outstanding_amount"))
            if outstanding <= 0:
                continue
            confidence = 0
            reasons = []
            if amount == outstanding:
                confidence += 45
                reasons.append("amount")
            elif amount and abs(amount - outstanding) <= Decimal("1.00"):
                confidence += 25
                reasons.append("near amount")
            supplier = supplier_by_id.get(str(invoice.get("supplier_id"))) or {}
            supplier_name = str(supplier.get("name") or invoice.get("supplier_name") or "").lower()
            if supplier_name and supplier_name in description:
                confidence += 30
                reasons.append("supplier")
            invoice_number = str(invoice.get("invoice_number") or "").lower()
            if invoice_number and invoice_number in description:
                confidence += 20
                reasons.append("invoice number")
            if confidence:
                suggestions.append({
                    "type": "ap_invoice",
                    "record_id": invoice.get("id"),
                    "label": f"{supplier.get('name') or invoice.get('supplier_name') or 'Supplier'} - {invoice.get('invoice_number')}",
                    "amount": money_str(outstanding),
                    "confidence": min(99, confidence),
                    "reasons": reasons,
                })
    if money(transaction.get("money_in")):
        customer_by_id = {str(c.get("id")): c for c in (customers or [])}
        for invoice in (ar_invoices or []):
            outstanding = money(invoice.get("outstanding_amount"))
            if outstanding <= 0:
                continue
            confidence = 0
            reasons = []
            if amount == outstanding:
                confidence += 45
                reasons.append("amount")
            elif amount and abs(amount - outstanding) <= Decimal("1.00"):
                confidence += 25
                reasons.append("near amount")
            customer = customer_by_id.get(str(invoice.get("customer_id"))) or {}
            customer_name = str(customer.get("business_name") or invoice.get("customer_name") or "").lower()
            if customer_name and customer_name in description:
                confidence += 30
                reasons.append("customer")
            invoice_number = str(invoice.get("invoice_number") or "").lower()
            if invoice_number and invoice_number in description:
                confidence += 20
                reasons.append("invoice number")
            reference = str(invoice.get("reference") or "").lower()
            if reference and reference in description:
                confidence += 10
                reasons.append("reference")
            if confidence:
                suggestions.append({
                    "type": "ar_invoice",
                    "record_id": invoice.get("id"),
                    "label": f"{customer.get('business_name') or invoice.get('customer_name') or 'Customer'} - {invoice.get('invoice_number')}",
                    "amount": money_str(outstanding),
                    "confidence": min(99, confidence),
                    "reasons": reasons,
                })
    for rule in rules:
        if rule.get("active", True) and match_bank_rule(rule, transaction):
            suggestions.append({
                "type": "rule",
                "record_id": rule.get("id"),
                "label": f"Rule: {rule.get('name')} -> {rule.get('target_account_code')}",
                "amount": money_str(amount),
                "confidence": 80,
                "reasons": ["bank rule"],
            })
    return sorted(suggestions, key=lambda item: item.get("confidence", 0), reverse=True)[:5]


async def banking_workspace(session: AsyncSession, client_id: str, accounts: Optional[list[dict]] = None) -> dict:
    accounts = accounts or await ensure_native_accounting_client(session, client_id)
    await ensure_default_bank_account(session, client_id, accounts)
    settings = await ensure_bank_settings(session, client_id)
    bank_accounts = await many(session, select(accounting_bank_accounts).where(accounting_bank_accounts.c.client_id == client_id).order_by(accounting_bank_accounts.c.default_account.desc(), accounting_bank_accounts.c.account_name.asc()))
    transactions = await many(session, select(accounting_bank_transactions).where(accounting_bank_transactions.c.client_id == client_id).order_by(accounting_bank_transactions.c.transaction_date.desc(), accounting_bank_transactions.c.created_at.desc()))
    imports = await many(session, select(accounting_bank_imports).where(accounting_bank_imports.c.client_id == client_id).order_by(accounting_bank_imports.c.created_at.desc()))
    rules = await many(session, select(accounting_bank_rules).where(accounting_bank_rules.c.client_id == client_id).order_by(accounting_bank_rules.c.active.desc(), accounting_bank_rules.c.name.asc()))
    transfers = await many(session, select(accounting_bank_transfers).where(accounting_bank_transfers.c.client_id == client_id).order_by(accounting_bank_transfers.c.transfer_date.desc(), accounting_bank_transfers.c.created_at.desc()))
    balances = await native_account_balances(session, client_id)
    ap = await accounts_payable_workspace(session, client_id)
    ar = await accounts_receivable_workspace(session, client_id)
    account_by_id = {str(account.get("id")): account for account in bank_accounts}
    for transaction in transactions:
        bank_account = account_by_id.get(str(transaction.get("bank_account_id") or ""))
        if bank_account:
            transaction["bank_account_name"] = bank_account.get("account_name")
            transaction["bank_account_code"] = bank_account.get("nominal_account_code")
        transaction["amount"] = money_str(bank_transaction_amount(transaction))
        transaction["suggestions"] = suggest_bank_matches(transaction, ap.get("invoices", []), ap.get("suppliers", []), rules, ar.get("invoices", []), ar.get("customers", [])) if transaction.get("status") in {None, "unreconciled", "imported"} else []
        if transaction["suggestions"]:
            transaction["suggested_match"] = transaction["suggestions"][0]["label"]
            transaction["confidence"] = transaction["suggestions"][0]["confidence"]
    serialized_accounts = []
    for account in bank_accounts:
        code = str(account.get("nominal_account_code") or "")
        reconciled = sum((bank_transaction_amount(t) for t in transactions if str(t.get("bank_account_id") or "") == str(account.get("id")) and t.get("status") == "reconciled"), Decimal("0.00"))
        serialized_accounts.append(serialize_bank_account(account, balances.get(code, Decimal("0.00")), reconciled))
    current_month = datetime.now(timezone.utc).date().strftime("%Y-%m")
    dashboard = {
        "current_bank_balance": money_str(sum((money(a.get("current_balance")) for a in serialized_accounts), Decimal("0.00"))),
        "unreconciled_transactions": len([t for t in transactions if t.get("status") in {None, "unreconciled", "imported"}]),
        "imported_transactions": len([t for t in transactions if str(t.get("source_type") or "") in {"csv", "open_banking", "ofx", "qif", "mt940"}]),
        "awaiting_match": len([t for t in transactions if t.get("status") in {None, "unreconciled", "imported"} and t.get("suggestions")]),
        "transfers_this_month": len([t for t in transfers if str(t.get("transfer_date") or "").startswith(current_month)]),
        "last_bank_import": imports[0].get("created_at") if imports else None,
    }
    return {
        "settings": dict(settings),
        "dashboard": dashboard,
        "bank_accounts": serialized_accounts,
        "transactions": [serialize_bank_transaction(t) for t in transactions],
        "imports": [serialize_bank_import(i) for i in imports],
        "rules": [serialize_bank_rule(r) for r in rules],
        "transfers": [serialize_bank_transfer(t) for t in transfers],
        "cashbook": [serialize_bank_transaction(t) for t in sorted(transactions, key=lambda item: (str(item.get("transaction_date") or ""), str(item.get("created_at") or "")), reverse=True)],
        "reports": {
            "unreconciled_items": [serialize_bank_transaction(t) for t in transactions if t.get("status") in {None, "unreconciled", "imported"}],
            "bank_charges": [serialize_bank_transaction(t) for t in transactions if t.get("transaction_type") == "bank_charge"],
            "interest": [serialize_bank_transaction(t) for t in transactions if t.get("transaction_type") == "interest"],
            "transfers": [serialize_bank_transfer(t) for t in transfers],
        },
    }


def serialize_vat_return(row: dict) -> dict:
    row = dict(row)
    row["prepared_json"] = parse_json_object(row.get("prepared_json")) or {}
    return row


def serialize_period(row: dict) -> dict:
    return dict(row)


def serialize_audit_event(row: dict) -> dict:
    row = dict(row)
    row["details_json"] = parse_json_object(row.get("details_json")) or {}
    return row


def serialize_accounting_settings(row: dict) -> dict:
    return dict(row)


def serialize_financial_year(row: dict) -> dict:
    return dict(row)


async def accounting_period_transaction_counts(session: AsyncSession, client_id: str) -> dict[str, int]:
    periods = await many(session, select(accounting_periods).where(accounting_periods.c.client_id == client_id))
    journals = await many(session, select(accounting_journal_entries).where(accounting_journal_entries.c.client_id == client_id))
    counts: dict[str, int] = {}
    for period in periods:
        start = str(period.get("period_start") or "")
        end = str(period.get("period_end") or "")
        counts[str(period.get("id"))] = len([
            journal for journal in journals
            if start <= str(journal.get("entry_date") or "") <= end and journal.get("status") == "posted"
        ])
    return counts


async def native_account_balances(session: AsyncSession, client_id: str) -> dict[str, Decimal]:
    balances: dict[str, Decimal] = {}
    lines = await many(session, select(accounting_journal_lines).where(accounting_journal_lines.c.client_id == client_id))
    for line in lines:
        code = str(line.get("account_code") or "")
        if not code:
            continue
        balances[code] = balances.get(code, Decimal("0.00")) + money(line.get("debit")) - money(line.get("credit"))
    return balances


async def native_accounting_reports(session: AsyncSession, client_id: str) -> dict:
    accounts = await many(session, select(accounting_accounts).where(accounting_accounts.c.client_id == client_id))
    account_by_code = {str(account.get("code") or ""): account for account in accounts}
    contacts = await many(session, select(accounting_contacts).where(accounting_contacts.c.client_id == client_id))
    contact_by_id = {str(contact.get("id") or ""): contact for contact in contacts}
    journals = await many(session, select(accounting_journal_entries).where(accounting_journal_entries.c.client_id == client_id))
    journal_by_id = {str(journal.get("id") or ""): journal for journal in journals}
    lines = await many(session, select(accounting_journal_lines).where(accounting_journal_lines.c.client_id == client_id))

    balances: dict[str, Decimal] = {}
    aged_receivables: dict[str, dict] = {}
    aged_payables: dict[str, dict] = {}
    today = datetime.now(timezone.utc).date()
    for line in lines:
        code = str(line.get("account_code") or "")
        if not code:
            continue
        debit = money(line.get("debit"))
        credit = money(line.get("credit"))
        balances[code] = balances.get(code, Decimal("0.00")) + debit - credit
        if code not in ("1100", "2000"):
            continue
        contact_id = str(line.get("contact_id") or "")
        contact = contact_by_id.get(contact_id) or {}
        contact_name = contact.get("name") or line.get("contact_name") or "Unassigned"
        journal = journal_by_id.get(str(line.get("entry_id") or "")) or {}
        entry_date = str(journal.get("entry_date") or "")[:10]
        try:
            age_days = max(0, (today - datetime.fromisoformat(entry_date).date()).days)
        except Exception:
            age_days = 0
        bucket = "current" if age_days <= 30 else "days_31_60" if age_days <= 60 else "days_61_90" if age_days <= 90 else "days_90_plus"
        target = aged_receivables if code == "1100" else aged_payables
        movement = debit - credit if code == "1100" else credit - debit
        if not movement:
            continue
        key = contact_id or contact_name.lower()
        row = target.setdefault(key, {
            "contact_id": contact_id or None,
            "contact_name": contact_name,
            "current": Decimal("0.00"),
            "days_31_60": Decimal("0.00"),
            "days_61_90": Decimal("0.00"),
            "days_90_plus": Decimal("0.00"),
            "total": Decimal("0.00"),
        })
        row[bucket] += movement
        row["total"] += movement

    trial_balance = []
    income_total = Decimal("0.00")
    expense_total = Decimal("0.00")
    asset_total = Decimal("0.00")
    liability_total = Decimal("0.00")
    equity_total = Decimal("0.00")

    for account in sorted(accounts, key=lambda item: str(item.get("code") or "")):
        code = str(account.get("code") or "")
        balance = balances.get(code, Decimal("0.00"))
        account_type = str(account.get("account_type") or "").lower()
        if account_type == "income":
            income_total += -balance
        elif account_type == "expense":
            expense_total += balance
        elif account_type in ("asset", "bank", "receivable"):
            asset_total += balance
        elif account_type in ("liability", "payable", "vat"):
            liability_total += -balance
        elif account_type == "equity":
            equity_total += -balance
        if balance:
            trial_balance.append({
                "code": code,
                "name": account.get("name"),
                "type": account_type,
                "debit": money_str(balance if balance > 0 else Decimal("0.00")),
                "credit": money_str(-balance if balance < 0 else Decimal("0.00")),
            })

    return {
        "profit_and_loss": {
            "income": money_str(income_total),
            "expenses": money_str(expense_total),
            "profit": money_str(income_total - expense_total),
        },
        "balance_sheet": {
            "assets": money_str(asset_total),
            "liabilities": money_str(liability_total),
            "equity": money_str(equity_total),
            "net_assets": money_str(asset_total - liability_total),
        },
        "trial_balance": trial_balance,
        "aged_receivables": serialize_aged_balances(aged_receivables),
        "aged_payables": serialize_aged_balances(aged_payables),
        "account_count": len(account_by_code),
    }


def serialize_aged_balances(rows: dict[str, dict]) -> list[dict]:
    result = []
    for row in rows.values():
        if row["total"] == Decimal("0.00"):
            continue
        result.append({
            "contact_id": row.get("contact_id"),
            "contact_name": row.get("contact_name"),
            "current": money_str(row["current"]),
            "days_31_60": money_str(row["days_31_60"]),
            "days_61_90": money_str(row["days_61_90"]),
            "days_90_plus": money_str(row["days_90_plus"]),
            "total": money_str(row["total"]),
        })
    return sorted(result, key=lambda item: str(item.get("contact_name") or "").lower())


def pick_csv_value(row: dict, candidates: list[str]) -> str:
    lookup = {str(k or "").strip().lower(): v for k, v in row.items()}
    for candidate in candidates:
        if candidate in lookup and lookup[candidate] not in (None, ""):
            return str(lookup[candidate]).strip()
    return ""


def parse_bank_csv_amount(value: str) -> Decimal:
    text_value = str(value or "").strip()
    if not text_value:
        return Decimal("0.00")
    negative = text_value.startswith("(") and text_value.endswith(")")
    text_value = text_value.replace("£", "").replace(",", "").replace("(", "").replace(")", "")
    parsed = money(text_value)
    return -parsed if negative else parsed


def normalize_csv_date(value: str) -> str:
    text_value = str(value or "").strip()
    if not text_value:
        return datetime.now(timezone.utc).date().isoformat()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y"):
        try:
            return datetime.strptime(text_value, fmt).date().isoformat()
        except ValueError:
            pass
    return text_value


def add_months_to_date(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(value.day, last_day))


def parse_iso_date(value: str, field_name: str) -> date:
    try:
        return datetime.fromisoformat(str(value or "")[:10]).date()
    except Exception:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a valid date.")


@api.get("/admin/accounting/clients")
async def list_native_accounting_clients(
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    docs = await many(
        session,
        select(users)
        .where(
            users.c.role == "client",
            or_(users.c.native_accounting_enabled == True, users.c.accounting_destination == "native"),  # noqa: E712
        )
        .order_by(users.c.business_name.asc()),
    )
    result = []
    for doc in docs:
        client = serialize_user(doc)
        client["summary"] = await native_accounting_summary(session, str(doc["id"]))
        result.append(client)
    return {"clients": result, "modules": NATIVE_ACCOUNTING_MODULES}


@api.get("/admin/accounting/clients/{client_id}")
async def get_native_accounting_workspace(
    client_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="EPOS native accounting is not enabled for this client.")
    await ensure_native_accounting_client(session, client_id)
    await session.commit()
    accounts = await many(
        session,
        select(accounting_accounts).where(accounting_accounts.c.client_id == client_id).order_by(accounting_accounts.c.code.asc()),
    )
    balances = await native_account_balances(session, client_id)
    for account in accounts:
        account["current_balance"] = money_str(balances.get(str(account.get("code") or ""), Decimal("0.00")))
    settings_row = await ensure_accounting_settings(session, client_id)
    financial_years = await many(
        session,
        select(accounting_financial_years).where(accounting_financial_years.c.client_id == client_id).order_by(accounting_financial_years.c.start_date.desc()),
    )
    contacts = await many(
        session,
        select(accounting_contacts).where(accounting_contacts.c.client_id == client_id).order_by(accounting_contacts.c.name.asc()),
    )
    journals = await many(
        session,
        select(accounting_journal_entries).where(accounting_journal_entries.c.client_id == client_id).order_by(accounting_journal_entries.c.entry_date.desc(), accounting_journal_entries.c.created_at.desc()),
    )
    vat_returns = await many(
        session,
        select(accounting_vat_returns).where(accounting_vat_returns.c.client_id == client_id).order_by(accounting_vat_returns.c.period_end.desc(), accounting_vat_returns.c.created_at.desc()),
    )
    periods = await many(
        session,
        select(accounting_periods).where(accounting_periods.c.client_id == client_id).order_by(accounting_periods.c.period_start.asc(), accounting_periods.c.created_at.asc()),
    )
    period_counts = await accounting_period_transaction_counts(session, client_id)
    for period in periods:
        period["transactions_posted"] = period_counts.get(str(period.get("id")), 0)
    audit_events = await many(
        session,
        select(accounting_audit_log).where(accounting_audit_log.c.client_id == client_id).order_by(accounting_audit_log.c.created_at.desc()).limit(50),
    )
    journal_ids = [str(j["id"]) for j in journals]
    lines = []
    if journal_ids:
        lines = await many(
            session,
            select(accounting_journal_lines).where(accounting_journal_lines.c.entry_id.in_(journal_ids)).order_by(accounting_journal_lines.c.created_at.asc()),
        )
    lines_by_entry: dict[str, list[dict]] = {}
    for line in lines:
        lines_by_entry.setdefault(str(line["entry_id"]), []).append(line)
    for journal in journals:
        journal["lines"] = lines_by_entry.get(str(journal["id"]), [])
    return {
        "client": serialize_user(client),
        "modules": NATIVE_ACCOUNTING_MODULES,
        "summary": await native_accounting_summary(session, client_id),
        "accounts": [serialize_native_account(a) for a in accounts],
        "accounting_settings": serialize_accounting_settings(settings_row),
        "financial_years": [serialize_financial_year(y) for y in financial_years],
        "contacts": [serialize_native_contact(c) for c in contacts],
        "journals": journals,
        "banking": await banking_workspace(session, client_id, accounts),
        "bank_transactions": [serialize_bank_transaction(t) for t in (await many(session, select(accounting_bank_transactions).where(accounting_bank_transactions.c.client_id == client_id).order_by(accounting_bank_transactions.c.transaction_date.desc(), accounting_bank_transactions.c.created_at.desc())))],
        "vat_returns": [serialize_vat_return(r) for r in vat_returns],
        "periods": [serialize_period(p) for p in periods],
        "audit_log": [serialize_audit_event(e) for e in audit_events],
        "reports": await native_accounting_reports(session, client_id),
        "accounts_payable": await accounts_payable_workspace(session, client_id),
        "accounts_receivable": await accounts_receivable_workspace(session, client_id),
    }


@api.post("/admin/accounting/clients/{client_id}/accounts")
async def create_native_account(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding accounts.")
    code = str(payload.get("code") or "").strip()
    name = str(payload.get("name") or "").strip()
    if not code or not name:
        raise HTTPException(status_code=400, detail="Account code and name are required.")
    existing = await one(session, select(accounting_accounts).where(accounting_accounts.c.client_id == client_id, accounting_accounts.c.code == code))
    if existing:
        raise HTTPException(status_code=400, detail="An account with this code already exists.")
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "code": code,
        "name": name,
        "category": str(payload.get("category") or infer_account_category(payload.get("account_type") or payload.get("type") or "expense")).strip(),
        "account_type": str(payload.get("account_type") or payload.get("type") or "Expense").strip(),
        "purpose": str(payload.get("purpose") or "Standard Nominal").strip(),
        "normal_balance": str(payload.get("normal_balance") or "debit").strip().lower(),
        "control_account": bool(payload.get("is_control_account") or payload.get("control_account")),
        "is_control_account": bool(payload.get("is_control_account") or payload.get("control_account")),
        "active": bool(payload.get("active", True)),
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_accounts).values(**row))
    await add_accounting_audit(session, client_id, user.get("id"), "account_created", "account", row["id"], {"code": code, "name": name})
    await session.commit()
    return serialize_native_account(row)


@api.post("/admin/accounting/clients/{client_id}/contacts")
async def create_native_contact(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding contacts.")
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Contact name is required.")
    contact_type = str(payload.get("contact_type") or payload.get("type") or "supplier").strip().lower()
    if contact_type not in ("supplier", "customer"):
        contact_type = "supplier"
    existing = await one(
        session,
        select(accounting_contacts).where(
            accounting_contacts.c.client_id == client_id,
            func.lower(accounting_contacts.c.name) == name.lower(),
            accounting_contacts.c.contact_type == contact_type,
        ),
    )
    if existing:
        raise HTTPException(status_code=400, detail="This contact already exists.")
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "name": name,
        "contact_type": contact_type,
        "email": str(payload.get("email") or "").strip(),
        "external_id": str(payload.get("external_id") or "").strip(),
        "active": bool(payload.get("active", True)),
        "raw_json": json.dumps({"source": "native"}),
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_contacts).values(**row))
    await add_accounting_audit(session, client_id, user.get("id"), "contact_created", "contact", row["id"], {"name": name, "type": contact_type})
    await session.commit()
    return serialize_native_contact(row)


async def get_ap_supplier_or_404(session: AsyncSession, client_id: str, supplier_id: str) -> dict:
    supplier = await one(
        session,
        select(accounting_ap_supplier_profiles).where(
            accounting_ap_supplier_profiles.c.client_id == client_id,
            accounting_ap_supplier_profiles.c.id == supplier_id,
        ),
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found.")
    return supplier


async def get_ap_invoice_or_404(session: AsyncSession, client_id: str, invoice_id: str) -> dict:
    invoice = await one(
        session,
        select(accounting_ap_invoices).where(
            accounting_ap_invoices.c.client_id == client_id,
            accounting_ap_invoices.c.id == invoice_id,
        ),
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Purchase invoice not found.")
    return invoice


async def create_ap_invoice_record(
    session: AsyncSession,
    client_id: str,
    payload: dict,
    actor_id: Optional[str] = None,
) -> dict:
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding purchase invoices.")
    ap_settings = await ensure_ap_settings(session, client_id)
    settings_row = await ensure_accounting_settings(session, client_id)
    supplier_id = str(payload.get("supplier_id") or "").strip()
    supplier = None
    if supplier_id:
        supplier = await get_ap_supplier_or_404(session, client_id, supplier_id)
    else:
        supplier_name = str(payload.get("supplier_name") or payload.get("vendor_name") or "").strip()
        if not supplier_name:
            raise HTTPException(status_code=400, detail="Supplier is required.")
        contact = await get_or_create_native_contact(session, client_id, supplier_name, "supplier")
        profile = await one(session, select(accounting_ap_supplier_profiles).where(accounting_ap_supplier_profiles.c.contact_id == contact["id"]))
        if not profile:
            now = utc_now_iso()
            profile = {
                "id": new_id(),
                "client_id": client_id,
                "contact_id": contact["id"],
                "supplier_code": contact.get("account_code") or "",
                "trading_name": contact.get("name"),
                "payment_terms_days": int(ap_settings.get("default_payment_terms_days") or 30),
                "default_currency": str(payload.get("currency") or "GBP")[:8],
                "default_purchase_account": ap_settings.get("default_purchase_account") or "5000",
                "default_vat_code": ap_settings.get("default_vat_code") or "",
                "status": "active",
                "created_at": now,
                "updated_at": now,
            }
            await session.execute(insert(accounting_ap_supplier_profiles).values(**profile))
        supplier = serialize_ap_supplier(profile, contact)
    invoice_number = str(payload.get("invoice_number") or payload.get("bill_number") or payload.get("number") or "").strip()
    if not invoice_number:
        if bool(ap_settings.get("automatic_invoice_numbering")):
            invoice_number = f"PINV-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        else:
            raise HTTPException(status_code=400, detail="Invoice number is required.")
    duplicate = await one(
        session,
        select(accounting_ap_invoices).where(
            accounting_ap_invoices.c.client_id == client_id,
            accounting_ap_invoices.c.supplier_id == supplier["id"],
            func.lower(accounting_ap_invoices.c.invoice_number) == invoice_number.lower(),
            accounting_ap_invoices.c.status != "void",
        ),
    )
    if duplicate and bool(ap_settings.get("duplicate_invoice_warning", True)):
        raise HTTPException(status_code=409, detail=f"Possible duplicate: supplier already has invoice {invoice_number}.")
    invoice_date = parse_date_or_today(payload.get("invoice_date") or payload.get("date")).isoformat()
    due_date_raw = payload.get("due_date")
    if due_date_raw:
        due_date = parse_date_or_today(due_date_raw).isoformat()
    else:
        due_date = (date.fromisoformat(invoice_date) + timedelta(days=int(supplier.get("payment_terms_days") or ap_settings.get("default_payment_terms_days") or 30))).isoformat()
    lines = [ap_line_values(line, supplier.get("default_purchase_account") or settings_row.get("default_purchase_account") or "5000") for line in (payload.get("lines") or [])]
    if not lines:
        lines = [
            ap_line_values(
                {
                    "description": payload.get("description") or invoice_number,
                    "net_amount": payload.get("net_amount") or payload.get("net"),
                    "vat_amount": payload.get("vat_amount") or payload.get("vat"),
                    "gross_amount": payload.get("gross_amount") or payload.get("total"),
                    "vat_code": payload.get("vat_code") or supplier.get("default_vat_code") or ap_settings.get("default_vat_code"),
                },
                supplier.get("default_purchase_account") or settings_row.get("default_purchase_account") or "5000",
            )
        ]
    totals = ap_totals(lines)
    now = utc_now_iso()
    status = "awaiting_approval" if bool(ap_settings.get("approval_required", True)) else "approved"
    row = {
        "id": new_id(),
        "client_id": client_id,
        "supplier_id": supplier["id"],
        "contact_id": supplier.get("contact_id"),
        "invoice_number": invoice_number,
        "reference": str(payload.get("reference") or "").strip(),
        "invoice_date": invoice_date,
        "due_date": due_date,
        "currency": str(payload.get("currency") or supplier.get("default_currency") or "GBP")[:8],
        "status": status,
        "outstanding_amount": totals["gross_amount"],
        "source_submission_id": str(payload.get("source_submission_id") or "").strip(),
        "attachment_path": str(payload.get("attachment_path") or "").strip(),
        "extracted_json": json.dumps(payload.get("extracted_json") or {}, default=str),
        "created_at": now,
        "updated_at": now,
        **totals,
    }
    await session.execute(insert(accounting_ap_invoices).values(**row))
    for index, line in enumerate(lines, start=1):
        await session.execute(insert(accounting_ap_invoice_lines).values(id=new_id(), client_id=client_id, invoice_id=row["id"], line_number=index, created_at=now, updated_at=now, **line))
    await add_accounting_audit(session, client_id, actor_id, "purchase_invoice_created", "accounts_payable", row["id"], {"invoice_number": invoice_number, "status": status})
    fresh = await accounts_payable_workspace(session, client_id)
    return next((item for item in fresh["invoices"] if item["id"] == row["id"]), serialize_ap_invoice(row, lines, supplier))


async def get_ar_customer_or_404(session: AsyncSession, client_id: str, customer_id: str) -> dict:
    customer = await one(session, select(accounting_ar_customer_profiles).where(accounting_ar_customer_profiles.c.client_id == client_id, accounting_ar_customer_profiles.c.id == customer_id))
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found.")
    return customer


async def get_ar_invoice_or_404(session: AsyncSession, client_id: str, invoice_id: str) -> dict:
    invoice = await one(session, select(accounting_ar_invoices).where(accounting_ar_invoices.c.client_id == client_id, accounting_ar_invoices.c.id == invoice_id))
    if not invoice:
        raise HTTPException(status_code=404, detail="Sales invoice not found.")
    return invoice


async def create_ar_customer_profile(session: AsyncSession, client_id: str, payload: dict, actor_id: Optional[str]) -> dict:
    name = str(payload.get("business_name") or payload.get("name") or payload.get("trading_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Customer business name is required.")
    existing_contact = await one(
        session,
        select(accounting_contacts).where(
            accounting_contacts.c.client_id == client_id,
            accounting_contacts.c.contact_type == "customer",
            func.lower(accounting_contacts.c.name) == name.lower(),
        ),
    )
    now = utc_now_iso()
    contact = existing_contact or {
        "id": new_id(),
        "client_id": client_id,
        "contact_type": "customer",
        "name": name,
        "email": str(payload.get("email") or "").strip(),
        "external_id": str(payload.get("external_id") or "").strip(),
        "account_code": str(payload.get("customer_code") or "").strip(),
        "active": bool(payload.get("active", True)),
        "raw_json": json.dumps({"source": "native_ar"}),
        "created_at": now,
        "updated_at": now,
    }
    if not existing_contact:
        await session.execute(insert(accounting_contacts).values(**contact))
    else:
        contact_updates = {
            "email": str(payload.get("email") or existing_contact.get("email") or "").strip(),
            "account_code": str(payload.get("customer_code") or existing_contact.get("account_code") or "").strip(),
            "active": bool(payload.get("active", existing_contact.get("active", True))),
            "updated_at": now,
        }
        await session.execute(update(accounting_contacts).where(accounting_contacts.c.id == existing_contact["id"]).values(**contact_updates))
        contact = {**existing_contact, **contact_updates}
    existing_profile = await one(session, select(accounting_ar_customer_profiles).where(accounting_ar_customer_profiles.c.client_id == client_id, accounting_ar_customer_profiles.c.contact_id == contact["id"]))
    ar_settings = await ensure_ar_settings(session, client_id)
    values = {
        "customer_code": str(payload.get("customer_code") or contact.get("account_code") or "").strip(),
        "trading_name": str(payload.get("trading_name") or name).strip(),
        "phone": str(payload.get("phone") or "").strip(),
        "website": str(payload.get("website") or "").strip(),
        "vat_number": str(payload.get("vat_number") or "").strip(),
        "company_number": str(payload.get("company_number") or "").strip(),
        "payment_terms_days": int(payload.get("payment_terms_days") or ar_settings.get("default_payment_terms_days") or 30),
        "default_currency": str(payload.get("default_currency") or "GBP").strip().upper()[:8],
        "default_sales_account": str(payload.get("default_sales_account") or ar_settings.get("default_sales_account") or "4000"),
        "default_vat_code": str(payload.get("default_vat_code") or ar_settings.get("default_vat_code") or ""),
        "credit_limit": money_str(money(payload.get("credit_limit"))),
        "status": str(payload.get("status") or ("active" if bool(payload.get("active", True)) else "inactive")),
        "notes": str(payload.get("notes") or "").strip(),
        "updated_at": now,
    }
    if existing_profile:
        await session.execute(update(accounting_ar_customer_profiles).where(accounting_ar_customer_profiles.c.id == existing_profile["id"]).values(**values))
        profile = {**existing_profile, **values}
    else:
        profile = {"id": new_id(), "client_id": client_id, "contact_id": contact["id"], "created_at": now, **values}
        await session.execute(insert(accounting_ar_customer_profiles).values(**profile))
    await add_accounting_audit(session, client_id, actor_id, "customer_saved", "accounts_receivable", profile["id"], {"name": name})
    return serialize_ar_customer(profile, contact)


async def create_ar_invoice_record(session: AsyncSession, client_id: str, payload: dict, actor_id: Optional[str]) -> dict:
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding sales invoices.")
    ar_settings = await ensure_ar_settings(session, client_id)
    settings_row = await ensure_accounting_settings(session, client_id)
    customer_id = str(payload.get("customer_id") or "").strip()
    customer = await get_ar_customer_or_404(session, client_id, customer_id) if customer_id else None
    if not customer:
        customer = await create_ar_customer_profile(session, client_id, payload, actor_id)
    invoice_number = str(payload.get("invoice_number") or "").strip()
    next_number = int(ar_settings.get("next_invoice_number") or 1)
    if not invoice_number:
        prefix = str(ar_settings.get("invoice_number_prefix") or "SINV")
        invoice_number = f"{prefix}{next_number:05d}"
        await session.execute(update(accounting_ar_settings).where(accounting_ar_settings.c.client_id == client_id).values(next_invoice_number=next_number + 1, updated_at=utc_now_iso()))
    elif bool(ar_settings.get("duplicate_invoice_warning", True)):
        duplicate = await one(session, select(accounting_ar_invoices).where(accounting_ar_invoices.c.client_id == client_id, accounting_ar_invoices.c.customer_id == customer["id"], func.lower(accounting_ar_invoices.c.invoice_number) == invoice_number.lower()))
        if duplicate:
            raise HTTPException(status_code=400, detail="A sales invoice with this number already exists for this customer.")
    invoice_date = parse_date_or_today(payload.get("invoice_date") or payload.get("date")).isoformat()
    due_date = str(payload.get("due_date") or (date.fromisoformat(invoice_date) + timedelta(days=int(customer.get("payment_terms_days") or ar_settings.get("default_payment_terms_days") or 30))).isoformat())
    default_account = customer.get("default_sales_account") or ar_settings.get("default_sales_account") or settings_row.get("default_sales_account") or "4000"
    lines = [ar_line_values(line, default_account) for line in (payload.get("lines") or [])]
    if not lines:
        lines = [ar_line_values({"description": payload.get("description") or invoice_number, "net_amount": payload.get("net_amount"), "vat_amount": payload.get("vat_amount"), "gross_amount": payload.get("gross_amount"), "vat_code": payload.get("vat_code")}, default_account)]
    totals = ar_totals(lines)
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "customer_id": customer["id"],
        "contact_id": customer.get("contact_id"),
        "invoice_number": invoice_number,
        "reference": str(payload.get("reference") or "").strip(),
        "invoice_date": invoice_date,
        "due_date": due_date,
        "currency": str(payload.get("currency") or customer.get("default_currency") or "GBP").strip().upper()[:8],
        "status": "awaiting_approval" if bool(ar_settings.get("approval_required", True)) else "approved",
        "outstanding_amount": totals["gross_amount"],
        "source_submission_id": str(payload.get("source_submission_id") or "").strip(),
        "attachment_path": str(payload.get("attachment_path") or "").strip(),
        "extracted_json": json.dumps(payload.get("extracted_json") or payload.get("extracted") or {}, default=str),
        "created_at": now,
        "updated_at": now,
        **totals,
    }
    await session.execute(insert(accounting_ar_invoices).values(**row))
    for index, line in enumerate(lines, start=1):
        await session.execute(insert(accounting_ar_invoice_lines).values(id=new_id(), client_id=client_id, invoice_id=row["id"], line_number=index, created_at=now, updated_at=now, **line))
    await add_accounting_audit(session, client_id, actor_id, "sales_invoice_created", "accounts_receivable", row["id"], {"invoice_number": invoice_number, "status": row["status"]})
    fresh = await accounts_receivable_workspace(session, client_id)
    return next((item for item in fresh["invoices"] if item["id"] == row["id"]), serialize_ar_invoice(row, lines, customer))


@api.post("/admin/accounting/clients/{client_id}/ap/suppliers")
async def create_ap_supplier(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding suppliers.")
    name = str(payload.get("name") or payload.get("trading_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Supplier name is required.")
    existing_contact = await one(
        session,
        select(accounting_contacts).where(
            accounting_contacts.c.client_id == client_id,
            accounting_contacts.c.contact_type == "supplier",
            func.lower(accounting_contacts.c.name) == name.lower(),
        ),
    )
    now = utc_now_iso()
    contact = existing_contact or {
        "id": new_id(),
        "client_id": client_id,
        "contact_type": "supplier",
        "name": name,
        "email": str(payload.get("email") or "").strip(),
        "external_id": str(payload.get("external_id") or "").strip(),
        "account_code": str(payload.get("supplier_code") or "").strip(),
        "active": bool(payload.get("active", True)),
        "raw_json": json.dumps({"source": "native_ap"}),
        "created_at": now,
        "updated_at": now,
    }
    if not existing_contact:
        await session.execute(insert(accounting_contacts).values(**contact))
    else:
        await session.execute(
            update(accounting_contacts)
            .where(accounting_contacts.c.id == existing_contact["id"])
            .values(
                email=str(payload.get("email") or existing_contact.get("email") or "").strip(),
                account_code=str(payload.get("supplier_code") or existing_contact.get("account_code") or "").strip(),
                active=bool(payload.get("active", existing_contact.get("active", True))),
                updated_at=now,
            )
        )
        contact = {**existing_contact, "email": str(payload.get("email") or existing_contact.get("email") or "").strip(), "account_code": str(payload.get("supplier_code") or existing_contact.get("account_code") or "").strip()}
    ap_settings = await ensure_ap_settings(session, client_id)
    profile = {
        "id": new_id(),
        "client_id": client_id,
        "contact_id": contact["id"],
        "supplier_code": str(payload.get("supplier_code") or contact.get("account_code") or "").strip(),
        "trading_name": str(payload.get("trading_name") or name).strip(),
        "phone": str(payload.get("phone") or "").strip(),
        "website": str(payload.get("website") or "").strip(),
        "vat_number": str(payload.get("vat_number") or "").strip(),
        "company_number": str(payload.get("company_number") or "").strip(),
        "payment_terms_days": int(payload.get("payment_terms_days") or ap_settings.get("default_payment_terms_days") or 30),
        "default_currency": str(payload.get("default_currency") or "GBP").strip().upper()[:8],
        "default_purchase_account": str(payload.get("default_purchase_account") or ap_settings.get("default_purchase_account") or "5000"),
        "default_vat_code": str(payload.get("default_vat_code") or ap_settings.get("default_vat_code") or ""),
        "bank_name": str(payload.get("bank_name") or "").strip(),
        "bank_sort_code": str(payload.get("bank_sort_code") or "").strip(),
        "bank_account_number": str(payload.get("bank_account_number") or "").strip(),
        "cis_registered": bool(payload.get("cis_registered", False)),
        "reverse_charge": bool(payload.get("reverse_charge", False)),
        "status": "active" if bool(payload.get("active", True)) else "inactive",
        "notes": str(payload.get("notes") or "").strip(),
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_ap_supplier_profiles).values(**profile))
    await add_accounting_audit(session, client_id, user.get("id"), "supplier_created", "accounts_payable", profile["id"], {"name": name})
    await session.commit()
    return serialize_ap_supplier(profile, contact)


@api.put("/admin/accounting/clients/{client_id}/ap/suppliers/{supplier_id}")
async def update_ap_supplier(
    client_id: str,
    supplier_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await get_client_or_404(session, client_id)
    supplier = await get_ap_supplier_or_404(session, client_id, supplier_id)
    contact_values = {}
    if "name" in payload or "trading_name" in payload:
        contact_values["name"] = str(payload.get("name") or payload.get("trading_name") or "").strip()
    if "email" in payload:
        contact_values["email"] = str(payload.get("email") or "").strip()
    if "supplier_code" in payload:
        contact_values["account_code"] = str(payload.get("supplier_code") or "").strip()
    if "active" in payload:
        contact_values["active"] = bool(payload.get("active"))
    if contact_values:
        contact_values["updated_at"] = utc_now_iso()
        await session.execute(update(accounting_contacts).where(accounting_contacts.c.id == supplier["contact_id"]).values(**contact_values))
    values = {
        "supplier_code": str(payload.get("supplier_code", supplier.get("supplier_code") or "") or "").strip(),
        "trading_name": str(payload.get("trading_name", supplier.get("trading_name") or "") or "").strip(),
        "phone": str(payload.get("phone", supplier.get("phone") or "") or "").strip(),
        "website": str(payload.get("website", supplier.get("website") or "") or "").strip(),
        "vat_number": str(payload.get("vat_number", supplier.get("vat_number") or "") or "").strip(),
        "company_number": str(payload.get("company_number", supplier.get("company_number") or "") or "").strip(),
        "payment_terms_days": int(payload.get("payment_terms_days", supplier.get("payment_terms_days") or 30) or 30),
        "default_currency": str(payload.get("default_currency", supplier.get("default_currency") or "GBP") or "GBP").strip().upper()[:8],
        "default_purchase_account": str(payload.get("default_purchase_account", supplier.get("default_purchase_account") or "5000") or "5000"),
        "default_vat_code": str(payload.get("default_vat_code", supplier.get("default_vat_code") or "") or ""),
        "bank_name": str(payload.get("bank_name", supplier.get("bank_name") or "") or "").strip(),
        "bank_sort_code": str(payload.get("bank_sort_code", supplier.get("bank_sort_code") or "") or "").strip(),
        "bank_account_number": str(payload.get("bank_account_number", supplier.get("bank_account_number") or "") or "").strip(),
        "cis_registered": bool(payload.get("cis_registered", supplier.get("cis_registered", False))),
        "reverse_charge": bool(payload.get("reverse_charge", supplier.get("reverse_charge", False))),
        "status": str(payload.get("status") or ("active" if bool(payload.get("active", supplier.get("status") == "active")) else "inactive")),
        "notes": str(payload.get("notes", supplier.get("notes") or "") or "").strip(),
        "updated_at": utc_now_iso(),
    }
    await session.execute(update(accounting_ap_supplier_profiles).where(accounting_ap_supplier_profiles.c.id == supplier_id).values(**values))
    await add_accounting_audit(session, client_id, user.get("id"), "supplier_updated", "accounts_payable", supplier_id, {"previous": supplier, "new": values})
    await session.commit()
    return {"ok": True}


@api.post("/admin/accounting/clients/{client_id}/ap/invoices")
async def create_ap_invoice(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    invoice = await create_ap_invoice_record(session, client_id, payload, user.get("id"))
    await session.commit()
    return invoice


@api.post("/admin/accounting/clients/{client_id}/ap/invoices/{invoice_id}/approve")
async def approve_ap_invoice(
    client_id: str,
    invoice_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    invoice = await get_ap_invoice_or_404(session, client_id, invoice_id)
    if invoice.get("status") in {"posted", "paid", "part_paid"}:
        raise HTTPException(status_code=400, detail="Posted invoices are already approved.")
    await session.execute(update(accounting_ap_invoices).where(accounting_ap_invoices.c.id == invoice_id).values(status="approved", approved_by=user.get("id"), approved_at=utc_now_iso(), updated_at=utc_now_iso()))
    await add_accounting_audit(session, client_id, user.get("id"), "purchase_invoice_approved", "accounts_payable", invoice_id, {"previous_status": invoice.get("status")})
    await session.commit()
    return {"ok": True}


@api.post("/admin/accounting/clients/{client_id}/ap/invoices/{invoice_id}/post")
async def post_ap_invoice(
    client_id: str,
    invoice_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    invoice = await get_ap_invoice_or_404(session, client_id, invoice_id)
    if invoice.get("posted_journal_id"):
        raise HTTPException(status_code=400, detail="Purchase invoice is already posted.")
    ap_settings = await ensure_ap_settings(session, client_id)
    if bool(ap_settings.get("approval_required", True)) and invoice.get("status") != "approved":
        raise HTTPException(status_code=400, detail="Approve this purchase invoice before posting.")
    if invoice.get("status") not in {"approved", "draft"}:
        raise HTTPException(status_code=400, detail="Purchase invoice cannot be posted from this status.")
    accounts = await ensure_native_accounting_client(session, client_id)
    settings_row = await ensure_accounting_settings(session, client_id)
    supplier = await get_ap_supplier_or_404(session, client_id, str(invoice.get("supplier_id")))
    contact = await one(session, select(accounting_contacts).where(accounting_contacts.c.id == supplier.get("contact_id")))
    lines = await many(session, select(accounting_ap_invoice_lines).where(accounting_ap_invoice_lines.c.invoice_id == invoice_id).order_by(accounting_ap_invoice_lines.c.line_number.asc()))
    journal_lines = []
    for line in lines:
        amount = money(line.get("net_amount"))
        if amount:
            expense_account = find_native_account(accounts, line.get("nominal_account_code"), supplier.get("default_purchase_account") or settings_row.get("default_purchase_account") or "5000")
            journal_lines.append({"account": expense_account, "contact": contact, "debit": money_str(amount), "credit": "0.00", "vat_code": line.get("vat_code"), "description": line.get("description")})
    vat_amount = money(invoice.get("vat_amount"))
    if vat_amount:
        vat_account = find_native_account(accounts, settings_row.get("default_vat_control_account"), "2200")
        journal_lines.append({"account": vat_account, "contact": contact, "debit": money_str(vat_amount), "credit": "0.00", "description": f"VAT on {invoice.get('invoice_number')}"})
    creditors = find_native_account(accounts, settings_row.get("default_creditors_control_account"), "2000")
    gross = money(invoice.get("gross_amount"))
    journal_lines.append({"account": creditors, "contact": contact, "debit": "0.00", "credit": money_str(gross), "description": invoice.get("invoice_number")})
    journal = await post_native_journal(
        session,
        client_id=client_id,
        source_type="ap_invoice",
        source_id=invoice_id,
        entry_date=invoice.get("invoice_date"),
        reference=invoice.get("invoice_number") or invoice_id,
        description=f"Purchase invoice {invoice.get('invoice_number')}",
        lines=journal_lines,
        actor_id=user.get("id"),
    )
    now = utc_now_iso()
    await session.execute(
        update(accounting_ap_invoices)
        .where(accounting_ap_invoices.c.id == invoice_id)
        .values(status="posted", posted_journal_id=journal.get("id"), posted_by=user.get("id"), posted_at=now, approved_by=invoice.get("approved_by") or user.get("id"), approved_at=invoice.get("approved_at") or now, updated_at=now)
    )
    await add_accounting_audit(session, client_id, user.get("id"), "purchase_invoice_posted", "accounts_payable", invoice_id, {"journal_id": journal.get("id")})
    await session.commit()
    return {"ok": True, "journal": journal}


@api.post("/admin/accounting/clients/{client_id}/ap/invoices/{invoice_id}/void")
async def void_ap_invoice(
    client_id: str,
    invoice_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    invoice = await get_ap_invoice_or_404(session, client_id, invoice_id)
    if invoice.get("posted_journal_id") or invoice.get("status") in {"posted", "paid", "part_paid"}:
        raise HTTPException(status_code=400, detail="Posted purchase invoices cannot be voided. Post a credit note instead.")
    if invoice.get("status") == "void":
        return {"ok": True}
    now = utc_now_iso()
    await session.execute(update(accounting_ap_invoices).where(accounting_ap_invoices.c.id == invoice_id).values(status="void", outstanding_amount="0.00", updated_at=now))
    await add_accounting_audit(session, client_id, user.get("id"), "purchase_invoice_voided", "accounts_payable", invoice_id, {"previous_status": invoice.get("status")})
    await session.commit()
    return {"ok": True}


@api.post("/admin/accounting/clients/{client_id}/ap/credit-notes")
async def create_ap_credit_note(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding supplier credit notes.")
    settings_row = await ensure_accounting_settings(session, client_id)
    supplier = await get_ap_supplier_or_404(session, client_id, str(payload.get("supplier_id") or ""))
    number = str(payload.get("credit_note_number") or payload.get("number") or "").strip()
    if not number:
        raise HTTPException(status_code=400, detail="Credit note number is required.")
    credit_date = parse_date_or_today(payload.get("credit_note_date") or payload.get("date")).isoformat()
    lines = [ap_line_values(line, supplier.get("default_purchase_account") or settings_row.get("default_purchase_account") or "5000") for line in (payload.get("lines") or [])]
    if not lines:
        lines = [ap_line_values({"description": payload.get("description") or number, "net_amount": payload.get("net_amount"), "vat_amount": payload.get("vat_amount"), "gross_amount": payload.get("gross_amount")}, supplier.get("default_purchase_account") or "5000")]
    totals = ap_totals(lines)
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "supplier_id": supplier["id"],
        "contact_id": supplier.get("contact_id"),
        "credit_note_number": number,
        "reference": str(payload.get("reference") or "").strip(),
        "credit_note_date": credit_date,
        "currency": str(payload.get("currency") or "GBP").strip().upper()[:8],
        "status": "draft",
        **totals,
        "unallocated_amount": totals["gross_amount"],
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_ap_credit_notes).values(**row))
    for index, line in enumerate(lines, start=1):
        cleaned = dict(line)
        cleaned.pop("discount_amount", None)
        await session.execute(insert(accounting_ap_credit_note_lines).values(id=new_id(), client_id=client_id, credit_note_id=row["id"], line_number=index, created_at=now, updated_at=now, **cleaned))
    await add_accounting_audit(session, client_id, user.get("id"), "supplier_credit_note_created", "accounts_payable", row["id"], {"credit_note_number": number})
    await session.commit()
    return serialize_ap_credit_note(row, lines)


@api.post("/admin/accounting/clients/{client_id}/ap/credit-notes/{credit_note_id}/post")
async def post_ap_credit_note(
    client_id: str,
    credit_note_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    credit = await one(session, select(accounting_ap_credit_notes).where(accounting_ap_credit_notes.c.client_id == client_id, accounting_ap_credit_notes.c.id == credit_note_id))
    if not credit:
        raise HTTPException(status_code=404, detail="Supplier credit note not found.")
    if credit.get("posted_journal_id"):
        raise HTTPException(status_code=400, detail="Supplier credit note is already posted.")
    accounts = await ensure_native_accounting_client(session, client_id)
    settings_row = await ensure_accounting_settings(session, client_id)
    supplier = await get_ap_supplier_or_404(session, client_id, str(credit.get("supplier_id")))
    contact = await one(session, select(accounting_contacts).where(accounting_contacts.c.id == supplier.get("contact_id")))
    lines = await many(session, select(accounting_ap_credit_note_lines).where(accounting_ap_credit_note_lines.c.credit_note_id == credit_note_id).order_by(accounting_ap_credit_note_lines.c.line_number.asc()))
    creditors = find_native_account(accounts, settings_row.get("default_creditors_control_account"), "2000")
    journal_lines = [{"account": creditors, "contact": contact, "debit": money_str(money(credit.get("gross_amount"))), "credit": "0.00", "description": credit.get("credit_note_number")}]
    for line in lines:
        amount = money(line.get("net_amount"))
        if amount:
            expense_account = find_native_account(accounts, line.get("nominal_account_code"), supplier.get("default_purchase_account") or settings_row.get("default_purchase_account") or "5000")
            journal_lines.append({"account": expense_account, "contact": contact, "debit": "0.00", "credit": money_str(amount), "vat_code": line.get("vat_code"), "description": line.get("description")})
    vat_amount = money(credit.get("vat_amount"))
    if vat_amount:
        vat_account = find_native_account(accounts, settings_row.get("default_vat_control_account"), "2200")
        journal_lines.append({"account": vat_account, "contact": contact, "debit": "0.00", "credit": money_str(vat_amount), "description": f"VAT credit {credit.get('credit_note_number')}"})
    journal = await post_native_journal(
        session,
        client_id=client_id,
        source_type="ap_credit_note",
        source_id=credit_note_id,
        entry_date=credit.get("credit_note_date"),
        reference=credit.get("credit_note_number") or credit_note_id,
        description=f"Supplier credit note {credit.get('credit_note_number')}",
        lines=journal_lines,
        actor_id=user.get("id"),
    )
    now = utc_now_iso()
    await session.execute(update(accounting_ap_credit_notes).where(accounting_ap_credit_notes.c.id == credit_note_id).values(status="posted", posted_journal_id=journal.get("id"), posted_by=user.get("id"), posted_at=now, updated_at=now))
    await add_accounting_audit(session, client_id, user.get("id"), "supplier_credit_note_posted", "accounts_payable", credit_note_id, {"journal_id": journal.get("id")})
    await session.commit()
    return {"ok": True, "journal": journal}


@api.post("/admin/accounting/clients/{client_id}/ap/payments")
async def create_ap_payment(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding supplier payments.")
    supplier = await get_ap_supplier_or_404(session, client_id, str(payload.get("supplier_id") or ""))
    amount = money(payload.get("amount"))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")
    settings_row = await ensure_accounting_settings(session, client_id)
    accounts = await ensure_native_accounting_client(session, client_id)
    contact = await one(session, select(accounting_contacts).where(accounting_contacts.c.id == supplier.get("contact_id")))
    bank_account_code = str(payload.get("bank_account_code") or settings_row.get("default_bank_account") or "1200")
    bank = find_native_account(accounts, bank_account_code, "1200")
    creditors = find_native_account(accounts, settings_row.get("default_creditors_control_account"), "2000")
    payment_date = parse_date_or_today(payload.get("payment_date")).isoformat()
    reference = str(payload.get("reference") or f"Payment {payment_date}").strip()
    journal = await post_native_journal(
        session,
        client_id=client_id,
        source_type="ap_payment",
        source_id="pending",
        entry_date=payment_date,
        reference=reference,
        description=f"Supplier payment {supplier.get('trading_name') or contact.get('name')}",
        lines=[
            {"account": creditors, "contact": contact, "debit": money_str(amount), "credit": "0.00", "description": reference},
            {"account": bank, "contact": contact, "debit": "0.00", "credit": money_str(amount), "description": reference},
        ],
        actor_id=user.get("id"),
    )
    now = utc_now_iso()
    payment_id = new_id()
    row = {
        "id": payment_id,
        "client_id": client_id,
        "supplier_id": supplier["id"],
        "contact_id": supplier.get("contact_id"),
        "payment_date": payment_date,
        "bank_account_code": bank_account_code,
        "reference": reference,
        "amount": money_str(amount),
        "currency": str(payload.get("currency") or "GBP").strip().upper()[:8],
        "status": "posted",
        "posted_journal_id": journal.get("id"),
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_ap_payments).values(**row))
    remaining = amount
    invoice_ids = [str(item.get("invoice_id")) for item in (payload.get("allocations") or []) if item.get("invoice_id")]
    invoices = []
    if invoice_ids:
        invoices = await many(session, select(accounting_ap_invoices).where(accounting_ap_invoices.c.client_id == client_id, accounting_ap_invoices.c.id.in_(invoice_ids)))
    else:
        invoices = await many(
            session,
            select(accounting_ap_invoices)
            .where(accounting_ap_invoices.c.client_id == client_id, accounting_ap_invoices.c.supplier_id == supplier["id"], accounting_ap_invoices.c.outstanding_amount != "0.00")
            .order_by(accounting_ap_invoices.c.due_date.asc(), accounting_ap_invoices.c.invoice_date.asc()),
        )
    allocation_by_invoice = {str(item.get("invoice_id")): money(item.get("amount")) for item in (payload.get("allocations") or []) if item.get("invoice_id")}
    for invoice in invoices:
        if remaining <= 0:
            break
        outstanding = money(invoice.get("outstanding_amount"))
        if outstanding <= 0:
            continue
        desired = allocation_by_invoice.get(str(invoice["id"]), outstanding)
        allocate = min(remaining, outstanding, desired if desired > 0 else outstanding)
        if allocate <= 0:
            continue
        await session.execute(insert(accounting_ap_payment_allocations).values(id=new_id(), client_id=client_id, payment_id=payment_id, invoice_id=invoice["id"], amount=money_str(allocate), created_at=now))
        new_outstanding = outstanding - allocate
        new_status = "paid" if new_outstanding == 0 else "part_paid"
        await session.execute(update(accounting_ap_invoices).where(accounting_ap_invoices.c.id == invoice["id"]).values(outstanding_amount=money_str(new_outstanding), status=new_status, updated_at=now))
        remaining -= allocate
    await session.execute(update(accounting_journal_entries).where(accounting_journal_entries.c.id == journal.get("id")).values(source_id=payment_id))
    await add_accounting_audit(session, client_id, user.get("id"), "supplier_payment_posted", "accounts_payable", payment_id, {"journal_id": journal.get("id"), "amount": money_str(amount)})
    await session.commit()
    return serialize_ap_payment(row)


@api.put("/admin/accounting/clients/{client_id}/ap/settings")
async def update_ap_settings(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await get_client_or_404(session, client_id)
    existing = await ensure_ap_settings(session, client_id)
    values = {
        "approval_required": bool(payload.get("approval_required", existing.get("approval_required", True))),
        "default_payment_terms_days": int(payload.get("default_payment_terms_days", existing.get("default_payment_terms_days") or 30) or 30),
        "default_purchase_account": str(payload.get("default_purchase_account", existing.get("default_purchase_account") or "5000") or "5000"),
        "default_vat_code": str(payload.get("default_vat_code", existing.get("default_vat_code") or "") or ""),
        "duplicate_invoice_warning": bool(payload.get("duplicate_invoice_warning", existing.get("duplicate_invoice_warning", True))),
        "allow_future_posting_dates": bool(payload.get("allow_future_posting_dates", existing.get("allow_future_posting_dates", False))),
        "automatic_invoice_numbering": bool(payload.get("automatic_invoice_numbering", existing.get("automatic_invoice_numbering", False))),
        "updated_at": utc_now_iso(),
    }
    await session.execute(update(accounting_ap_settings).where(accounting_ap_settings.c.client_id == client_id).values(**values))
    await add_accounting_audit(session, client_id, user.get("id"), "ap_settings_updated", "accounts_payable", existing["id"], values)
    await session.commit()
    updated = await ensure_ap_settings(session, client_id)
    return serialize_ap_settings(updated)


@api.post("/admin/accounting/clients/{client_id}/ar/customers")
async def create_ar_customer(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding customers.")
    customer = await create_ar_customer_profile(session, client_id, payload, user.get("id"))
    await session.commit()
    return customer


@api.put("/admin/accounting/clients/{client_id}/ar/customers/{customer_id}")
async def update_ar_customer(
    client_id: str,
    customer_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    customer = await get_ar_customer_or_404(session, client_id, customer_id)
    contact_values = {}
    if "business_name" in payload or "name" in payload or "trading_name" in payload:
        contact_values["name"] = str(payload.get("business_name") or payload.get("name") or payload.get("trading_name") or "").strip()
    if "email" in payload:
        contact_values["email"] = str(payload.get("email") or "").strip()
    if "customer_code" in payload:
        contact_values["account_code"] = str(payload.get("customer_code") or "").strip()
    if "active" in payload:
        contact_values["active"] = bool(payload.get("active"))
    if contact_values:
        contact_values["updated_at"] = utc_now_iso()
        await session.execute(update(accounting_contacts).where(accounting_contacts.c.id == customer["contact_id"]).values(**contact_values))
    values = {
        "customer_code": str(payload.get("customer_code", customer.get("customer_code") or "") or "").strip(),
        "trading_name": str(payload.get("trading_name", customer.get("trading_name") or "") or "").strip(),
        "phone": str(payload.get("phone", customer.get("phone") or "") or "").strip(),
        "website": str(payload.get("website", customer.get("website") or "") or "").strip(),
        "vat_number": str(payload.get("vat_number", customer.get("vat_number") or "") or "").strip(),
        "company_number": str(payload.get("company_number", customer.get("company_number") or "") or "").strip(),
        "payment_terms_days": int(payload.get("payment_terms_days", customer.get("payment_terms_days") or 30) or 30),
        "default_currency": str(payload.get("default_currency", customer.get("default_currency") or "GBP") or "GBP").strip().upper()[:8],
        "default_sales_account": str(payload.get("default_sales_account", customer.get("default_sales_account") or "4000") or "4000"),
        "default_vat_code": str(payload.get("default_vat_code", customer.get("default_vat_code") or "") or ""),
        "credit_limit": money_str(money(payload.get("credit_limit", customer.get("credit_limit") or "0.00"))),
        "status": str(payload.get("status") or ("active" if bool(payload.get("active", customer.get("status") == "active")) else "inactive")),
        "notes": str(payload.get("notes", customer.get("notes") or "") or "").strip(),
        "updated_at": utc_now_iso(),
    }
    await session.execute(update(accounting_ar_customer_profiles).where(accounting_ar_customer_profiles.c.id == customer_id).values(**values))
    await add_accounting_audit(session, client_id, user.get("id"), "customer_updated", "accounts_receivable", customer_id, {"previous": customer, "new": values})
    await session.commit()
    return {"ok": True}


@api.post("/admin/accounting/clients/{client_id}/ar/invoices")
async def create_ar_invoice(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    invoice = await create_ar_invoice_record(session, client_id, payload, user.get("id"))
    await session.commit()
    return invoice


@api.post("/admin/accounting/clients/{client_id}/ar/invoices/{invoice_id}/approve")
async def approve_ar_invoice(
    client_id: str,
    invoice_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    invoice = await get_ar_invoice_or_404(session, client_id, invoice_id)
    if invoice.get("status") in {"posted", "paid", "part_paid", "archived"}:
        raise HTTPException(status_code=400, detail="Posted invoices are already approved.")
    now = utc_now_iso()
    await session.execute(update(accounting_ar_invoices).where(accounting_ar_invoices.c.id == invoice_id).values(status="approved", approved_by=user.get("id"), approved_at=now, updated_at=now))
    await add_accounting_audit(session, client_id, user.get("id"), "sales_invoice_approved", "accounts_receivable", invoice_id, {"previous_status": invoice.get("status")})
    await session.commit()
    return {"ok": True}


@api.post("/admin/accounting/clients/{client_id}/ar/invoices/{invoice_id}/post")
async def post_ar_invoice(
    client_id: str,
    invoice_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    invoice = await get_ar_invoice_or_404(session, client_id, invoice_id)
    if invoice.get("posted_journal_id"):
        raise HTTPException(status_code=400, detail="Sales invoice is already posted.")
    ar_settings = await ensure_ar_settings(session, client_id)
    if bool(ar_settings.get("approval_required", True)) and invoice.get("status") != "approved":
        raise HTTPException(status_code=400, detail="Approve this sales invoice before posting.")
    if invoice.get("status") not in {"approved", "draft"}:
        raise HTTPException(status_code=400, detail="Sales invoice cannot be posted from this status.")
    accounts = await ensure_native_accounting_client(session, client_id)
    settings_row = await ensure_accounting_settings(session, client_id)
    customer = await get_ar_customer_or_404(session, client_id, str(invoice.get("customer_id")))
    contact = await one(session, select(accounting_contacts).where(accounting_contacts.c.id == customer.get("contact_id")))
    lines = await many(session, select(accounting_ar_invoice_lines).where(accounting_ar_invoice_lines.c.invoice_id == invoice_id).order_by(accounting_ar_invoice_lines.c.line_number.asc()))
    debtors = find_native_account(accounts, settings_row.get("default_debtors_control_account"), "1100")
    journal_lines = [{"account": debtors, "contact": contact, "debit": money_str(money(invoice.get("gross_amount"))), "credit": "0.00", "description": invoice.get("invoice_number")}]
    for line in lines:
        amount = money(line.get("net_amount"))
        if amount:
            sales_account = find_native_account(accounts, line.get("nominal_account_code"), customer.get("default_sales_account") or ar_settings.get("default_sales_account") or settings_row.get("default_sales_account") or "4000")
            journal_lines.append({"account": sales_account, "contact": contact, "debit": "0.00", "credit": money_str(amount), "vat_code": line.get("vat_code"), "description": line.get("description")})
    vat_amount = money(invoice.get("vat_amount"))
    if vat_amount:
        vat_account = find_native_account(accounts, settings_row.get("default_vat_control_account"), "2200")
        journal_lines.append({"account": vat_account, "contact": contact, "debit": "0.00", "credit": money_str(vat_amount), "description": f"VAT on {invoice.get('invoice_number')}"})
    journal = await post_native_journal(
        session,
        client_id=client_id,
        source_type="ar_invoice",
        source_id=invoice_id,
        entry_date=invoice.get("invoice_date"),
        reference=invoice.get("invoice_number") or invoice_id,
        description=f"Sales invoice {invoice.get('invoice_number')}",
        lines=journal_lines,
        actor_id=user.get("id"),
    )
    now = utc_now_iso()
    await session.execute(
        update(accounting_ar_invoices)
        .where(accounting_ar_invoices.c.id == invoice_id)
        .values(status="posted", posted_journal_id=journal.get("id"), posted_by=user.get("id"), posted_at=now, approved_by=invoice.get("approved_by") or user.get("id"), approved_at=invoice.get("approved_at") or now, updated_at=now)
    )
    await add_accounting_audit(session, client_id, user.get("id"), "sales_invoice_posted", "accounts_receivable", invoice_id, {"journal_id": journal.get("id")})
    await session.commit()
    return {"ok": True, "journal": journal}


@api.post("/admin/accounting/clients/{client_id}/ar/invoices/{invoice_id}/archive")
async def archive_ar_invoice(
    client_id: str,
    invoice_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    invoice = await get_ar_invoice_or_404(session, client_id, invoice_id)
    if not invoice.get("posted_journal_id") and invoice.get("status") not in {"paid", "part_paid", "posted"}:
        raise HTTPException(status_code=400, detail="Only posted sales invoices can be archived.")
    now = utc_now_iso()
    await session.execute(update(accounting_ar_invoices).where(accounting_ar_invoices.c.id == invoice_id).values(status="archived", archived_at=now, updated_at=now))
    await add_accounting_audit(session, client_id, user.get("id"), "sales_invoice_archived", "accounts_receivable", invoice_id, {"previous_status": invoice.get("status")})
    await session.commit()
    return {"ok": True}


@api.post("/admin/accounting/clients/{client_id}/ar/credit-notes")
async def create_ar_credit_note(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding customer credit notes.")
    ar_settings = await ensure_ar_settings(session, client_id)
    customer = await get_ar_customer_or_404(session, client_id, str(payload.get("customer_id") or ""))
    number = str(payload.get("credit_note_number") or payload.get("number") or "").strip()
    if not number:
        raise HTTPException(status_code=400, detail="Credit note number is required.")
    credit_date = parse_date_or_today(payload.get("credit_note_date") or payload.get("date")).isoformat()
    lines = [ar_line_values(line, customer.get("default_sales_account") or ar_settings.get("default_sales_account") or "4000") for line in (payload.get("lines") or [])]
    if not lines:
        lines = [ar_line_values({"description": payload.get("description") or number, "net_amount": payload.get("net_amount"), "vat_amount": payload.get("vat_amount"), "gross_amount": payload.get("gross_amount")}, customer.get("default_sales_account") or "4000")]
    totals = ar_totals(lines)
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "customer_id": customer["id"],
        "contact_id": customer.get("contact_id"),
        "credit_note_number": number,
        "reference": str(payload.get("reference") or "").strip(),
        "credit_note_date": credit_date,
        "currency": str(payload.get("currency") or "GBP").strip().upper()[:8],
        "status": "draft",
        "unallocated_amount": totals["gross_amount"],
        "created_at": now,
        "updated_at": now,
        **totals,
    }
    await session.execute(insert(accounting_ar_credit_notes).values(**row))
    for index, line in enumerate(lines, start=1):
        cleaned = dict(line)
        cleaned.pop("discount_amount", None)
        await session.execute(insert(accounting_ar_credit_note_lines).values(id=new_id(), client_id=client_id, credit_note_id=row["id"], line_number=index, created_at=now, updated_at=now, **cleaned))
    await add_accounting_audit(session, client_id, user.get("id"), "customer_credit_note_created", "accounts_receivable", row["id"], {"credit_note_number": number})
    await session.commit()
    return serialize_ar_credit_note(row, lines)


@api.post("/admin/accounting/clients/{client_id}/ar/credit-notes/{credit_note_id}/post")
async def post_ar_credit_note(
    client_id: str,
    credit_note_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    credit = await one(session, select(accounting_ar_credit_notes).where(accounting_ar_credit_notes.c.client_id == client_id, accounting_ar_credit_notes.c.id == credit_note_id))
    if not credit:
        raise HTTPException(status_code=404, detail="Customer credit note not found.")
    if credit.get("posted_journal_id"):
        raise HTTPException(status_code=400, detail="Customer credit note is already posted.")
    accounts = await ensure_native_accounting_client(session, client_id)
    settings_row = await ensure_accounting_settings(session, client_id)
    ar_settings = await ensure_ar_settings(session, client_id)
    customer = await get_ar_customer_or_404(session, client_id, str(credit.get("customer_id")))
    contact = await one(session, select(accounting_contacts).where(accounting_contacts.c.id == customer.get("contact_id")))
    lines = await many(session, select(accounting_ar_credit_note_lines).where(accounting_ar_credit_note_lines.c.credit_note_id == credit_note_id).order_by(accounting_ar_credit_note_lines.c.line_number.asc()))
    journal_lines = []
    for line in lines:
        amount = money(line.get("net_amount"))
        if amount:
            sales_account = find_native_account(accounts, line.get("nominal_account_code"), customer.get("default_sales_account") or ar_settings.get("default_sales_account") or "4000")
            journal_lines.append({"account": sales_account, "contact": contact, "debit": money_str(amount), "credit": "0.00", "vat_code": line.get("vat_code"), "description": line.get("description")})
    vat_amount = money(credit.get("vat_amount"))
    if vat_amount:
        vat_account = find_native_account(accounts, settings_row.get("default_vat_control_account"), "2200")
        journal_lines.append({"account": vat_account, "contact": contact, "debit": money_str(vat_amount), "credit": "0.00", "description": f"VAT credit {credit.get('credit_note_number')}"})
    debtors = find_native_account(accounts, settings_row.get("default_debtors_control_account"), "1100")
    journal_lines.append({"account": debtors, "contact": contact, "debit": "0.00", "credit": money_str(money(credit.get("gross_amount"))), "description": credit.get("credit_note_number")})
    journal = await post_native_journal(session, client_id, "ar_credit_note", credit_note_id, credit.get("credit_note_date"), credit.get("credit_note_number") or credit_note_id, f"Customer credit note {credit.get('credit_note_number')}", journal_lines, user.get("id"))
    now = utc_now_iso()
    await session.execute(update(accounting_ar_credit_notes).where(accounting_ar_credit_notes.c.id == credit_note_id).values(status="posted", posted_journal_id=journal.get("id"), posted_by=user.get("id"), posted_at=now, updated_at=now))
    await add_accounting_audit(session, client_id, user.get("id"), "customer_credit_note_posted", "accounts_receivable", credit_note_id, {"journal_id": journal.get("id")})
    await session.commit()
    return {"ok": True, "journal": journal}


@api.post("/admin/accounting/clients/{client_id}/ar/receipts")
async def create_ar_receipt(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding customer receipts.")
    customer = await get_ar_customer_or_404(session, client_id, str(payload.get("customer_id") or ""))
    amount = money(payload.get("amount"))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Receipt amount must be greater than zero.")
    settings_row = await ensure_accounting_settings(session, client_id)
    accounts = await ensure_native_accounting_client(session, client_id)
    contact = await one(session, select(accounting_contacts).where(accounting_contacts.c.id == customer.get("contact_id")))
    bank_account_code = str(payload.get("bank_account_code") or settings_row.get("default_bank_account") or "1200")
    bank = find_native_account(accounts, bank_account_code, "1200")
    debtors = find_native_account(accounts, settings_row.get("default_debtors_control_account"), "1100")
    receipt_date = parse_date_or_today(payload.get("receipt_date")).isoformat()
    reference = str(payload.get("reference") or f"Receipt {receipt_date}").strip()
    journal = await post_native_journal(
        session,
        client_id=client_id,
        source_type="ar_receipt",
        source_id="pending",
        entry_date=receipt_date,
        reference=reference,
        description=f"Customer receipt {customer.get('trading_name') or contact.get('name')}",
        lines=[
            {"account": bank, "contact": contact, "debit": money_str(amount), "credit": "0.00", "description": reference},
            {"account": debtors, "contact": contact, "debit": "0.00", "credit": money_str(amount), "description": reference},
        ],
        actor_id=user.get("id"),
    )
    now = utc_now_iso()
    receipt_id = new_id()
    bank_transaction_id = new_id()
    row = {
        "id": receipt_id,
        "client_id": client_id,
        "customer_id": customer["id"],
        "contact_id": customer.get("contact_id"),
        "receipt_date": receipt_date,
        "bank_account_code": bank_account_code,
        "payment_method": str(payload.get("payment_method") or "Bank Transfer"),
        "reference": reference,
        "amount": money_str(amount),
        "currency": str(payload.get("currency") or "GBP").strip().upper()[:8],
        "status": "posted",
        "posted_journal_id": journal.get("id"),
        "bank_transaction_id": bank_transaction_id,
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_ar_receipts).values(**row))
    await session.execute(insert(accounting_bank_transactions).values(id=bank_transaction_id, client_id=client_id, bank_account_code=bank_account_code, transaction_date=receipt_date, description=f"Customer receipt {contact.get('name')}", reference=reference, transaction_type="customer_receipt", source_type="ar_receipt", money_in=money_str(amount), money_out="0.00", balance="0.00", status="reconciled", matched_to=f"Customer receipt: {contact.get('name')}", matched_contact_id=customer.get("contact_id"), matched_account_code=bank_account_code, journal_entry_id=journal.get("id"), reconciled_at=now, created_at=now, updated_at=now))
    remaining = amount
    invoice_ids = [str(item.get("invoice_id")) for item in (payload.get("allocations") or []) if item.get("invoice_id")]
    if invoice_ids:
        invoices = await many(session, select(accounting_ar_invoices).where(accounting_ar_invoices.c.client_id == client_id, accounting_ar_invoices.c.id.in_(invoice_ids)))
    else:
        invoices = await many(
            session,
            select(accounting_ar_invoices)
            .where(accounting_ar_invoices.c.client_id == client_id, accounting_ar_invoices.c.customer_id == customer["id"], accounting_ar_invoices.c.outstanding_amount != "0.00")
            .order_by(accounting_ar_invoices.c.due_date.asc(), accounting_ar_invoices.c.invoice_date.asc()),
        )
    allocation_by_invoice = {str(item.get("invoice_id")): money(item.get("amount")) for item in (payload.get("allocations") or []) if item.get("invoice_id")}
    for invoice in invoices:
        if remaining <= 0:
            break
        outstanding = money(invoice.get("outstanding_amount"))
        if outstanding <= 0:
            continue
        desired = allocation_by_invoice.get(str(invoice["id"]), outstanding)
        allocate = min(remaining, outstanding, desired if desired > 0 else outstanding)
        if allocate <= 0:
            continue
        await session.execute(insert(accounting_ar_receipt_allocations).values(id=new_id(), client_id=client_id, receipt_id=receipt_id, invoice_id=invoice["id"], amount=money_str(allocate), created_at=now))
        new_outstanding = outstanding - allocate
        new_status = "paid" if new_outstanding == 0 else "part_paid"
        await session.execute(update(accounting_ar_invoices).where(accounting_ar_invoices.c.id == invoice["id"]).values(outstanding_amount=money_str(new_outstanding), status=new_status, updated_at=now))
        remaining -= allocate
    await session.execute(update(accounting_journal_entries).where(accounting_journal_entries.c.id == journal.get("id")).values(source_id=receipt_id))
    await add_accounting_audit(session, client_id, user.get("id"), "customer_receipt_posted", "accounts_receivable", receipt_id, {"journal_id": journal.get("id"), "amount": money_str(amount)})
    await session.commit()
    return serialize_ar_receipt(row)


@api.put("/admin/accounting/clients/{client_id}/ar/settings")
async def update_ar_settings(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await get_client_or_404(session, client_id)
    existing = await ensure_ar_settings(session, client_id)
    values = {
        "approval_required": bool(payload.get("approval_required", existing.get("approval_required", True))),
        "default_payment_terms_days": int(payload.get("default_payment_terms_days", existing.get("default_payment_terms_days") or 30) or 30),
        "default_sales_account": str(payload.get("default_sales_account", existing.get("default_sales_account") or "4000") or "4000"),
        "default_vat_code": str(payload.get("default_vat_code", existing.get("default_vat_code") or "") or ""),
        "invoice_number_prefix": str(payload.get("invoice_number_prefix", existing.get("invoice_number_prefix") or "SINV") or "SINV")[:32],
        "next_invoice_number": int(payload.get("next_invoice_number", existing.get("next_invoice_number") or 1) or 1),
        "duplicate_invoice_warning": bool(payload.get("duplicate_invoice_warning", existing.get("duplicate_invoice_warning", True))),
        "credit_limit_warnings": bool(payload.get("credit_limit_warnings", existing.get("credit_limit_warnings", True))),
        "automatic_customer_numbering": bool(payload.get("automatic_customer_numbering", existing.get("automatic_customer_numbering", True))),
        "updated_at": utc_now_iso(),
    }
    await session.execute(update(accounting_ar_settings).where(accounting_ar_settings.c.client_id == client_id).values(**values))
    await add_accounting_audit(session, client_id, user.get("id"), "ar_settings_updated", "accounts_receivable", existing["id"], values)
    await session.commit()
    updated = await ensure_ar_settings(session, client_id)
    return serialize_ar_settings(updated)


@api.post("/admin/accounting/clients/{client_id}/bank/accounts")
async def create_bank_account(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding bank accounts.")
    accounts = await ensure_native_accounting_client(session, client_id)
    nominal_code = str(payload.get("nominal_account_code") or "").strip()
    if not nominal_code:
        next_code = 1200 + len([a for a in accounts if a.get("purpose") == "Bank Account" or str(a.get("account_type") or "").lower() == "bank"]) * 10
        nominal_code = str(next_code)
    nominal = next((a for a in accounts if str(a.get("code")) == nominal_code), None)
    now = utc_now_iso()
    if not nominal:
        account_name = str(payload.get("account_name") or "Bank account").strip()
        nominal = {
            "id": new_id(),
            "client_id": client_id,
            "code": nominal_code,
            "name": account_name,
            "category": "Asset",
            "account_type": "Bank",
            "purpose": "Bank Account",
            "normal_balance": "debit",
            "control_account": False,
            "is_control_account": False,
            "active": True,
            "created_at": now,
            "updated_at": now,
        }
        await session.execute(insert(accounting_accounts).values(**nominal))
    default_account = bool(payload.get("default_account"))
    if default_account:
        await session.execute(update(accounting_bank_accounts).where(accounting_bank_accounts.c.client_id == client_id).values(default_account=False, updated_at=now))
    row = {
        "id": new_id(),
        "client_id": client_id,
        "account_name": str(payload.get("account_name") or nominal.get("name") or "Bank account").strip(),
        "bank_name": str(payload.get("bank_name") or "").strip(),
        "account_number": str(payload.get("account_number") or "").strip(),
        "sort_code": str(payload.get("sort_code") or "").strip(),
        "currency": str(payload.get("currency") or "GBP").strip().upper()[:8],
        "nominal_account_code": nominal_code,
        "opening_balance": money_str(money(payload.get("opening_balance"))),
        "default_account": default_account,
        "allow_payments": bool(payload.get("allow_payments", True)),
        "allow_receipts": bool(payload.get("allow_receipts", True)),
        "active": bool(payload.get("active", True)),
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_bank_accounts).values(**row))
    opening = money(row["opening_balance"])
    if opening:
        suspense = find_native_account(accounts + [nominal], None, (await ensure_accounting_settings(session, client_id)).get("default_suspense_account") or "9999")
        if opening > 0:
            lines = [{"account": nominal, "debit": money_str(opening), "credit": "0.00", "description": "Opening bank balance"}, {"account": suspense, "debit": "0.00", "credit": money_str(opening), "description": "Opening bank balance"}]
        else:
            lines = [{"account": suspense, "debit": money_str(-opening), "credit": "0.00", "description": "Opening bank balance"}, {"account": nominal, "debit": "0.00", "credit": money_str(-opening), "description": "Opening bank balance"}]
        await post_native_journal(session, client_id, "bank_opening_balance", row["id"], datetime.now(timezone.utc).date().isoformat(), f"OPEN-{nominal_code}", "Opening bank balance", lines, user.get("id"))
    await add_accounting_audit(session, client_id, user.get("id"), "bank_account_created", "banking", row["id"], row)
    await session.commit()
    return serialize_bank_account(row)


@api.put("/admin/accounting/clients/{client_id}/bank/settings")
async def update_bank_settings(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await get_client_or_404(session, client_id)
    existing = await ensure_bank_settings(session, client_id)
    values = {
        "default_bank_account_id": str(payload.get("default_bank_account_id") or existing.get("default_bank_account_id") or ""),
        "default_transfer_account": str(payload.get("default_transfer_account") or existing.get("default_transfer_account") or "1200"),
        "default_bank_charges_account": str(payload.get("default_bank_charges_account") or existing.get("default_bank_charges_account") or "7000"),
        "default_interest_account": str(payload.get("default_interest_account") or existing.get("default_interest_account") or "4000"),
        "default_suspense_account": str(payload.get("default_suspense_account") or existing.get("default_suspense_account") or "9999"),
        "statement_number_prefix": str(payload.get("statement_number_prefix") or existing.get("statement_number_prefix") or "STMT")[:32],
        "automatic_matching_threshold": int(payload.get("automatic_matching_threshold") or existing.get("automatic_matching_threshold") or 85),
        "duplicate_detection": bool(payload.get("duplicate_detection", existing.get("duplicate_detection", True))),
        "updated_at": utc_now_iso(),
    }
    await session.execute(update(accounting_bank_settings).where(accounting_bank_settings.c.client_id == client_id).values(**values))
    await add_accounting_audit(session, client_id, user.get("id"), "bank_settings_updated", "banking", existing["id"], values)
    await session.commit()
    return {**existing, **values}


@api.post("/admin/accounting/clients/{client_id}/bank-transactions")
async def create_native_bank_transaction(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding bank transactions.")
    money_in = money(payload.get("money_in"))
    money_out = money(payload.get("money_out"))
    if money_in == Decimal("0.00") and money_out == Decimal("0.00"):
        raise HTTPException(status_code=400, detail="Enter money in or money out.")
    if money_in != Decimal("0.00") and money_out != Decimal("0.00"):
        raise HTTPException(status_code=400, detail="A bank transaction cannot have both money in and money out.")
    accounts = await ensure_native_accounting_client(session, client_id)
    bank_account = None
    bank_account_id = str(payload.get("bank_account_id") or "").strip()
    if bank_account_id:
        bank_account = await one(session, select(accounting_bank_accounts).where(accounting_bank_accounts.c.client_id == client_id, accounting_bank_accounts.c.id == bank_account_id))
    if not bank_account:
        bank_account = await ensure_default_bank_account(session, client_id, accounts)
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "bank_account_id": bank_account.get("id"),
        "bank_account_code": str(payload.get("bank_account_code") or bank_account.get("nominal_account_code") or "1200"),
        "transaction_date": str(payload.get("transaction_date") or datetime.now(timezone.utc).date().isoformat()),
        "description": str(payload.get("description") or "").strip(),
        "reference": str(payload.get("reference") or "").strip(),
        "transaction_type": str(payload.get("transaction_type") or "manual_entry"),
        "source_type": "manual",
        "money_in": money_str(money_in),
        "money_out": money_str(money_out),
        "balance": money_str(money(payload.get("balance"))),
        "status": "unreconciled",
        "raw_json": json.dumps(payload),
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_bank_transactions).values(**row))
    await add_accounting_audit(session, client_id, user.get("id"), "bank_transaction_created", "bank_transaction", row["id"], row)
    await session.commit()
    return serialize_bank_transaction(row)


@api.post("/admin/accounting/clients/{client_id}/bank-transactions/import")
async def import_native_bank_transactions(
    client_id: str,
    bank_account_code: str = Form("1200"),
    bank_account_id: str = Form(""),
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before importing bank transactions.")
    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Bank CSV is too large. Keep imports under 2MB.")
    try:
        raw = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raw = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV headers were not found.")

    accounts = await ensure_native_accounting_client(session, client_id)
    bank_account = None
    if bank_account_id:
        bank_account = await one(session, select(accounting_bank_accounts).where(accounting_bank_accounts.c.client_id == client_id, accounting_bank_accounts.c.id == bank_account_id))
    if not bank_account:
        bank_account = await ensure_default_bank_account(session, client_id, accounts)
    import_id = new_id()
    imported = 0
    duplicates = 0
    errors = []
    now = utc_now_iso()
    for index, row in enumerate(reader, start=2):
        if imported >= 1000:
            errors.append("Stopped after 1,000 rows. Split larger files before importing.")
            break
        transaction_date = normalize_csv_date(pick_csv_value(row, ["date", "transaction date", "posted date", "posting date", "value date"]))
        description = pick_csv_value(row, ["description", "details", "narrative", "transaction description", "payee"])
        reference = pick_csv_value(row, ["reference", "ref", "transaction id", "transaction reference"])
        money_in = parse_bank_csv_amount(pick_csv_value(row, ["money in", "paid in", "credit", "credits", "deposit"]))
        money_out = parse_bank_csv_amount(pick_csv_value(row, ["money out", "paid out", "debit", "debits", "withdrawal"]))
        amount = parse_bank_csv_amount(pick_csv_value(row, ["amount", "transaction amount", "value"]))
        if amount:
            if amount > 0:
                money_in = amount
                money_out = Decimal("0.00")
            else:
                money_in = Decimal("0.00")
                money_out = -amount
        if money_in == Decimal("0.00") and money_out == Decimal("0.00"):
            errors.append(f"Row {index}: no money in/out amount found")
            continue
        duplicate = await one(
            session,
            select(accounting_bank_transactions).where(
                accounting_bank_transactions.c.client_id == client_id,
                accounting_bank_transactions.c.bank_account_id == bank_account.get("id"),
                accounting_bank_transactions.c.transaction_date == transaction_date,
                accounting_bank_transactions.c.description == description,
                accounting_bank_transactions.c.money_in == money_str(money_in),
                accounting_bank_transactions.c.money_out == money_str(money_out),
            ),
        )
        if duplicate:
            duplicates += 1
            continue
        row_values = {
            "id": new_id(),
            "client_id": client_id,
            "bank_account_id": bank_account.get("id"),
            "bank_account_code": str(bank_account_code or bank_account.get("nominal_account_code") or "1200"),
            "transaction_date": transaction_date,
            "description": description,
            "reference": reference,
            "transaction_type": "statement_import",
            "source_type": "csv",
            "import_id": import_id,
            "money_in": money_str(money_in),
            "money_out": money_str(money_out),
            "balance": money_str(parse_bank_csv_amount(pick_csv_value(row, ["balance", "running balance"]))),
            "status": "unreconciled",
            "raw_json": json.dumps(row),
            "created_at": now,
            "updated_at": now,
        }
        await session.execute(insert(accounting_bank_transactions).values(**row_values))
        imported += 1
    await session.execute(
        insert(accounting_bank_imports).values(
            id=import_id,
            client_id=client_id,
            bank_account_id=bank_account.get("id"),
            provider="csv",
            source_type="csv",
            filename=file.filename,
            imported_by=user.get("id"),
            rows_imported=imported,
            duplicates=duplicates,
            errors=len(errors),
            status="imported" if not errors else "imported_with_errors",
            raw_summary=json.dumps({"errors": errors[:50], "headers": reader.fieldnames}),
            created_at=now,
            updated_at=now,
        )
    )
    await add_accounting_audit(
        session,
        client_id,
        user.get("id"),
        "bank_transactions_imported",
        "bank_transaction",
        client_id,
        {"file": file.filename, "imported": imported, "duplicates": duplicates, "errors": errors[:20]},
    )
    await session.commit()
    return {"imported": imported, "duplicates": duplicates, "errors": errors[:50], "import_id": import_id}


@api.post("/admin/accounting/clients/{client_id}/bank-transactions/{transaction_id}/reconcile")
async def reconcile_native_bank_transaction(
    client_id: str,
    transaction_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before reconciling bank transactions.")
    transaction = await one(
        session,
        select(accounting_bank_transactions).where(
            accounting_bank_transactions.c.client_id == client_id,
            accounting_bank_transactions.c.id == transaction_id,
        ),
    )
    if not transaction:
        raise HTTPException(status_code=404, detail="Bank transaction not found")
    if transaction.get("status") == "reconciled":
        raise HTTPException(status_code=400, detail="Bank transaction is already reconciled")
    accounts = await ensure_native_accounting_client(session, client_id)
    bank_account = find_native_account(accounts, None, transaction.get("bank_account_code") or "1200")
    matched_account = find_native_account(accounts, payload.get("account_name") or payload.get("account_code"), payload.get("account_code") or "5000")
    contact_name = str(payload.get("contact_name") or transaction.get("description") or "Bank contact").strip()
    contact_type = str(payload.get("contact_type") or ("customer" if money(transaction.get("money_in")) else "supplier"))
    contact = await get_or_create_native_contact(session, client_id, contact_name, contact_type)
    amount_in = money(transaction.get("money_in"))
    amount_out = money(transaction.get("money_out"))
    description = str(payload.get("description") or transaction.get("description") or "Bank reconciliation")
    if amount_in:
        lines = [
            {"account": bank_account, "contact": contact, "debit": money_str(amount_in), "credit": "0.00", "description": description},
            {"account": matched_account, "contact": contact, "debit": "0.00", "credit": money_str(amount_in), "description": description},
        ]
    else:
        lines = [
            {"account": matched_account, "contact": contact, "debit": money_str(amount_out), "credit": "0.00", "description": description},
            {"account": bank_account, "contact": contact, "debit": "0.00", "credit": money_str(amount_out), "description": description},
        ]
    journal = await post_native_journal(
        session,
        client_id=client_id,
        source_type="bank_transaction",
        source_id=transaction_id,
        entry_date=transaction.get("transaction_date"),
        reference=str(payload.get("reference") or transaction.get("reference") or transaction_id),
        description=description,
        lines=lines,
        actor_id=user.get("id"),
    )
    await session.execute(
        update(accounting_bank_transactions)
        .where(accounting_bank_transactions.c.id == transaction_id)
        .values(
            status="reconciled",
            matched_contact_id=contact.get("id"),
            matched_account_code=matched_account.get("code"),
            journal_entry_id=journal.get("id"),
            updated_at=utc_now_iso(),
        )
    )
    await add_accounting_audit(session, client_id, user.get("id"), "bank_transaction_reconciled", "bank_transaction", transaction_id, {"journal_id": journal.get("id")})
    await session.commit()
    return {"ok": True, "journal": journal}


@api.post("/admin/accounting/clients/{client_id}/bank-transactions/{transaction_id}/match")
async def match_native_bank_transaction(
    client_id: str,
    transaction_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    transaction = await one(session, select(accounting_bank_transactions).where(accounting_bank_transactions.c.client_id == client_id, accounting_bank_transactions.c.id == transaction_id))
    if not transaction:
        raise HTTPException(status_code=404, detail="Bank transaction not found")
    if transaction.get("status") == "reconciled":
        raise HTTPException(status_code=400, detail="Bank transaction is already reconciled")
    match_type = str(payload.get("match_type") or "").strip()
    amount = abs(bank_transaction_amount(transaction))
    accounts = await ensure_native_accounting_client(session, client_id)
    settings_row = await ensure_accounting_settings(session, client_id)
    bank = find_native_account(accounts, transaction.get("bank_account_code") or settings_row.get("default_bank_account"), "1200")
    now = utc_now_iso()
    journal = None
    matched_to = ""
    if match_type == "ap_invoice":
        invoice = await one(session, select(accounting_ap_invoices).where(accounting_ap_invoices.c.client_id == client_id, accounting_ap_invoices.c.id == str(payload.get("record_id") or "")))
        if not invoice:
            raise HTTPException(status_code=404, detail="Supplier invoice not found")
        supplier = await get_ap_supplier_or_404(session, client_id, str(invoice.get("supplier_id")))
        contact = await one(session, select(accounting_contacts).where(accounting_contacts.c.id == supplier.get("contact_id")))
        creditors = find_native_account(accounts, settings_row.get("default_creditors_control_account"), "2000")
        journal = await post_native_journal(
            session,
            client_id,
            "bank_supplier_payment",
            transaction_id,
            transaction.get("transaction_date") or datetime.now(timezone.utc).date().isoformat(),
            transaction.get("reference") or invoice.get("invoice_number") or transaction_id,
            f"Bank payment allocated to {invoice.get('invoice_number')}",
            [
                {"account": creditors, "contact": contact, "debit": money_str(amount), "credit": "0.00", "description": transaction.get("description")},
                {"account": bank, "contact": contact, "debit": "0.00", "credit": money_str(amount), "description": transaction.get("description")},
            ],
            user.get("id"),
        )
        payment_id = new_id()
        await session.execute(insert(accounting_ap_payments).values(id=payment_id, client_id=client_id, supplier_id=supplier["id"], contact_id=supplier.get("contact_id"), payment_date=transaction.get("transaction_date"), bank_account_code=bank.get("code"), reference=transaction.get("reference") or invoice.get("invoice_number"), amount=money_str(amount), currency="GBP", status="posted", posted_journal_id=journal.get("id"), created_at=now, updated_at=now))
        allocation = min(amount, money(invoice.get("outstanding_amount")))
        if allocation:
            await session.execute(insert(accounting_ap_payment_allocations).values(id=new_id(), client_id=client_id, payment_id=payment_id, invoice_id=invoice["id"], amount=money_str(allocation), created_at=now))
            new_outstanding = money(invoice.get("outstanding_amount")) - allocation
            await session.execute(update(accounting_ap_invoices).where(accounting_ap_invoices.c.id == invoice["id"]).values(outstanding_amount=money_str(new_outstanding), status="paid" if new_outstanding == 0 else "part_paid", updated_at=now))
        matched_to = f"Supplier payment: {invoice.get('invoice_number')}"
    elif match_type == "ar_invoice":
        invoice = await one(session, select(accounting_ar_invoices).where(accounting_ar_invoices.c.client_id == client_id, accounting_ar_invoices.c.id == str(payload.get("record_id") or "")))
        if not invoice:
            raise HTTPException(status_code=404, detail="Sales invoice not found")
        customer = await get_ar_customer_or_404(session, client_id, str(invoice.get("customer_id")))
        contact = await one(session, select(accounting_contacts).where(accounting_contacts.c.id == customer.get("contact_id")))
        debtors = find_native_account(accounts, settings_row.get("default_debtors_control_account"), "1100")
        journal = await post_native_journal(
            session,
            client_id,
            "bank_customer_receipt",
            transaction_id,
            transaction.get("transaction_date") or datetime.now(timezone.utc).date().isoformat(),
            transaction.get("reference") or invoice.get("invoice_number") or transaction_id,
            f"Bank receipt allocated to {invoice.get('invoice_number')}",
            [
                {"account": bank, "contact": contact, "debit": money_str(amount), "credit": "0.00", "description": transaction.get("description")},
                {"account": debtors, "contact": contact, "debit": "0.00", "credit": money_str(amount), "description": transaction.get("description")},
            ],
            user.get("id"),
        )
        receipt_id = new_id()
        await session.execute(insert(accounting_ar_receipts).values(id=receipt_id, client_id=client_id, customer_id=customer["id"], contact_id=customer.get("contact_id"), receipt_date=transaction.get("transaction_date"), bank_account_code=bank.get("code"), payment_method="Bank Transfer", reference=transaction.get("reference") or invoice.get("invoice_number"), amount=money_str(amount), currency="GBP", status="posted", posted_journal_id=journal.get("id"), bank_transaction_id=transaction_id, created_at=now, updated_at=now))
        allocation = min(amount, money(invoice.get("outstanding_amount")))
        if allocation:
            await session.execute(insert(accounting_ar_receipt_allocations).values(id=new_id(), client_id=client_id, receipt_id=receipt_id, invoice_id=invoice["id"], amount=money_str(allocation), created_at=now))
            new_outstanding = money(invoice.get("outstanding_amount")) - allocation
            await session.execute(update(accounting_ar_invoices).where(accounting_ar_invoices.c.id == invoice["id"]).values(outstanding_amount=money_str(new_outstanding), status="paid" if new_outstanding == 0 else "part_paid", updated_at=now))
        matched_to = f"Customer receipt: {invoice.get('invoice_number')}"
    elif match_type == "rule":
        rule = await one(session, select(accounting_bank_rules).where(accounting_bank_rules.c.client_id == client_id, accounting_bank_rules.c.id == str(payload.get("record_id") or "")))
        if not rule:
            raise HTTPException(status_code=404, detail="Bank rule not found")
        target = find_native_account(accounts, rule.get("target_account_code"), settings_row.get("default_suspense_account") or "9999")
        if money(transaction.get("money_in")):
            lines = [{"account": bank, "debit": money_str(amount), "credit": "0.00", "description": transaction.get("description")}, {"account": target, "debit": "0.00", "credit": money_str(amount), "description": transaction.get("description")}]
        else:
            lines = [{"account": target, "debit": money_str(amount), "credit": "0.00", "description": transaction.get("description")}, {"account": bank, "debit": "0.00", "credit": money_str(amount), "description": transaction.get("description")}]
        journal = await post_native_journal(session, client_id, "bank_rule", transaction_id, transaction.get("transaction_date"), transaction.get("reference") or transaction_id, transaction.get("description") or "Bank rule", lines, user.get("id"))
        matched_to = f"Rule: {rule.get('name')}"
    else:
        raise HTTPException(status_code=400, detail="Choose a supported match type.")
    await session.execute(insert(accounting_bank_matches).values(id=new_id(), client_id=client_id, bank_transaction_id=transaction_id, match_type=match_type, matched_record_type=match_type, matched_record_id=str(payload.get("record_id") or ""), amount=money_str(amount), confidence=int(payload.get("confidence") or 0), status="matched", journal_entry_id=journal.get("id") if journal else None, created_at=now, updated_at=now))
    await session.execute(update(accounting_bank_transactions).where(accounting_bank_transactions.c.id == transaction_id).values(status="reconciled", matched_to=matched_to, journal_entry_id=journal.get("id") if journal else None, reconciled_at=now, updated_at=now))
    await add_accounting_audit(session, client_id, user.get("id"), "bank_transaction_matched", "banking", transaction_id, {"match_type": match_type, "matched_to": matched_to})
    await session.commit()
    return {"ok": True, "matched_to": matched_to, "journal": journal}


@api.post("/admin/accounting/clients/{client_id}/bank-transactions/{transaction_id}/ignore")
async def ignore_native_bank_transaction(
    client_id: str,
    transaction_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    transaction = await one(session, select(accounting_bank_transactions).where(accounting_bank_transactions.c.client_id == client_id, accounting_bank_transactions.c.id == transaction_id))
    if not transaction:
        raise HTTPException(status_code=404, detail="Bank transaction not found")
    await session.execute(update(accounting_bank_transactions).where(accounting_bank_transactions.c.id == transaction_id).values(status="ignored", ignored=True, updated_at=utc_now_iso()))
    await add_accounting_audit(session, client_id, user.get("id"), "bank_transaction_ignored", "banking", transaction_id, {})
    await session.commit()
    return {"ok": True}


@api.post("/admin/accounting/clients/{client_id}/bank-transactions/{transaction_id}/undo")
async def undo_native_bank_match(
    client_id: str,
    transaction_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    transaction = await one(session, select(accounting_bank_transactions).where(accounting_bank_transactions.c.client_id == client_id, accounting_bank_transactions.c.id == transaction_id))
    if not transaction:
        raise HTTPException(status_code=404, detail="Bank transaction not found")
    journal_id = transaction.get("journal_entry_id")
    now = utc_now_iso()
    if journal_id:
        await session.execute(update(accounting_journal_entries).where(accounting_journal_entries.c.client_id == client_id, accounting_journal_entries.c.id == journal_id).values(status="void"))
    await session.execute(update(accounting_bank_matches).where(accounting_bank_matches.c.bank_transaction_id == transaction_id).values(status="undone", updated_at=now))
    await session.execute(update(accounting_bank_transactions).where(accounting_bank_transactions.c.id == transaction_id).values(status="unreconciled", matched_to="", journal_entry_id=None, reconciled_at=None, ignored=False, updated_at=now))
    await add_accounting_audit(session, client_id, user.get("id"), "bank_match_undone", "banking", transaction_id, {"journal_id": journal_id})
    await session.commit()
    return {"ok": True}


@api.post("/admin/accounting/clients/{client_id}/bank/rules")
async def create_bank_rule(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await get_client_or_404(session, client_id)
    if not str(payload.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="Rule name is required.")
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "name": str(payload.get("name") or "").strip(),
        "active": bool(payload.get("active", True)),
        "bank_account_id": str(payload.get("bank_account_id") or ""),
        "field": str(payload.get("field") or "description"),
        "operator": str(payload.get("operator") or "contains"),
        "value": str(payload.get("value") or "").strip(),
        "amount_operator": str(payload.get("amount_operator") or ""),
        "amount_value": money_str(money(payload.get("amount_value"))),
        "target_action": str(payload.get("target_action") or "post_to_account"),
        "target_account_code": str(payload.get("target_account_code") or "").strip(),
        "transaction_type": str(payload.get("transaction_type") or ""),
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_bank_rules).values(**row))
    await add_accounting_audit(session, client_id, user.get("id"), "bank_rule_created", "banking", row["id"], row)
    await session.commit()
    return serialize_bank_rule(row)


@api.post("/admin/accounting/clients/{client_id}/bank/transfers")
async def create_bank_transfer(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    accounts = await ensure_native_accounting_client(session, client_id)
    from_account = await one(session, select(accounting_bank_accounts).where(accounting_bank_accounts.c.client_id == client_id, accounting_bank_accounts.c.id == str(payload.get("from_bank_account_id") or "")))
    to_account = await one(session, select(accounting_bank_accounts).where(accounting_bank_accounts.c.client_id == client_id, accounting_bank_accounts.c.id == str(payload.get("to_bank_account_id") or "")))
    if not from_account or not to_account or from_account["id"] == to_account["id"]:
        raise HTTPException(status_code=400, detail="Choose two different bank accounts.")
    amount = money(payload.get("amount"))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Transfer amount must be greater than zero.")
    transfer_date = parse_date_or_today(payload.get("transfer_date")).isoformat()
    from_nominal = find_native_account(accounts, from_account.get("nominal_account_code"), "1200")
    to_nominal = find_native_account(accounts, to_account.get("nominal_account_code"), "1200")
    transfer_id = new_id()
    journal = await post_native_journal(
        session,
        client_id,
        "bank_transfer",
        transfer_id,
        transfer_date,
        str(payload.get("reference") or f"Transfer {transfer_date}"),
        f"Transfer from {from_account.get('account_name')} to {to_account.get('account_name')}",
        [
            {"account": to_nominal, "debit": money_str(amount), "credit": "0.00", "description": "Bank transfer"},
            {"account": from_nominal, "debit": "0.00", "credit": money_str(amount), "description": "Bank transfer"},
        ],
        user.get("id"),
    )
    now = utc_now_iso()
    row = {"id": transfer_id, "client_id": client_id, "from_bank_account_id": from_account["id"], "to_bank_account_id": to_account["id"], "transfer_date": transfer_date, "reference": str(payload.get("reference") or ""), "amount": money_str(amount), "status": "posted", "posted_journal_id": journal.get("id"), "created_at": now, "updated_at": now}
    await session.execute(insert(accounting_bank_transfers).values(**row))
    await add_accounting_audit(session, client_id, user.get("id"), "bank_transfer_posted", "banking", transfer_id, row)
    await session.commit()
    return serialize_bank_transfer(row)


@api.post("/admin/accounting/clients/{client_id}/vat-returns/prepare")
async def prepare_native_vat_return(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before preparing VAT returns.")
    period_start = str(payload.get("period_start") or "").strip()
    period_end = str(payload.get("period_end") or "").strip()
    if not period_start or not period_end:
        raise HTTPException(status_code=400, detail="Period start and end are required.")
    journals = await many(
        session,
        select(accounting_journal_entries).where(
            accounting_journal_entries.c.client_id == client_id,
            accounting_journal_entries.c.entry_date >= period_start,
            accounting_journal_entries.c.entry_date <= period_end,
            accounting_journal_entries.c.status == "posted",
        ),
    )
    journal_ids = [str(j["id"]) for j in journals]
    lines = []
    if journal_ids:
        lines = await many(session, select(accounting_journal_lines).where(accounting_journal_lines.c.entry_id.in_(journal_ids)))
    vat_due_sales = Decimal("0.00")
    vat_reclaimed_purchases = Decimal("0.00")
    sales_net = Decimal("0.00")
    purchase_net = Decimal("0.00")
    for line in lines:
        code = str(line.get("account_code") or "")
        debit = money(line.get("debit"))
        credit = money(line.get("credit"))
        if code == "2200":
            if credit:
                vat_due_sales += credit
            if debit:
                vat_reclaimed_purchases += debit
        elif code.startswith("4"):
            sales_net += credit - debit
        elif code.startswith("5"):
            purchase_net += debit - credit
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "period_start": period_start,
        "period_end": period_end,
        "status": "draft",
        "vat_due_sales": money_str(vat_due_sales),
        "vat_reclaimed_purchases": money_str(vat_reclaimed_purchases),
        "net_vat_due": money_str(vat_due_sales - vat_reclaimed_purchases),
        "sales_net": money_str(sales_net),
        "purchase_net": money_str(purchase_net),
        "prepared_json": json.dumps({"journal_count": len(journals), "line_count": len(lines)}),
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_vat_returns).values(**row))
    await add_accounting_audit(session, client_id, user.get("id"), "vat_return_prepared", "vat_return", row["id"], row)
    await session.commit()
    return serialize_vat_return(row)


@api.post("/admin/accounting/clients/{client_id}/periods")
async def create_native_accounting_period(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding accounting periods.")
    period_start = str(payload.get("period_start") or "").strip()
    period_end = str(payload.get("period_end") or "").strip()
    if not period_start or not period_end:
        raise HTTPException(status_code=400, detail="Period start and end are required.")
    now = utc_now_iso()
    row = {
        "id": new_id(),
        "client_id": client_id,
        "period_start": period_start,
        "period_end": period_end,
        "status": str(payload.get("status") or "open"),
        "notes": str(payload.get("notes") or ""),
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_periods).values(**row))
    await add_accounting_audit(session, client_id, user.get("id"), "period_created", "accounting_period", row["id"], row)
    await session.commit()
    return serialize_period(row)


@api.post("/admin/accounting/clients/{client_id}/financial-years")
async def create_native_financial_year(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before adding financial years.")
    start = parse_iso_date(str(payload.get("start_date") or ""), "Start date")
    end = parse_iso_date(str(payload.get("end_date") or ""), "End date")
    if end < start:
        raise HTTPException(status_code=400, detail="Financial year end date must be after the start date.")
    name = str(payload.get("name") or f"FY {start.year}/{str(end.year)[-2:]}").strip()
    existing = await one(
        session,
        select(accounting_financial_years).where(
            accounting_financial_years.c.client_id == client_id,
            accounting_financial_years.c.start_date == start.isoformat(),
            accounting_financial_years.c.end_date == end.isoformat(),
        ),
    )
    if existing:
        raise HTTPException(status_code=400, detail="This financial year already exists.")
    now = utc_now_iso()
    year_id = new_id()
    year_row = {
        "id": year_id,
        "client_id": client_id,
        "name": name,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "status": "open",
        "created_at": now,
        "updated_at": now,
    }
    await session.execute(insert(accounting_financial_years).values(**year_row))

    period_start = start
    period_number = 1
    while period_start <= end:
        next_month_start = add_months_to_date(period_start, 1)
        period_end = min(next_month_start - timedelta(days=1), end)
        await session.execute(
            insert(accounting_periods).values(
                id=new_id(),
                client_id=client_id,
                financial_year_id=year_id,
                period_name=f"P{period_number:02d}",
                period_number=period_number,
                period_start=period_start.isoformat(),
                period_end=period_end.isoformat(),
                status="open",
                transactions_posted=0,
                notes=name,
                created_at=now,
                updated_at=now,
            )
        )
        period_start = period_end + timedelta(days=1)
        period_number += 1
    await add_accounting_audit(session, client_id, user.get("id"), "financial_year_created", "financial_year", year_id, year_row)
    await session.commit()
    return {"financial_year": serialize_financial_year(year_row), "periods_created": period_number - 1}


@api.patch("/admin/accounting/clients/{client_id}/periods/{period_id}")
async def update_native_accounting_period(
    client_id: str,
    period_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before changing periods.")
    period = await one(session, select(accounting_periods).where(accounting_periods.c.client_id == client_id, accounting_periods.c.id == period_id))
    if not period:
        raise HTTPException(status_code=404, detail="Accounting period not found.")
    status = str(payload.get("status") or "").strip().lower()
    if status not in {"open", "locked", "closed"}:
        raise HTTPException(status_code=400, detail="Period status must be open, locked, or closed.")
    before = serialize_period(period)
    await session.execute(
        update(accounting_periods)
        .where(accounting_periods.c.id == period_id)
        .values(status=status, updated_at=utc_now_iso())
    )
    await add_accounting_audit(session, client_id, user.get("id"), f"period_{status}", "accounting_period", period_id, {"previous": before, "status": status})
    await session.commit()
    return {"ok": True, "status": status}


@api.put("/admin/accounting/clients/{client_id}/settings")
async def update_native_accounting_settings(
    client_id: str,
    payload: dict,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting before saving accounting settings.")
    existing = await ensure_accounting_settings(session, client_id)
    allowed = {
        "default_sales_account",
        "default_purchase_account",
        "default_vat_control_account",
        "default_bank_account",
        "default_suspense_account",
        "default_debtors_control_account",
        "default_creditors_control_account",
        "default_retained_earnings_account",
    }
    values = {key: str(payload.get(key) or "").strip() for key in allowed if key in payload}
    values["updated_at"] = utc_now_iso()
    await session.execute(update(accounting_settings).where(accounting_settings.c.client_id == client_id).values(**values))
    await add_accounting_audit(session, client_id, user.get("id"), "accounting_settings_updated", "accounting_settings", existing["id"], values)
    await session.commit()
    updated_row = await ensure_accounting_settings(session, client_id)
    return serialize_accounting_settings(updated_row)


@api.get("/admin/companies-house/search")
async def companies_house_search(
    q: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    query = (q or "").strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail="Enter at least 2 characters to search")
    data = await companies_house_get("/search/companies", {"q": query, "items_per_page": 8}, session)
    return [
        {
            "company_number": item.get("company_number"),
            "title": item.get("title"),
            "company_status": item.get("company_status"),
            "company_type": item.get("company_type"),
            "address": item.get("address_snippet"),
            "date_of_creation": item.get("date_of_creation"),
        }
        for item in data.get("items", [])
    ]


@api.get("/admin/companies-house/profile/{company_number}")
async def companies_house_profile(
    company_number: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    number = re.sub(r"[^A-Za-z0-9]", "", company_number or "").upper()
    if not number:
        raise HTTPException(status_code=400, detail="Company number is required")
    profile = await companies_house_get(f"/company/{number}", session=session)
    officers_data, pscs_data, filings_data = await asyncio.gather(
        companies_house_get_optional(
            f"/company/{number}/officers",
            {"items_per_page": 50, "register_type": "directors"},
            session,
        ),
        companies_house_get_optional(
            f"/company/{number}/persons-with-significant-control",
            {"items_per_page": 50},
            session,
        ),
        companies_house_get_optional(
            f"/company/{number}/filing-history",
            {"items_per_page": 25},
            session,
        ),
    )
    accounts = profile.get("accounts") or {}
    confirmation = profile.get("confirmation_statement") or {}
    sic_codes = profile.get("sic_codes") or []
    directors = [
        ch_director(item)
        for item in (officers_data.get("items") or [])
        if not item.get("resigned_on") and ch_person_name(item)
    ][:30]
    pscs = [
        ch_psc(item)
        for item in (pscs_data.get("items") or [])
        if not item.get("ceased_on") and ch_person_name(item)
    ][:30]
    filings = [ch_filing(item) for item in (filings_data.get("items") or []) if item.get("date")][:20]
    contacts = directors + [psc for psc in pscs if psc.get("name") not in {director.get("name") for director in directors}]
    deadlines = []
    next_accounts = accounts.get("next_accounts") or {}
    last_accounts = accounts.get("last_accounts") or {}
    next_accounts_made_up_to = (
        next_accounts.get("period_end_on")
        or next_accounts.get("made_up_to")
        or accounts.get("next_made_up_to")
    )
    if next_accounts_made_up_to:
        deadlines.append(f"Accounts next made up to: {next_accounts_made_up_to}")
    accounts_due = next_accounts.get("due_on") or accounts.get("next_due")
    if accounts_due:
        deadlines.append(f"Accounts due: {accounts_due}")
    last_accounts_made_up_to = last_accounts.get("period_end_on") or last_accounts.get("made_up_to")
    if last_accounts_made_up_to:
        deadlines.append(f"Accounts last made up to: {last_accounts_made_up_to}")
    if confirmation.get("next_made_up_to"):
        deadlines.append(f"Confirmation next statement date: {confirmation.get('next_made_up_to')}")
    if confirmation.get("next_due"):
        deadlines.append(f"Confirmation statement due: {confirmation.get('next_due')}")
    if confirmation.get("last_made_up_to"):
        deadlines.append(f"Confirmation last statement date: {confirmation.get('last_made_up_to')}")
    for filing in filings[:5]:
        if filing.get("description"):
            deadlines.append(f"Recent filing {filing.get('date')}: {filing.get('description')}")
    main_contact = directors[0] if directors else (pscs[0] if pscs else {})
    return {
        "business_name": profile.get("company_name"),
        "client_type": "limited_company" if profile.get("type") == "ltd" else profile.get("type"),
        "company_number": profile.get("company_number") or number,
        "company_status": profile.get("company_status"),
        "incorporation_date": profile.get("date_of_creation"),
        "registered_office_address": format_companies_house_address(profile.get("registered_office_address") or {}),
        "industry": ", ".join(sic_codes),
        "year_end": accounts.get("accounting_reference_date", {}).get("month") and (
            f"{accounts.get('accounting_reference_date', {}).get('day')}/{accounts.get('accounting_reference_date', {}).get('month')}"
        ),
        "statutory_deadlines": "\n".join(deadlines),
        "companies_house_last_checked": utc_now_iso(),
        "main_contact_name": main_contact.get("name") or "",
        "main_contact_role": main_contact.get("role") or main_contact.get("kind") or "",
        "company_directors": json_compact(directors),
        "company_pscs": json_compact(pscs),
        "company_contacts": json_compact(contacts),
        "companies_house_filings": json_compact(filings),
    }


@api.post("/admin/clients/{client_id}/reset-password")
async def reset_client_password(
    client_id: str,
    payload: PasswordReset,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    result = await session.execute(
        update(users)
        .where(users.c.id == client_id, users.c.role == "client")
        .values(password_hash=hash_password(payload.new_password))
    )
    if result.rowcount == 0:
        await session.rollback()
        raise HTTPException(status_code=404, detail="Client not found")
    await session.commit()
    return {"ok": True}


# ---------- Admin: Client Integrations ----------
VALID_INTEGRATION_PROVIDERS = {"quickbooks", "sage", "xero"}
VALID_INTEGRATION_STATUSES = {"not_connected", "ready", "connected", "sync_error"}
VALID_INTEGRATION_RECORD_TYPES = {"account", "supplier", "customer", "tax_code"}
QUICKBOOKS_SCOPE = "com.intuit.quickbooks.accounting"
QUICKBOOKS_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2"
QUICKBOOKS_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"


def clean_provider(value: str) -> str:
    provider = (value or "quickbooks").strip().lower()
    if provider not in VALID_INTEGRATION_PROVIDERS:
        raise HTTPException(status_code=400, detail="Invalid integration provider")
    return provider


def clean_record_type(value: str) -> str:
    record_type = (value or "").strip().lower()
    if record_type not in VALID_INTEGRATION_RECORD_TYPES:
        raise HTTPException(status_code=400, detail="Invalid integration record type")
    return record_type


def serialize_integration(row: Optional[dict]) -> dict:
    if not row:
        return {
            "provider": "quickbooks",
            "status": "not_connected",
            "company_id": "",
            "company_name": "",
            "sandbox": False,
            "auto_create_suppliers": True,
            "auto_create_customers": True,
            "default_purchase_account": "",
            "default_sales_account": "",
            "default_vat_code": "",
            "notes": "",
            "last_sync_at": "",
        }
    d = dict(row)
    d["sandbox"] = bool(d.get("sandbox"))
    d["auto_create_suppliers"] = bool(d.get("auto_create_suppliers"))
    d["auto_create_customers"] = bool(d.get("auto_create_customers"))
    d["connected"] = bool(d.get("refresh_token_enc") and d.get("company_id"))
    d.pop("access_token_enc", None)
    d.pop("refresh_token_enc", None)
    return d


def serialize_integration_record(row: dict) -> dict:
    d = dict(row)
    d["active"] = bool(d.get("active"))
    return d


async def get_client_or_404(session: AsyncSession, client_id: str) -> dict:
    client = await one(session, select(users).where(users.c.id == client_id, users.c.role == "client"))
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


async def integration_record_counts(session: AsyncSession, client_id: str) -> dict:
    counts = {}
    for record_type in VALID_INTEGRATION_RECORD_TYPES:
        counts[record_type] = await count_rows(
            session,
            integration_records,
            integration_records.c.client_id == client_id,
            integration_records.c.record_type == record_type,
            integration_records.c.active == True,  # noqa: E712
        )
    return counts


async def get_quickbooks_credentials(session: Optional[AsyncSession] = None) -> dict:
    saved = None
    if session is not None:
        saved = await one(session, select(settings).where(settings.c.key == "quickbooks"))
    enabled = True if not saved or saved.get("quickbooks_enabled") is None else bool(saved.get("quickbooks_enabled"))
    env_client_id = os.environ.get("QUICKBOOKS_CLIENT_ID", "").strip()
    env_client_secret = os.environ.get("QUICKBOOKS_CLIENT_SECRET", "").strip()
    client_id = env_client_id or ((saved or {}).get("quickbooks_client_id") or "").strip()
    client_secret = env_client_secret
    if not client_secret and saved and saved.get("quickbooks_client_secret_enc"):
        try:
            client_secret = decrypt_secret(saved["quickbooks_client_secret_enc"]) or ""
        except Exception:
            logger.exception("Failed to decrypt saved QuickBooks client secret")
            client_secret = ""
    redirect_uri = os.environ.get("QUICKBOOKS_REDIRECT_URI", "").strip() or ((saved or {}).get("quickbooks_redirect_uri") or "").strip()
    if not redirect_uri:
        redirect_uri = os.environ.get("BACKEND_URL", "http://localhost:8000").rstrip("/") + "/api/integrations/quickbooks/callback"
    environment = os.environ.get("QUICKBOOKS_ENVIRONMENT", "").strip().lower() or ((saved or {}).get("quickbooks_environment") or "sandbox").strip().lower()
    if environment not in {"sandbox", "production"}:
        environment = "sandbox"
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "environment": environment,
        "configured": bool(client_id and client_secret and redirect_uri),
        "enabled": enabled,
        "source": "environment" if env_client_id or env_client_secret else ("saved" if saved else "missing"),
    }


def quickbooks_api_base(environment: str) -> str:
    return "https://sandbox-quickbooks.api.intuit.com" if environment == "sandbox" else "https://quickbooks.api.intuit.com"


def encrypt_secret(value: Optional[str]) -> Optional[str]:
    return fernet.encrypt(value.encode()).decode() if value else None


def decrypt_secret(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return fernet.decrypt(value.encode()).decode()


def create_quickbooks_state(client_id: str) -> str:
    payload = {
        "type": "quickbooks_oauth_state",
        "client_id": client_id,
        "nonce": new_id(),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=20),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def verify_quickbooks_state(state: str) -> str:
    try:
        payload = jwt.decode(state, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Invalid QuickBooks connection state")
    if payload.get("type") != "quickbooks_oauth_state" or not payload.get("client_id"):
        raise HTTPException(status_code=400, detail="Invalid QuickBooks connection state")
    return str(payload["client_id"])


def quickbooks_auth_header(client_id: str, client_secret: str) -> str:
    raw = f"{client_id}:{client_secret}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("utf-8")


async def exchange_quickbooks_code(session: AsyncSession, code: str, redirect_uri: str) -> dict:
    creds = await get_quickbooks_credentials(session)
    if not creds["configured"]:
        raise HTTPException(status_code=400, detail="QuickBooks OAuth is not configured. Add QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            QUICKBOOKS_TOKEN_URL,
            headers={
                "Authorization": quickbooks_auth_header(creds["client_id"], creds["client_secret"]),
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
    if resp.status_code >= 400:
        logger.error("QuickBooks token exchange failed: %s %s", resp.status_code, resp.text[:500])
        raise HTTPException(status_code=400, detail="QuickBooks token exchange failed")
    return resp.json()


async def refresh_quickbooks_access_token(session: AsyncSession, integration: dict) -> str:
    creds = await get_quickbooks_credentials(session)
    refresh_token = decrypt_secret(integration.get("refresh_token_enc"))
    if not creds["configured"] or not refresh_token:
        raise HTTPException(status_code=400, detail="QuickBooks is not connected for this client")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            QUICKBOOKS_TOKEN_URL,
            headers={
                "Authorization": quickbooks_auth_header(creds["client_id"], creds["client_secret"]),
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
        )
    if resp.status_code >= 400:
        logger.error("QuickBooks refresh failed: %s %s", resp.status_code, resp.text[:500])
        raise HTTPException(status_code=400, detail="QuickBooks refresh failed. Reconnect this client.")
    token_data = resp.json()
    now = datetime.now(timezone.utc)
    values = {
        "access_token_enc": encrypt_secret(token_data.get("access_token")),
        "refresh_token_enc": encrypt_secret(token_data.get("refresh_token") or refresh_token),
        "token_expires_at": (now + timedelta(seconds=int(token_data.get("expires_in") or 3600))).isoformat(),
        "updated_at": utc_now_iso(),
    }
    if token_data.get("x_refresh_token_expires_in"):
        values["refresh_expires_at"] = (now + timedelta(seconds=int(token_data["x_refresh_token_expires_in"]))).isoformat()
    await session.execute(update(client_integrations).where(client_integrations.c.id == integration["id"]).values(**values))
    await session.commit()
    return token_data["access_token"]


async def get_valid_quickbooks_access_token(session: AsyncSession, integration: dict) -> str:
    expires_raw = integration.get("token_expires_at")
    access_token = None
    if integration.get("access_token_enc"):
        try:
            access_token = decrypt_secret(integration["access_token_enc"])
        except Exception:
            access_token = None
    try:
        expires_at = datetime.fromisoformat(expires_raw) if expires_raw else None
    except ValueError:
        expires_at = None
    if access_token and expires_at and expires_at > datetime.now(timezone.utc) + timedelta(minutes=3):
        return access_token
    return await refresh_quickbooks_access_token(session, integration)


async def quickbooks_query(access_token: str, realm_id: str, environment: str, query: str) -> dict:
    url = f"{quickbooks_api_base(environment)}/v3/company/{realm_id}/query"
    async with httpx.AsyncClient(timeout=40) as client:
        resp = await client.get(
            url,
            params={"query": query, "minorversion": "75"},
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    if resp.status_code >= 400:
        logger.error("QuickBooks query failed: %s %s", resp.status_code, resp.text[:500])
        raise HTTPException(status_code=400, detail=f"QuickBooks sync query failed for {query}: {resp.text[:300]}")
    return resp.json().get("QueryResponse") or {}


async def quickbooks_post(access_token: str, realm_id: str, environment: str, entity: str, payload: dict) -> dict:
    url = f"{quickbooks_api_base(environment)}/v3/company/{realm_id}/{entity.lower()}"
    async with httpx.AsyncClient(timeout=40) as client:
        resp = await client.post(
            url,
            params={"minorversion": "75"},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if resp.status_code >= 400:
        logger.error("QuickBooks %s create failed: %s %s", entity, resp.status_code, resp.text[:1000])
        raise HTTPException(status_code=400, detail=f"QuickBooks rejected the {entity}: {quickbooks_error_message(resp.text)}")
    return resp.json().get(entity) or resp.json()


def quickbooks_error_message(text_value: str) -> str:
    try:
        data = json.loads(text_value or "{}")
        errors = (((data.get("Fault") or {}).get("Error")) or [])
        messages = []
        for item in errors:
            message = item.get("Message") or item.get("Detail") or item.get("code")
            detail = item.get("Detail")
            if message and detail and detail not in message:
                message = f"{message}: {detail}"
            if message:
                messages.append(str(message))
        if messages:
            return "; ".join(messages)[:500]
    except Exception:
        pass
    return (text_value or "Unknown QuickBooks error")[:500]


async def optional_quickbooks_query(access_token: str, realm_id: str, environment: str, query: str) -> tuple[dict, Optional[str]]:
    try:
        return await quickbooks_query(access_token, realm_id, environment, query), None
    except HTTPException as exc:
        return {}, str(exc.detail)


@api.get("/admin/integrations/clients")
async def list_integration_clients(
    q: Optional[str] = None,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    stmt = select(users).where(users.c.role == "client")
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                users.c.first_name.ilike(like),
                users.c.last_name.ilike(like),
                users.c.business_name.ilike(like),
                users.c.email.ilike(like),
            )
        )
    clients = await many(session, stmt.order_by(users.c.business_name.asc()))
    result = []
    for client in clients:
        integration = await one(
            session,
            select(client_integrations).where(client_integrations.c.client_id == str(client["id"])),
        )
        item = serialize_user(client)
        item["integration"] = serialize_integration(integration)
        item["integration_counts"] = await integration_record_counts(session, str(client["id"]))
        result.append(item)
    return result


@api.get("/admin/integrations/clients/{client_id}")
async def get_client_integration(
    client_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    client = await get_client_or_404(session, client_id)
    integration = await one(
        session,
        select(client_integrations).where(client_integrations.c.client_id == client_id),
    )
    records = await many(
        session,
        select(integration_records)
        .where(integration_records.c.client_id == client_id)
        .order_by(integration_records.c.record_type.asc(), integration_records.c.name.asc()),
    )
    grouped = {"account": [], "supplier": [], "customer": [], "tax_code": []}
    for record in records:
        grouped.setdefault(record["record_type"], []).append(serialize_integration_record(record))
    return {
        "client": serialize_user(client),
        "integration": serialize_integration(integration),
        "records": grouped,
        "counts": {key: len(value) for key, value in grouped.items()},
    }


@api.put("/admin/integrations/clients/{client_id}/settings")
async def save_client_integration_settings(
    client_id: str,
    payload: ClientIntegrationSettingsIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await get_client_or_404(session, client_id)
    provider = clean_provider(payload.provider)
    status = (payload.status or "not_connected").strip().lower()
    if status not in VALID_INTEGRATION_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid integration status")
    now = utc_now_iso()
    values = {
        "provider": provider,
        "status": status,
        "company_id": (payload.company_id or "").strip(),
        "company_name": (payload.company_name or "").strip(),
        "auto_create_suppliers": bool(payload.auto_create_suppliers),
        "auto_create_customers": bool(payload.auto_create_customers),
        "default_purchase_account": (payload.default_purchase_account or "").strip(),
        "default_sales_account": (payload.default_sales_account or "").strip(),
        "default_vat_code": (payload.default_vat_code or "").strip(),
        "notes": (payload.notes or "").strip(),
        "updated_at": now,
    }
    existing = await one(session, select(client_integrations).where(client_integrations.c.client_id == client_id))
    if existing and existing.get("refresh_token_enc") and existing.get("company_id"):
        values["sandbox"] = bool(existing.get("sandbox"))
    else:
        values["sandbox"] = bool(payload.sandbox)
    if existing:
        await session.execute(update(client_integrations).where(client_integrations.c.client_id == client_id).values(**values))
    else:
        await session.execute(insert(client_integrations).values(id=new_id(), client_id=client_id, created_at=now, **values))
    await session.commit()
    return {"ok": True, "integration": serialize_integration({**values, "client_id": client_id})}


@api.get("/admin/integrations/quickbooks/config")
async def get_quickbooks_config(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    creds = await get_quickbooks_credentials(session)
    return {
        "configured": creds["configured"],
        "enabled": creds["enabled"],
        "environment": creds["environment"],
        "redirect_uri": creds["redirect_uri"],
        "scope": QUICKBOOKS_SCOPE,
        "source": creds["source"],
        "client_id_saved": bool(creds["client_id"]),
        "client_secret_saved": bool(creds["client_secret"]),
    }


@api.put("/admin/integrations/quickbooks/config")
async def save_quickbooks_config(
    payload: QuickBooksAppSettingsIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    existing = await one(session, select(settings).where(settings.c.key == "quickbooks")) or {}
    environment = (payload.environment or "sandbox").strip().lower()
    if environment not in {"sandbox", "production"}:
        raise HTTPException(status_code=400, detail="Invalid QuickBooks environment")
    values = {
        "key": "quickbooks",
        "quickbooks_enabled": bool(payload.enabled),
        "quickbooks_client_id": (payload.client_id or existing.get("quickbooks_client_id") or "").strip(),
        "quickbooks_environment": environment,
        "quickbooks_redirect_uri": (payload.redirect_uri or "").strip(),
    }
    if payload.client_secret:
        values["quickbooks_client_secret_enc"] = encrypt_secret(payload.client_secret.strip())
    elif existing.get("quickbooks_client_secret_enc"):
        values["quickbooks_client_secret_enc"] = existing["quickbooks_client_secret_enc"]
    else:
        values["quickbooks_client_secret_enc"] = None
    if existing:
        await session.execute(update(settings).where(settings.c.key == "quickbooks").values(**values))
    else:
        await session.execute(insert(settings).values(**values))
    await session.commit()
    creds = await get_quickbooks_credentials(session)
    return {
        "configured": creds["configured"],
        "enabled": creds["enabled"],
        "environment": creds["environment"],
        "redirect_uri": creds["redirect_uri"],
        "source": creds["source"],
        "client_id_saved": bool(creds["client_id"]),
        "client_secret_saved": bool(creds["client_secret"]),
    }


@api.get("/admin/integrations/companies-house/config")
async def get_companies_house_config(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    env_key = bool(os.environ.get("COMPANIES_HOUSE_API_KEY", "").strip())
    saved = await one(session, select(settings).where(settings.c.key == "companies_house"))
    saved_key = bool(saved and saved.get("companies_house_api_key_enc"))
    enabled = True if not saved or saved.get("companies_house_enabled") is None else bool(saved.get("companies_house_enabled"))
    return {
        "configured": env_key or saved_key,
        "enabled": enabled,
        "source": "environment" if env_key else ("saved" if saved_key else "missing"),
        "api_key_saved": env_key or saved_key,
    }


@api.put("/admin/integrations/companies-house/config")
async def save_companies_house_config(
    payload: CompaniesHouseSettingsIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    existing = await one(session, select(settings).where(settings.c.key == "companies_house")) or {}
    values = {"key": "companies_house", "companies_house_enabled": bool(payload.enabled)}
    if payload.api_key and payload.api_key.strip():
        values["companies_house_api_key_enc"] = encrypt_secret(payload.api_key.strip())
    elif existing.get("companies_house_api_key_enc"):
        values["companies_house_api_key_enc"] = existing["companies_house_api_key_enc"]
    else:
        values["companies_house_api_key_enc"] = None

    if existing:
        await session.execute(update(settings).where(settings.c.key == "companies_house").values(**values))
    else:
        await session.execute(insert(settings).values(**values))
    await session.commit()
    return await get_companies_house_config(user=user, session=session)


@api.get("/admin/integrations/clients/{client_id}/quickbooks/connect")
async def start_quickbooks_connect(
    client_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await get_client_or_404(session, client_id)
    creds = await get_quickbooks_credentials(session)
    if not creds["enabled"]:
        raise HTTPException(status_code=403, detail="Accounting software integration is disabled")
    if not creds["configured"]:
        raise HTTPException(status_code=400, detail="QuickBooks OAuth is not configured. Add QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET to the API environment.")
    params = {
        "client_id": creds["client_id"],
        "scope": QUICKBOOKS_SCOPE,
        "redirect_uri": creds["redirect_uri"],
        "response_type": "code",
        "state": create_quickbooks_state(client_id),
    }
    return {"auth_url": f"{QUICKBOOKS_AUTH_URL}?{urlencode(params)}"}


@api.get("/integrations/quickbooks/callback")
async def quickbooks_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    realmId: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
    session: AsyncSession = Depends(get_db),
):
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    if error:
        return RedirectResponse(f"{frontend_url}/admin/integrations?quickbooks=error&message={urlencode({'m': error_description or error})[2:]}")
    if not code or not state or not realmId:
        return RedirectResponse(f"{frontend_url}/admin/integrations?quickbooks=missing")
    client_id = verify_quickbooks_state(state)
    await get_client_or_404(session, client_id)
    creds = await get_quickbooks_credentials(session)
    if not creds["enabled"]:
        return RedirectResponse(f"{frontend_url}/admin/clients/{client_id}?quickbooks=error&message=Accounting%20software%20integration%20is%20disabled")
    token_data = await exchange_quickbooks_code(session, code, creds["redirect_uri"])
    now = datetime.now(timezone.utc)
    values = {
        "provider": "quickbooks",
        "status": "connected",
        "company_id": realmId,
        "sandbox": creds["environment"] == "sandbox",
        "access_token_enc": encrypt_secret(token_data.get("access_token")),
        "refresh_token_enc": encrypt_secret(token_data.get("refresh_token")),
        "token_expires_at": (now + timedelta(seconds=int(token_data.get("expires_in") or 3600))).isoformat(),
        "refresh_expires_at": (now + timedelta(seconds=int(token_data.get("x_refresh_token_expires_in") or 0))).isoformat()
            if token_data.get("x_refresh_token_expires_in") else None,
        "scope": token_data.get("scope") or QUICKBOOKS_SCOPE,
        "updated_at": utc_now_iso(),
    }
    existing = await one(session, select(client_integrations).where(client_integrations.c.client_id == client_id))
    if existing:
        await session.execute(update(client_integrations).where(client_integrations.c.client_id == client_id).values(**values))
    else:
        await session.execute(insert(client_integrations).values(id=new_id(), client_id=client_id, created_at=utc_now_iso(), **values))
    await session.commit()
    try:
        await sync_quickbooks_lists_for_client(session, client_id)
        return RedirectResponse(f"{frontend_url}/admin/clients/{client_id}?quickbooks=connected&sync=ok")
    except Exception as exc:
        logger.exception("QuickBooks connected but initial sync failed for client %s", client_id)
        message = urlencode({"m": f"QuickBooks connected, but list sync failed: {str(exc)}"})[2:]
        return RedirectResponse(f"{frontend_url}/admin/clients/{client_id}?quickbooks=connected&sync=error&message={message}")


async def replace_integration_records(session: AsyncSession, client_id: str, provider: str, record_type: str, records: list[dict]):
    now = utc_now_iso()
    await session.execute(
        delete(integration_records).where(
            integration_records.c.client_id == client_id,
            integration_records.c.provider == provider,
            integration_records.c.record_type == record_type,
        )
    )
    if records:
        await session.execute(insert(integration_records), [
            {
                "id": new_id(),
                "client_id": client_id,
                "provider": provider,
                "record_type": record_type,
                "external_id": record.get("external_id") or "",
                "code": record.get("code") or "",
                "name": record.get("name") or "",
                "email": record.get("email") or None,
                "description": record.get("description") or "",
                "active": bool(record.get("active", True)),
                "raw_json": json.dumps(record.get("raw") or {}),
                "created_at": now,
                "updated_at": now,
            }
            for record in records
            if record.get("name")
        ])


async def sync_quickbooks_lists_for_client(session: AsyncSession, client_id: str) -> dict:
    await get_client_or_404(session, client_id)
    integration = await one(session, select(client_integrations).where(client_integrations.c.client_id == client_id))
    if not integration or integration.get("provider") != "quickbooks" or not integration.get("company_id"):
        raise HTTPException(status_code=400, detail="QuickBooks is not connected for this client")
    access_token = await get_valid_quickbooks_access_token(session, integration)
    integration = await one(session, select(client_integrations).where(client_integrations.c.client_id == client_id))
    environment = "sandbox" if integration.get("sandbox") else "production"
    realm_id = integration["company_id"]

    try:
        accounts_response = await quickbooks_query(access_token, realm_id, environment, "SELECT * FROM Account MAXRESULTS 1000")
    except HTTPException as exc:
        detail = str(exc.detail or "")
        if "ApplicationAuthorizationFailed" not in detail and "003100" not in detail:
            raise
        alternate_environment = "production" if environment == "sandbox" else "sandbox"
        logger.warning(
            "QuickBooks %s query failed for client %s; retrying %s",
            environment,
            client_id,
            alternate_environment,
        )
        accounts_response = await quickbooks_query(access_token, realm_id, alternate_environment, "SELECT * FROM Account MAXRESULTS 1000")
        environment = alternate_environment
        await session.execute(
            update(client_integrations)
            .where(client_integrations.c.client_id == client_id)
            .values(sandbox=environment == "sandbox", updated_at=utc_now_iso())
        )
        await session.commit()
        integration = await one(session, select(client_integrations).where(client_integrations.c.client_id == client_id))
    vendors_response = await quickbooks_query(access_token, realm_id, environment, "SELECT * FROM Vendor MAXRESULTS 1000")
    customers_response = await quickbooks_query(access_token, realm_id, environment, "SELECT * FROM Customer MAXRESULTS 1000")
    company_response = await quickbooks_query(access_token, realm_id, environment, "SELECT * FROM CompanyInfo")
    sync_warnings = []
    tax_codes_response = {}
    for tax_code_query in ("SELECT * FROM TaxCode MAXRESULTS 1000", "SELECT * FROM TaxCode"):
        tax_codes_response, warning = await optional_quickbooks_query(access_token, realm_id, environment, tax_code_query)
        if warning:
            sync_warnings.append(warning)
            logger.warning("QuickBooks tax code query skipped for client %s: %s", client_id, warning)
            continue
        if tax_codes_response.get("TaxCode"):
            break
    company_info = (company_response.get("CompanyInfo") or [{}])[0] or {}

    accounts = [
        {
            "external_id": item.get("Id"),
            "code": item.get("AcctNum") or item.get("Id") or "",
            "name": item.get("Name") or item.get("FullyQualifiedName") or "",
            "description": item.get("AccountType") or item.get("Classification") or "",
            "active": item.get("Active", True),
            "raw": item,
        }
        for item in accounts_response.get("Account", []) or []
    ]
    suppliers = [
        {
            "external_id": item.get("Id"),
            "code": item.get("AcctNum") or item.get("Id") or "",
            "name": item.get("DisplayName") or item.get("CompanyName") or item.get("PrintOnCheckName") or "",
            "email": ((item.get("PrimaryEmailAddr") or {}).get("Address") if isinstance(item.get("PrimaryEmailAddr"), dict) else None),
            "description": item.get("CompanyName") or "",
            "active": item.get("Active", True),
            "raw": item,
        }
        for item in vendors_response.get("Vendor", []) or []
    ]
    customers = [
        {
            "external_id": item.get("Id"),
            "code": item.get("Id") or "",
            "name": item.get("DisplayName") or item.get("CompanyName") or item.get("FullyQualifiedName") or "",
            "email": ((item.get("PrimaryEmailAddr") or {}).get("Address") if isinstance(item.get("PrimaryEmailAddr"), dict) else None),
            "description": item.get("CompanyName") or "",
            "active": item.get("Active", True),
            "raw": item,
        }
        for item in customers_response.get("Customer", []) or []
    ]
    tax_codes = [
        {
            "external_id": item.get("Id"),
            "code": item.get("Name") or item.get("Id") or "",
            "name": item.get("Name") or item.get("Description") or item.get("Id") or "",
            "description": item.get("Description") or ("Taxable" if item.get("Taxable") else "Non-taxable"),
            "active": item.get("Active", True),
            "raw": item,
        }
        for item in tax_codes_response.get("TaxCode", []) or []
    ]
    if not tax_codes:
        tax_rates_response = {}
        for tax_rate_query in ("SELECT * FROM TaxRate MAXRESULTS 1000", "SELECT * FROM TaxRate"):
            tax_rates_response, warning = await optional_quickbooks_query(access_token, realm_id, environment, tax_rate_query)
            if warning:
                sync_warnings.append(warning)
                logger.warning("QuickBooks tax rate query skipped for client %s: %s", client_id, warning)
                continue
            if tax_rates_response.get("TaxRate"):
                break
        sync_warnings.append("QuickBooks returned no TaxCode rows, so TaxRate rows were used as a fallback.")
        existing_tax_names = set()
        for item in tax_rates_response.get("TaxRate", []) or []:
            rate_name = item.get("Name") or item.get("Description") or item.get("Id") or ""
            if not rate_name or rate_name.strip().lower() in existing_tax_names:
                continue
            rate_value = item.get("RateValue")
            rate_label = f"{rate_name} ({rate_value}%)" if rate_value not in (None, "") else rate_name
            tax_codes.append({
                "external_id": item.get("Id"),
                "code": rate_name,
                "name": rate_label,
                "description": item.get("Description") or "QuickBooks tax rate",
                "active": item.get("Active", True),
                "raw": item,
            })
            existing_tax_names.add(rate_name.strip().lower())

    await replace_integration_records(session, client_id, "quickbooks", "account", accounts)
    await replace_integration_records(session, client_id, "quickbooks", "supplier", suppliers)
    await replace_integration_records(session, client_id, "quickbooks", "customer", customers)
    await replace_integration_records(session, client_id, "quickbooks", "tax_code", tax_codes)
    company_name = (
        company_info.get("CompanyName")
        or company_info.get("LegalName")
        or company_info.get("Name")
        or integration.get("company_name")
        or ""
    )
    await session.execute(
        update(client_integrations)
        .where(client_integrations.c.client_id == client_id)
        .values(status="connected", company_name=company_name, last_sync_at=utc_now_iso(), updated_at=utc_now_iso())
    )
    await session.commit()
    if not tax_codes:
        sync_warnings.append("QuickBooks returned 0 VAT/tax codes. Check the connected company VAT/tax setup and whether it exposes TaxCode or TaxRate records through the API.")
    return {
        "ok": True,
        "counts": {"account": len(accounts), "supplier": len(suppliers), "customer": len(customers), "tax_code": len(tax_codes)},
        "company_name": company_name,
        "warnings": sync_warnings[:6],
    }


@api.post("/admin/integrations/clients/{client_id}/quickbooks/sync")
async def sync_quickbooks_lists(
    client_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    creds = await get_quickbooks_credentials(session)
    if not creds["enabled"]:
        raise HTTPException(status_code=403, detail="Accounting software integration is disabled")
    return await sync_quickbooks_lists_for_client(session, client_id)


async def get_active_integration_records(session: AsyncSession, client_id: str, record_type: str) -> list[dict]:
    return await many(
        session,
        select(integration_records)
        .where(integration_records.c.client_id == client_id)
        .where(integration_records.c.provider == "quickbooks")
        .where(integration_records.c.record_type == record_type)
        .where(integration_records.c.active == True),  # noqa: E712
    )


def normalize_lookup_value(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def record_matches_value(record: dict, value: str) -> bool:
    needle = normalize_lookup_value(value)
    if not needle:
        return False
    raw = parse_json_object(record.get("raw_json")) or {}
    candidates = [
        record.get("external_id"),
        record.get("code"),
        record.get("name"),
        " - ".join([part for part in (record.get("code"), record.get("name")) if part]),
        " - ".join([part for part in (record.get("code"), record.get("name"), record.get("description")) if part]),
        raw.get("DisplayName"),
        raw.get("FullyQualifiedName"),
        raw.get("CompanyName"),
        raw.get("Name"),
    ]
    return any(normalize_lookup_value(candidate) == needle for candidate in candidates if candidate)


def find_integration_record(records: list[dict], value: Optional[str]) -> Optional[dict]:
    if not value:
        return None
    exact = [record for record in records if record_matches_value(record, value)]
    if exact:
        return exact[0]
    needle = normalize_lookup_value(value)
    for record in records:
        if needle and needle in normalize_lookup_value(record.get("name")):
            return record
    return None


def find_supplier_record(records: list[dict], vendor_name: Optional[str], vendor_account: Optional[str]) -> Optional[dict]:
    supplier = find_integration_record(records, vendor_name)
    if supplier:
        return supplier
    account_value = str(vendor_account or "").strip()
    # Bare numeric ids are too easy to confuse with an unrelated supplier. Only
    # trust the account field when it carries a display label from the synced list.
    if " - " in account_value:
        return find_integration_record(records, account_value)
    return None


def quickbooks_date(value: Optional[str]) -> Optional[str]:
    text_value = str(value or "").strip()
    if not text_value:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(text_value, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def quickbooks_amount(value: Optional[str]) -> Optional[float]:
    parsed = parse_money_value(str(value or ""))
    return round(parsed, 2) if parsed is not None else None


def quickbooks_ref(record: dict) -> dict:
    return {"value": str(record["external_id"]), "name": record.get("name") or record.get("code") or str(record["external_id"])}


def require_account_match(accounts: list[dict], value: Optional[str], field_label: str) -> Optional[dict]:
    text_value = str(value or "").strip()
    if not text_value:
        return None
    account = find_integration_record(accounts, text_value)
    if not account or not account.get("external_id"):
        raise HTTPException(status_code=400, detail=f"Select a synced QuickBooks {field_label}. AI suggested '{text_value}', but it is not in the synced Chart of Accounts.")
    return account


def optional_tax_match(tax_codes: list[dict], value: Optional[str]) -> Optional[dict]:
    text_value = str(value or "").strip()
    if not text_value:
        return None
    tax = find_integration_record(tax_codes, text_value)
    if not tax or not tax.get("external_id"):
        raise HTTPException(status_code=400, detail=f"Select a synced QuickBooks VAT code. AI suggested '{text_value}', but it is not in the synced VAT code list.")
    return tax


async def create_quickbooks_supplier(
    session: AsyncSession,
    access_token: str,
    realm_id: str,
    environment: str,
    client_id: str,
    vendor_name: str,
    supplier_code: Optional[str] = None,
    existing_record: Optional[dict] = None,
) -> dict:
    clean_name = re.sub(r"\s+", " ", str(vendor_name or "").strip())
    if not clean_name:
        raise HTTPException(status_code=400, detail="Supplier name is required before publishing.")
    payload = {
        "DisplayName": clean_name[:100],
        "CompanyName": clean_name[:100],
    }
    clean_code = re.sub(r"\s+", " ", str(supplier_code or "").strip())
    if clean_code:
        payload["AcctNum"] = clean_code[:100]
    vendor = await quickbooks_post(access_token, realm_id, environment, "Vendor", payload)
    now = utc_now_iso()
    raw_json = json.dumps(vendor)
    values = {
        "external_id": str(vendor.get("Id") or ""),
        "code": clean_code or str(vendor.get("AcctNum") or vendor.get("Id") or ""),
        "name": vendor.get("DisplayName") or vendor.get("CompanyName") or clean_name,
        "description": vendor.get("CompanyName") or "",
        "active": vendor.get("Active", True),
        "raw_json": raw_json,
        "updated_at": now,
    }
    if existing_record and existing_record.get("id"):
        await session.execute(update(integration_records).where(integration_records.c.id == existing_record["id"]).values(**values))
        return {**existing_record, **values}
    record = {
        "id": new_id(),
        "client_id": client_id,
        "provider": "quickbooks",
        "record_type": "supplier",
        "email": None,
        "created_at": now,
        **values,
    }
    await session.execute(insert(integration_records).values(**record))
    return record


def build_quickbooks_bill_lines(coding_fields: dict, accounts: list[dict], tax_codes: list[dict], header_account: dict, header_tax: Optional[dict]) -> list[dict]:
    source_lines = coding_fields.get("line_items")
    if not isinstance(source_lines, list) or not source_lines:
        source_lines = [{
            "description": coding_fields.get("description") or "",
            "category": coding_fields.get("category") or "",
            "vat_code": coding_fields.get("vat_code") or "",
            "net": coding_fields.get("net") or coding_fields.get("total") or "",
            "total": coding_fields.get("total") or coding_fields.get("net") or "",
        }]

    lines = []
    for line in source_lines:
        if not isinstance(line, dict):
            continue
        amount = quickbooks_amount(line.get("net"))
        if amount is None:
            amount = quickbooks_amount(line.get("total"))
        if amount is None:
            continue
        account = require_account_match(accounts, line.get("category"), "line category/account") or header_account
        tax = optional_tax_match(tax_codes, line.get("vat_code")) or header_tax
        detail = {"AccountRef": quickbooks_ref(account)}
        if tax and tax.get("external_id"):
            detail["TaxCodeRef"] = {"value": str(tax["external_id"]), "name": tax.get("name") or tax.get("code") or str(tax["external_id"])}
        lines.append({
            "DetailType": "AccountBasedExpenseLineDetail",
            "Amount": amount,
            "Description": str(line.get("description") or coding_fields.get("description") or "Purchase")[:4000],
            "AccountBasedExpenseLineDetail": detail,
        })
    return lines


async def attach_submission_file_to_quickbooks(access_token: str, realm_id: str, environment: str, filename: str, entity_type: str, entity_id: str) -> dict:
    safe_name = Path(filename).name
    file_path = UPLOAD_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=400, detail="The submitted document file could not be found for attachment.")
    content_type = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
    metadata_payload = {
        "AttachableRef": [{"EntityRef": {"type": entity_type, "value": entity_id}}],
        "FileName": safe_name,
        "ContentType": content_type,
    }
    url = f"{quickbooks_api_base(environment)}/v3/company/{realm_id}/upload"
    with file_path.open("rb") as fh:
        files = {
            "file_metadata_0": ("metadata.json", json.dumps(metadata_payload), "application/json"),
            "file_content_0": (safe_name, fh, content_type),
        }
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                url,
                params={"minorversion": "75"},
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
                files=files,
            )
    if resp.status_code >= 400:
        logger.error("QuickBooks attachment upload failed: %s %s", resp.status_code, resp.text[:1000])
        raise HTTPException(status_code=400, detail=f"QuickBooks created the bill but rejected the attachment: {quickbooks_error_message(resp.text)}")
    data = resp.json()
    attachables = data.get("AttachableResponse") or data.get("Attachable") or []
    if isinstance(attachables, list) and attachables:
        return attachables[0].get("Attachable") or attachables[0]
    return data


async def publish_submission_to_quickbooks(session: AsyncSession, submission: dict, coding_fields: dict) -> dict:
    if submission.get("type") != "purchase":
        raise HTTPException(status_code=400, detail="QuickBooks publishing is ready for purchase bills first. Sales invoices need product/service item mapping before they can be published safely.")

    client_id = str(submission["client_id"])
    integration = await one(session, select(client_integrations).where(client_integrations.c.client_id == client_id))
    if not integration or integration.get("provider") != "quickbooks" or not integration.get("company_id"):
        raise HTTPException(status_code=400, detail="Connect this client to QuickBooks before publishing.")
    if integration.get("status") != "connected":
        raise HTTPException(status_code=400, detail="QuickBooks is not connected for this client.")

    suppliers = await get_active_integration_records(session, client_id, "supplier")
    accounts = await get_active_integration_records(session, client_id, "account")
    tax_codes = await get_active_integration_records(session, client_id, "tax_code")

    environment = "sandbox" if integration.get("sandbox") else "production"
    realm_id = integration["company_id"]
    access_token = await get_valid_quickbooks_access_token(session, integration)
    integration = await one(session, select(client_integrations).where(client_integrations.c.client_id == client_id))

    supplier = find_supplier_record(suppliers, coding_fields.get("vendor_name"), coding_fields.get("vendor_account"))
    if not supplier or not supplier.get("external_id"):
        raise HTTPException(status_code=400, detail="Select a synced QuickBooks supplier, or click Create missing supplier before publishing.")

    default_account = integration.get("default_purchase_account") or ""
    header_category_value = str(coding_fields.get("category") or "").strip()
    header_account = require_account_match(accounts, header_category_value, "category/account") if header_category_value else None
    if not header_account and default_account:
        header_account = find_integration_record(accounts, default_account)
    if not header_account:
        raise HTTPException(status_code=400, detail="Select a QuickBooks category/account before publishing.")

    header_vat_value = str(coding_fields.get("vat_code") or "").strip()
    header_tax = optional_tax_match(tax_codes, header_vat_value) if header_vat_value else None
    if not header_tax and integration.get("default_vat_code"):
        header_tax = find_integration_record(tax_codes, integration.get("default_vat_code") or "")
    lines = build_quickbooks_bill_lines(coding_fields, accounts, tax_codes, header_account, header_tax)
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one line with a net or total amount before publishing.")

    payload = {
        "VendorRef": quickbooks_ref(supplier),
        "Line": lines,
        "PrivateNote": str(coding_fields.get("reference") or submission.get("comment") or "")[:4000],
    }
    doc_number = str(coding_fields.get("bill_number") or "").strip()
    if doc_number:
        payload["DocNumber"] = doc_number[:21]
    txn_date = quickbooks_date(coding_fields.get("date") or submission.get("date"))
    if txn_date:
        payload["TxnDate"] = txn_date
    due_date = quickbooks_date(coding_fields.get("due_date"))
    if due_date:
        payload["DueDate"] = due_date
    payload["GlobalTaxCalculation"] = "TaxInclusive" if str(coding_fields.get("price_is") or "").lower() == "tax inclusive" else "TaxExcluded"

    bill = await quickbooks_post(access_token, realm_id, environment, "Bill", payload)
    bill_id = str(bill.get("Id") or "")
    attachable = None
    if bill_id and submission.get("image_filename"):
        attachable = await attach_submission_file_to_quickbooks(access_token, realm_id, environment, submission.get("image_filename"), "Bill", bill_id)
    return {
        "provider": "quickbooks",
        "entity": "Bill",
        "id": bill_id,
        "doc_number": bill.get("DocNumber") or doc_number,
        "attached": bool(attachable),
        "attached_id": (attachable or {}).get("Id"),
        "synced_at": utc_now_iso(),
    }


async def publish_submission_to_native_accounting(
    session: AsyncSession,
    submission: dict,
    coding_fields: dict,
    actor_id: Optional[str] = None,
) -> dict:
    client_id = str(submission["client_id"])
    client = await get_user_by_id(session, client_id)
    if not is_native_accounting_client(client):
        raise HTTPException(status_code=400, detail="Enable EPOS native accounting on this client before publishing internally.")
    existing = await one(
        session,
        select(accounting_journal_entries).where(
            accounting_journal_entries.c.client_id == client_id,
            accounting_journal_entries.c.source_type == "submission",
            accounting_journal_entries.c.source_id == str(submission["id"]),
            accounting_journal_entries.c.status == "posted",
        ),
    )
    if existing:
        return {
            "provider": "epos_native",
            "entity": "JournalEntry",
            "id": existing["id"],
            "reference": existing.get("reference"),
            "total_debit": existing.get("total_debit"),
            "total_credit": existing.get("total_credit"),
            "posted_at": existing.get("posted_at"),
            "already_posted": True,
        }

    accounts = await ensure_native_accounting_client(session, client_id)
    doc_type = (submission.get("type") or "purchase").lower()
    is_sales = doc_type == "sales"
    if not is_sales:
        existing_ap_invoice = await one(
            session,
            select(accounting_ap_invoices).where(
                accounting_ap_invoices.c.client_id == client_id,
                accounting_ap_invoices.c.source_submission_id == str(submission["id"]),
                accounting_ap_invoices.c.status != "void",
            ),
        )
        if existing_ap_invoice:
            return {
                "provider": "epos_native",
                "entity": "PurchaseInvoice",
                "id": existing_ap_invoice.get("id"),
                "reference": existing_ap_invoice.get("invoice_number"),
                "status": existing_ap_invoice.get("status"),
                "gross_amount": existing_ap_invoice.get("gross_amount"),
                "outstanding_amount": existing_ap_invoice.get("outstanding_amount"),
                "already_posted": True,
            }
        line_items = coding_fields.get("line_items") if isinstance(coding_fields.get("line_items"), list) else []
        ap_invoice = await create_ap_invoice_record(
            session,
            client_id,
            {
                "supplier_name": coding_fields.get("vendor_name") or submission.get("client_business_name") or "Supplier",
                "invoice_number": coding_fields.get("bill_number") or coding_fields.get("invoice_number") or coding_fields.get("reference") or submission.get("description"),
                "reference": coding_fields.get("reference") or "",
                "invoice_date": coding_fields.get("date") or submission.get("date"),
                "due_date": coding_fields.get("due_date") or coding_fields.get("date") or submission.get("date"),
                "currency": coding_fields.get("currency") or "GBP",
                "net_amount": coding_fields.get("net"),
                "vat_amount": coding_fields.get("vat"),
                "gross_amount": coding_fields.get("total") or coding_fields.get("gross") or submission.get("amount"),
                "vat_code": coding_fields.get("vat_code"),
                "description": coding_fields.get("description") or submission.get("description"),
                "lines": [
                    {
                        "description": line.get("description") or coding_fields.get("description") or submission.get("description"),
                        "nominal_account_code": line.get("account_code") or line.get("category") or coding_fields.get("category"),
                        "quantity": line.get("units") or line.get("quantity") or "1",
                        "unit_price": line.get("price") or line.get("unit_price"),
                        "net_amount": line.get("net") or line.get("net_amount") or line.get("total"),
                        "vat_amount": line.get("vat") or line.get("vat_amount"),
                        "gross_amount": line.get("gross") or line.get("gross_amount") or line.get("total"),
                        "vat_code": line.get("vat_code") or coding_fields.get("vat_code"),
                    }
                    for line in line_items
                ],
                "source_submission_id": str(submission["id"]),
                "attachment_path": submission.get("image_filename") or "",
                "extracted_json": coding_fields,
            },
            actor_id,
        )
        return {
            "provider": "epos_native",
            "entity": "PurchaseInvoice",
            "id": ap_invoice.get("id"),
            "reference": ap_invoice.get("invoice_number"),
            "status": ap_invoice.get("status"),
            "gross_amount": ap_invoice.get("gross_amount"),
            "outstanding_amount": ap_invoice.get("outstanding_amount"),
            "created_at": ap_invoice.get("created_at"),
        }
    contact_type = "customer" if is_sales else "supplier"
    contact_name = coding_fields.get("customer_name") if is_sales else coding_fields.get("vendor_name")
    contact_name = contact_name or coding_fields.get("vendor_name") or coding_fields.get("customer_name") or submission.get("client_business_name") or ""
    contact = await get_or_create_native_contact(session, client_id, contact_name, contact_type)

    control_account = find_native_account(accounts, None, "1100" if is_sales else "2000")
    vat_account = find_native_account(accounts, None, "2200")
    default_nominal = find_native_account(accounts, coding_fields.get("category"), "4000" if is_sales else "5000")

    vat_amount = money(coding_fields.get("vat"))
    total_amount = money(coding_fields.get("total") or coding_fields.get("gross") or submission.get("amount"))
    net_amount = money(coding_fields.get("net"))
    if net_amount == Decimal("0.00") and total_amount != Decimal("0.00"):
        net_amount = total_amount - vat_amount
    if total_amount == Decimal("0.00"):
        total_amount = net_amount + vat_amount
    if net_amount == Decimal("0.00") and vat_amount == Decimal("0.00"):
        raise HTTPException(status_code=400, detail="Add a net/total value before publishing to EPOS Accounting.")

    line_items = coding_fields.get("line_items") if isinstance(coding_fields.get("line_items"), list) else []
    journal_lines: list[dict] = []
    line_net_total = Decimal("0.00")
    for line in line_items:
        line_net = money(line.get("net") or line.get("total") or line.get("price"))
        if line_net == Decimal("0.00"):
            continue
        line_account = find_native_account(accounts, line.get("category") or coding_fields.get("category"), default_nominal["code"])
        line_net_total += line_net
        journal_lines.append(
            {
                "account": line_account,
                "contact": contact,
                "debit": "0.00" if is_sales else money_str(line_net),
                "credit": money_str(line_net) if is_sales else "0.00",
                "vat_code": line.get("vat_code") or coding_fields.get("vat_code"),
                "description": line.get("description") or coding_fields.get("description") or submission.get("description"),
            }
        )
    if not journal_lines:
        journal_lines.append(
            {
                "account": default_nominal,
                "contact": contact,
                "debit": "0.00" if is_sales else money_str(net_amount),
                "credit": money_str(net_amount) if is_sales else "0.00",
                "vat_code": coding_fields.get("vat_code"),
                "description": coding_fields.get("description") or submission.get("description"),
            }
        )
    elif line_net_total != net_amount and net_amount != Decimal("0.00"):
        balancing_net = net_amount - line_net_total
        if balancing_net != Decimal("0.00"):
            debit_adjustment = Decimal("0.00")
            credit_adjustment = Decimal("0.00")
            if is_sales:
                if balancing_net >= Decimal("0.00"):
                    credit_adjustment = balancing_net
                else:
                    debit_adjustment = abs(balancing_net)
            else:
                if balancing_net >= Decimal("0.00"):
                    debit_adjustment = balancing_net
                else:
                    credit_adjustment = abs(balancing_net)
            journal_lines.append(
                {
                    "account": default_nominal,
                    "contact": contact,
                    "debit": money_str(debit_adjustment),
                    "credit": money_str(credit_adjustment),
                    "vat_code": coding_fields.get("vat_code"),
                    "description": "Header/line balancing adjustment",
                }
            )

    if vat_amount != Decimal("0.00"):
        journal_lines.append(
            {
                "account": vat_account,
                "contact": contact,
                "debit": "0.00" if is_sales else money_str(vat_amount),
                "credit": money_str(vat_amount) if is_sales else "0.00",
                "vat_code": coding_fields.get("vat_code"),
                "description": "VAT",
            }
        )

    journal_lines.append(
        {
            "account": control_account,
            "contact": contact,
            "debit": money_str(total_amount) if is_sales else "0.00",
            "credit": "0.00" if is_sales else money_str(total_amount),
            "vat_code": coding_fields.get("vat_code"),
            "description": coding_fields.get("description") or submission.get("description"),
        }
    )

    reference = str(coding_fields.get("bill_number") or coding_fields.get("invoice_number") or coding_fields.get("reference") or submission.get("description") or submission["id"])
    return await post_native_journal(
        session,
        client_id=client_id,
        source_type="submission",
        source_id=str(submission["id"]),
        entry_date=submission_entry_date(submission, coding_fields),
        reference=reference,
        description=str(coding_fields.get("description") or submission.get("description") or "Published document"),
        lines=journal_lines,
        actor_id=actor_id,
    )


async def publish_submission_to_accounting_destination(
    session: AsyncSession,
    submission: dict,
    coding_fields: dict,
    actor_id: Optional[str] = None,
) -> dict:
    client = await get_user_by_id(session, str(submission["client_id"]))
    if is_native_accounting_client(client):
        return await publish_submission_to_native_accounting(session, submission, coding_fields, actor_id)
    return await publish_submission_to_quickbooks(session, submission, coding_fields)


@api.post("/admin/integrations/clients/{client_id}/records")
async def create_integration_record(
    client_id: str,
    payload: IntegrationRecordIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await get_client_or_404(session, client_id)
    record_type = clean_record_type(payload.record_type)
    if record_type != "supplier":
        raise HTTPException(status_code=400, detail="Only missing suppliers can be created from invoice review")
    integration = await one(session, select(client_integrations).where(client_integrations.c.client_id == client_id))
    provider = clean_provider(integration.get("provider") if integration else "quickbooks")
    now = utc_now_iso()
    if (
        provider == "quickbooks"
        and integration
        and integration.get("status") == "connected"
        and integration.get("company_id")
    ):
        environment = "sandbox" if integration.get("sandbox") else "production"
        access_token = await get_valid_quickbooks_access_token(session, integration)
        record = await create_quickbooks_supplier(
            session,
            access_token,
            integration["company_id"],
            environment,
            client_id,
            payload.name,
            payload.code,
        )
        await session.commit()
        return serialize_integration_record(record)

    doc = {
        "id": new_id(),
        "client_id": client_id,
        "provider": provider,
        "record_type": record_type,
        "external_id": (payload.external_id or "").strip(),
        "code": (payload.code or "").strip(),
        "name": payload.name.strip(),
        "email": payload.email.lower().strip() if payload.email else None,
        "description": (payload.description or "").strip(),
        "active": bool(payload.active),
        "raw_json": None,
        "created_at": now,
        "updated_at": now,
    }
    if not doc["name"]:
        raise HTTPException(status_code=400, detail="Name is required")
    await session.execute(insert(integration_records).values(**doc))
    await session.commit()
    return serialize_integration_record(doc)


@api.delete("/admin/integrations/records/{record_id}")
async def delete_integration_record(
    record_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(delete(integration_records).where(integration_records.c.id == record_id))
    if result.rowcount == 0:
        await session.rollback()
        raise HTTPException(status_code=404, detail="Integration record not found")
    await session.commit()
    return {"ok": True}


# ---------- Admin: CSV Upload ----------
@api.get("/admin/clients/{client_id}/items")
async def admin_client_items(
    client_id: str,
    type: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    if type not in ("purchase", "sales"):
        raise HTTPException(status_code=400, detail="invalid type")
    docs = await many(
        session,
        select(outstanding_items)
        .where(outstanding_items.c.client_id == client_id, outstanding_items.c.type == type)
    )
    return [serialize_item(d) for d in sort_items_by_date(docs)]


@api.post("/admin/clients/{client_id}/upload-csv")
async def upload_csv(
    client_id: str,
    type: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    if type not in ("purchase", "sales"):
        raise HTTPException(status_code=400, detail="type must be 'purchase' or 'sales'")
    client = await one(session, select(users).where(users.c.id == client_id, users.c.role == "client"))
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    if reader.fieldnames is None:
        raise HTTPException(status_code=400, detail="CSV file is empty or invalid")

    def find_field(candidates):
        for c in candidates:
            for fn in reader.fieldnames:
                if fn and fn.strip().lower() == c.lower():
                    return fn
        return None

    f_desc = find_field(["Description", "Desc", "description"])
    f_date = find_field(["Date", "Invoice Date", "date"])
    f_amount = find_field(["Amount", "Total", "amount"])

    missing_cols = []
    if not f_desc:
        missing_cols.append("Description")
    if not f_date:
        missing_cols.append("Date")
    if not f_amount:
        missing_cols.append("Amount")
    if missing_cols:
        raise HTTPException(
            status_code=400,
            detail=f"CSV is missing required column(s): {', '.join(missing_cols)}. Your file must have a header row with: Description, Date, Amount.",
        )

    def normalize_date(s: str) -> Optional[str]:
        s = (s or "").strip()
        if not s:
            return None
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d.%m.%Y", "%Y/%m/%d", "%m/%d/%Y"):
            try:
                return datetime.strptime(s, fmt).strftime("%d/%m/%Y")
            except ValueError:
                continue
        return None

    rows_imported = 0
    errors = []
    items = []
    for i, row in enumerate(reader, start=2):
        desc = (row.get(f_desc) or "").strip()
        raw_date = (row.get(f_date) or "").strip()
        raw_amount = (row.get(f_amount) or "").strip()

        row_errors = []
        if not desc:
            row_errors.append("Description is empty")
        if not raw_date:
            row_errors.append("Date is empty")
            norm_date = ""
        else:
            norm_date = normalize_date(raw_date)
            if norm_date is None:
                row_errors.append(f"Date '{raw_date}' is not a recognised format (expected DD/MM/YYYY)")
                norm_date = ""
        if not raw_amount:
            row_errors.append("Amount is empty")

        if row_errors:
            errors.append(f"Row {i}: {'; '.join(row_errors)}")
            continue

        items.append(
            {
                "id": new_id(),
                "client_id": client_id,
                "type": type,
                "description": desc,
                "date": norm_date,
                "amount": raw_amount,
                "status": "outstanding",
                "created_at": utc_now_iso(),
            }
        )
        rows_imported += 1

    await session.execute(delete(outstanding_items).where(outstanding_items.c.client_id == client_id, outstanding_items.c.type == type))
    if items:
        await session.execute(insert(outstanding_items), items)
    await session.commit()

    return {"rows_imported": rows_imported, "errors": errors}


# ---------- Admin: SMTP Settings ----------
@api.get("/admin/settings/smtp")
async def get_smtp(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    s = await one(session, select(settings).where(settings.c.key == "smtp"))
    if not s:
        return {"host": "", "port": 587, "username": "", "sender_email": "", "sender_name": "", "use_tls": True, "configured": False}
    return {
        "host": s.get("host", ""),
        "port": s.get("port", 587),
        "username": s.get("username", ""),
        "sender_email": s.get("sender_email", ""),
        "sender_name": s.get("sender_name", ""),
        "use_tls": bool(s.get("use_tls", True)),
        "configured": bool(s.get("password_enc")),
    }


@api.put("/admin/settings/smtp")
async def update_smtp(
    payload: SMTPSettingsIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    existing = await one(session, select(settings).where(settings.c.key == "smtp")) or {}
    values = {
        "key": "smtp",
        "host": payload.host.strip(),
        "port": int(payload.port),
        "username": payload.username.strip(),
        "sender_email": payload.sender_email.lower().strip(),
        "sender_name": payload.sender_name.strip(),
        "use_tls": payload.use_tls,
    }
    if payload.password:
        pw = payload.password
        if payload.aws_iam_secret:
            region = parse_ses_region(payload.host)
            if not region:
                raise HTTPException(status_code=400, detail="Could not detect AWS region from the SMTP host. Use the Amazon SES host format 'email-smtp.<region>.amazonaws.com' (e.g. email-smtp.eu-west-2.amazonaws.com).")
            pw = derive_ses_smtp_password(payload.password, region)
        values["password_enc"] = fernet.encrypt(pw.encode()).decode()
    elif existing.get("password_enc"):
        values["password_enc"] = existing["password_enc"]
    else:
        values["password_enc"] = None

    if existing:
        await session.execute(update(settings).where(settings.c.key == "smtp").values(**values))
    else:
        await session.execute(insert(settings).values(**values))
    await session.commit()
    return {"ok": True}


@api.delete("/admin/settings/smtp")
async def clear_smtp(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    await session.execute(delete(settings).where(settings.c.key == "smtp"))
    await session.commit()
    return {"ok": True}


@api.get("/admin/settings/openai")
async def get_openai_settings(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    s = await one(session, select(settings).where(settings.c.key == "openai"))
    env_key = bool(os.environ.get("OPENAI_API_KEY"))
    configured = env_key or bool(s and s.get("openai_api_key_enc"))
    return {
        "model": (s or {}).get("openai_model") or os.environ.get("OPENAI_INVOICE_CHECK_MODEL", "gpt-5.6-luna"),
        "configured": configured,
        "source": "environment" if env_key else ("saved" if configured else "missing"),
    }


@api.put("/admin/settings/openai")
async def update_openai_settings(
    payload: OpenAISettingsIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    existing = await one(session, select(settings).where(settings.c.key == "openai")) or {}
    model = (payload.model or "gpt-5.6-luna").strip()
    values = {"key": "openai", "openai_model": model}
    if payload.api_key and payload.api_key.strip():
        values["openai_api_key_enc"] = fernet.encrypt(payload.api_key.strip().encode()).decode()
    elif existing.get("openai_api_key_enc"):
        values["openai_api_key_enc"] = existing["openai_api_key_enc"]
    else:
        values["openai_api_key_enc"] = None

    if existing:
        await session.execute(update(settings).where(settings.c.key == "openai").values(**values))
    else:
        await session.execute(insert(settings).values(**values))
    await session.commit()
    return {"ok": True}


@api.delete("/admin/settings/openai")
async def clear_openai_settings(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    await session.execute(delete(settings).where(settings.c.key == "openai"))
    await session.commit()
    return {"ok": True}


async def get_feature_settings(session: AsyncSession) -> dict:
    s = await one(session, select(settings).where(settings.c.key == "features"))
    enabled = True if not s or s.get("document_processing_enabled") is None else bool(s.get("document_processing_enabled"))
    return {"document_processing_enabled": enabled}


@api.get("/admin/settings/features")
async def get_admin_feature_settings(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    return await get_feature_settings(session)


@api.put("/admin/settings/features")
async def update_admin_feature_settings(
    payload: FeatureSettingsIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    existing = await one(session, select(settings).where(settings.c.key == "features")) or {}
    values = {
        "key": "features",
        "document_processing_enabled": bool(payload.document_processing_enabled),
    }
    if existing:
        await session.execute(update(settings).where(settings.c.key == "features").values(**values))
    else:
        await session.execute(insert(settings).values(**values))
    await session.commit()
    return await get_feature_settings(session)


def normalise_accountancy_services(raw: Any) -> list[dict]:
    source = raw if isinstance(raw, list) and raw else DEFAULT_ACCOUNTANCY_SERVICES
    if source is not DEFAULT_ACCOUNTANCY_SERVICES:
        source_keys = {
            re.sub(r"[^a-z0-9_]+", "_", str(item.get("key") or item.get("label") or "").lower()).strip("_")
            for item in source
            if isinstance(item, dict)
        }
        source = list(source) + [item for item in DEFAULT_ACCOUNTANCY_SERVICES if item["key"] not in source_keys]
    statutory_keys = {item["key"] for item in DEFAULT_ACCOUNTANCY_STATUTORY_DEADLINES}
    services = []
    seen = set()
    for item in source:
        if not isinstance(item, dict):
            continue
        key = re.sub(r"[^a-z0-9_]+", "_", str(item.get("key") or item.get("label") or "").lower()).strip("_")
        label = str(item.get("label") or "").strip()
        if not key or not label or key in seen:
            continue
        recurrence = item.get("recurrence") or None
        if recurrence not in (None, "weekly", "monthly", "quarterly", "half_year", "annual"):
            recurrence = None
        deadline = item.get("deadline") or None
        if deadline in ("companies_house_accounts", "companies_house_confirmation"):
            deadline = None
            recurrence = None
        if deadline not in (None, "scheduled", "statutory"):
            deadline = "scheduled" if recurrence else None
        start_date = None
        statutory_key = str(item.get("statutory_key") or "").strip() or None
        if statutory_key and statutory_key not in statutory_keys:
            statutory_key = None
        if deadline == "statutory":
            recurrence = None
            start_date = None
        elif deadline == "scheduled":
            statutory_key = None
        else:
            recurrence = None
            statutory_key = None
        day = item.get("day_of_month")
        try:
            day = int(day) if day not in (None, "") else None
        except (TypeError, ValueError):
            day = None
        if day is not None:
            day = max(1, min(31, day))
        services.append({
            "key": key,
            "label": label,
            "deadline": deadline,
            "recurrence": recurrence,
            "start_date": start_date,
            "statutory_key": statutory_key,
            "day_of_month": day,
            "enabled": bool(item.get("enabled", True)),
        })
        seen.add(key)
    return services or DEFAULT_ACCOUNTANCY_SERVICES


def normalise_accountancy_client_types(raw: Any, services: Optional[list[dict]] = None) -> list[dict]:
    source = raw if isinstance(raw, list) and raw else DEFAULT_ACCOUNTANCY_CLIENT_TYPES
    service_keys = {service["key"] for service in (services or DEFAULT_ACCOUNTANCY_SERVICES)}
    client_types = []
    seen = set()
    for item in source:
        if not isinstance(item, dict):
            continue
        key = re.sub(r"[^a-z0-9_]+", "_", str(item.get("key") or item.get("label") or "").lower()).strip("_")
        label = str(item.get("label") or "").strip()
        if not key or not label or key in seen:
            continue
        allocations = []
        for service_key in item.get("service_keys") or []:
            service_key = str(service_key).strip()
            if service_key in service_keys and service_key not in allocations:
                allocations.append(service_key)
        client_types.append({"key": key, "label": label, "service_keys": allocations})
        seen.add(key)
    return client_types or DEFAULT_ACCOUNTANCY_CLIENT_TYPES


def normalise_accountancy_statutory_deadlines(raw: Any) -> list[dict]:
    source = raw if isinstance(raw, list) and raw else DEFAULT_ACCOUNTANCY_STATUTORY_DEADLINES
    defaults_by_key = {item["key"]: item for item in DEFAULT_ACCOUNTANCY_STATUTORY_DEADLINES}
    deadlines = []
    seen = set()
    for item in source:
        if not isinstance(item, dict):
            continue
        key = re.sub(r"[^a-z0-9_]+", "_", str(item.get("key") or item.get("label") or "").lower()).strip("_")
        label = str(item.get("label") or "").strip()
        source_name = str(item.get("source") or "").strip()
        if not key or not label or not source_name or key in seen:
            continue
        default = defaults_by_key.get(key, {})
        deadlines.append({
            "key": key,
            "label": label,
            "source": source_name,
            "description": str(item.get("description") or default.get("description") or "").strip(),
            "rule_description": str(item.get("rule_description") or default.get("rule_description") or "").strip(),
            "ai_update_enabled": bool(item.get("ai_update_enabled", True)),
            "enabled": bool(item.get("enabled", True)),
        })
        seen.add(key)
    return deadlines or DEFAULT_ACCOUNTANCY_STATUTORY_DEADLINES


async def get_accountancy_services_payload(session: AsyncSession) -> dict:
    saved = await one(session, select(settings).where(settings.c.key == "accountancy_services"))
    if saved and saved.get("accountancy_services"):
        try:
            return {"services": normalise_accountancy_services(json.loads(saved["accountancy_services"]))}
        except Exception:
            logger.warning("Could not parse saved accountancy services", exc_info=True)
    return {"services": DEFAULT_ACCOUNTANCY_SERVICES}


async def get_accountancy_client_types_payload(session: AsyncSession) -> dict:
    services = (await get_accountancy_services_payload(session))["services"]
    saved = await one(session, select(settings).where(settings.c.key == "accountancy_client_types"))
    if saved and saved.get("accountancy_client_types"):
        try:
            return {"client_types": normalise_accountancy_client_types(json.loads(saved["accountancy_client_types"]), services)}
        except Exception:
            logger.warning("Could not parse saved accountancy client types", exc_info=True)
    return {"client_types": normalise_accountancy_client_types(DEFAULT_ACCOUNTANCY_CLIENT_TYPES, services)}


async def get_accountancy_statutory_deadlines_payload(session: AsyncSession) -> dict:
    saved = await one(session, select(settings).where(settings.c.key == "accountancy_statutory_deadlines"))
    if saved and saved.get("accountancy_statutory_deadlines"):
        try:
            return {"statutory_deadlines": normalise_accountancy_statutory_deadlines(json.loads(saved["accountancy_statutory_deadlines"]))}
        except Exception:
            logger.warning("Could not parse saved accountancy statutory deadlines", exc_info=True)
    return {"statutory_deadlines": DEFAULT_ACCOUNTANCY_STATUTORY_DEADLINES}


@api.get("/admin/accountancy/services")
async def get_accountancy_services(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    return await get_accountancy_services_payload(session)


@api.put("/admin/accountancy/services")
async def update_accountancy_services(
    payload: AccountancyServicesIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    services = normalise_accountancy_services([service.model_dump() for service in payload.services])
    existing = await one(session, select(settings).where(settings.c.key == "accountancy_services")) or {}
    values = {"key": "accountancy_services", "accountancy_services": json_compact(services)}
    if existing:
        await session.execute(update(settings).where(settings.c.key == "accountancy_services").values(**values))
    else:
        await session.execute(insert(settings).values(**values))
    await session.commit()
    return {"services": services}


@api.get("/admin/accountancy/client-types")
async def get_accountancy_client_types(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    return await get_accountancy_client_types_payload(session)


@api.put("/admin/accountancy/client-types")
async def update_accountancy_client_types(
    payload: AccountancyClientTypesIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    services = (await get_accountancy_services_payload(session))["services"]
    client_types = normalise_accountancy_client_types([client_type.model_dump() for client_type in payload.client_types], services)
    existing = await one(session, select(settings).where(settings.c.key == "accountancy_client_types")) or {}
    values = {"key": "accountancy_client_types", "accountancy_client_types": json_compact(client_types)}
    if existing:
        await session.execute(update(settings).where(settings.c.key == "accountancy_client_types").values(**values))
    else:
        await session.execute(insert(settings).values(**values))
    await session.commit()
    return {"client_types": client_types}


@api.get("/admin/accountancy/statutory-deadlines")
async def get_accountancy_statutory_deadlines(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_db)):
    return await get_accountancy_statutory_deadlines_payload(session)


@api.put("/admin/accountancy/statutory-deadlines")
async def update_accountancy_statutory_deadlines(
    payload: AccountancyStatutoryDeadlinesIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    statutory_deadlines = normalise_accountancy_statutory_deadlines([item.model_dump() for item in payload.statutory_deadlines])
    existing = await one(session, select(settings).where(settings.c.key == "accountancy_statutory_deadlines")) or {}
    values = {"key": "accountancy_statutory_deadlines", "accountancy_statutory_deadlines": json_compact(statutory_deadlines)}
    if existing:
        await session.execute(update(settings).where(settings.c.key == "accountancy_statutory_deadlines").values(**values))
    else:
        await session.execute(insert(settings).values(**values))
    await session.commit()
    return {"statutory_deadlines": statutory_deadlines}


async def require_document_processing_module(session: AsyncSession):
    features = await get_feature_settings(session)
    if not features["document_processing_enabled"]:
        raise HTTPException(status_code=403, detail="Document processing module is disabled")


async def get_openai_runtime_settings(session: AsyncSession) -> dict:
    env_key = os.environ.get("OPENAI_API_KEY")
    env_model = os.environ.get("OPENAI_INVOICE_CHECK_MODEL")
    s = await one(session, select(settings).where(settings.c.key == "openai"))
    api_key = env_key
    if not api_key and s and s.get("openai_api_key_enc"):
        try:
            api_key = fernet.decrypt(s["openai_api_key_enc"].encode()).decode()
        except Exception:
            logger.exception("Failed to decrypt saved OpenAI API key")
            api_key = None
    return {
        "api_key": api_key,
        "model": env_model or (s or {}).get("openai_model") or "gpt-5.6-luna",
    }


async def get_smtp_settings() -> Optional[dict]:
    async with SessionLocal() as session:
        s = await one(session, select(settings).where(settings.c.key == "smtp"))
    if not s or not s.get("password_enc"):
        return None
    pw = fernet.decrypt(s["password_enc"].encode()).decode()
    return {**s, "password": pw}


# ---------- Client: Outstanding & Submissions ----------
@api.get("/client/counts")
async def client_counts(user: dict = Depends(require_client), session: AsyncSession = Depends(get_db)):
    cid = user["id"]
    p = await count_rows(session, outstanding_items, outstanding_items.c.client_id == cid, outstanding_items.c.type == "purchase")
    s = await count_rows(session, outstanding_items, outstanding_items.c.client_id == cid, outstanding_items.c.type == "sales")
    return {"purchase_outstanding": p, "sales_outstanding": s}


@api.get("/client/items")
async def client_items(type: str, user: dict = Depends(require_client), session: AsyncSession = Depends(get_db)):
    if type not in ("purchase", "sales"):
        raise HTTPException(status_code=400, detail="invalid type")
    docs = await many(
        session,
        select(outstanding_items)
        .where(outstanding_items.c.client_id == user["id"], outstanding_items.c.type == type)
    )
    return [serialize_item(d) for d in sort_items_by_date(docs)]


@api.get("/client/items/{item_id}")
async def client_item(item_id: str, user: dict = Depends(require_client), session: AsyncSession = Depends(get_db)):
    d = await one(
        session,
        select(outstanding_items).where(outstanding_items.c.id == item_id, outstanding_items.c.client_id == user["id"]),
    )
    if not d:
        raise HTTPException(status_code=404, detail="Item not found")
    return serialize_item(d)


def stamp_image(image_bytes: bytes, comment: str, submitted_at: datetime) -> bytes:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    max_w = 1600
    if img.width > max_w:
        ratio = max_w / img.width
        img = img.resize((max_w, int(img.height * ratio)))

    W, H = img.size
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    timestamp = submitted_at.strftime("%d %b %Y - %H:%M UTC")
    title_size = max(48, W // 18)
    body_size = max(40, W // 24)
    font_title = load_font(True, title_size)
    font_body = load_font(True, body_size)

    def wrap(text: str, font, max_width: int) -> List[str]:
        words = text.split()
        lines = []
        cur = ""
        for w in words:
            test = (cur + " " + w).strip()
            if draw.textlength(test, font=font) <= max_width:
                cur = test
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines or [""]

    pad = max(28, W // 40)
    inner_w = W - 2 * pad
    comment_lines = wrap(comment or "", font_body, inner_w)
    title_h = int(title_size * 1.2)
    body_h = int(body_size * 1.35)
    gap = max(12, body_size // 2)
    block_h = pad + title_h + gap + len(comment_lines) * body_h + pad

    draw.rectangle([(0, H - block_h), (W, H)], fill=(0, 0, 0, 180))
    draw.rectangle([(pad, H - block_h + pad - 10), (pad + 90, H - block_h + pad - 4)], fill=(192, 94, 68, 235))

    y = H - block_h + pad
    draw.text((pad, y), timestamp, font=font_title, fill=(255, 255, 255, 255))
    y += title_h + gap
    for line in comment_lines:
        draw.text((pad, y), line, font=font_body, fill=(245, 245, 245, 245))
        y += body_h

    composed = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    out = io.BytesIO()
    composed.save(out, format="JPEG", quality=88)
    return out.getvalue()


def stamp_pdf(pdf_bytes: bytes, comment: str, submitted_at: datetime) -> bytes:
    from pypdf import PdfReader, PdfWriter
    from reportlab.lib.colors import Color, black
    from reportlab.pdfgen import canvas

    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    stamp_lines = [
        "CLIENT SUBMISSION",
        f"Submitted: {submitted_at.strftime('%d %b %Y %H:%M UTC')}",
    ]
    for line in (comment or "").splitlines():
        text = line.strip()
        if text:
            stamp_lines.append(text[:120])
    stamp_lines = stamp_lines[:7]

    for page in reader.pages:
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        packet = io.BytesIO()
        c = canvas.Canvas(packet, pagesize=(width, height))
        margin = 24
        box_height = 18 + (len(stamp_lines) * 13)
        y = margin

        c.setFillColor(Color(1, 0.97, 0.84, alpha=0.92))
        c.setStrokeColor(Color(0.84, 0.45, 0.04, alpha=0.95))
        c.roundRect(margin, y, width - (margin * 2), box_height, 6, fill=1, stroke=1)
        c.setFillColor(black)
        c.setFont("Helvetica-Bold", 9)
        line_y = y + box_height - 16
        c.drawString(margin + 10, line_y, stamp_lines[0])
        c.setFont("Helvetica", 8)
        for text in stamp_lines[1:]:
            line_y -= 13
            c.drawString(margin + 10, line_y, text)
        c.save()

        packet.seek(0)
        overlay = PdfReader(packet)
        page.merge_page(overlay.pages[0])
        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def render_submission_note_pdf(comment: str, submitted_at: datetime) -> bytes:
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    packet = io.BytesIO()
    width, height = A4
    c = canvas.Canvas(packet, pagesize=A4)
    margin = 56
    y = height - 72

    c.setFillColor(HexColor("#172b26"))
    c.setFont("Helvetica-Bold", 22)
    c.drawString(margin, y, "Client submission note")

    y -= 34
    c.setFillColor(HexColor("#5f5a52"))
    c.setFont("Helvetica", 11)
    c.drawString(margin, y, f"Submitted: {submitted_at.strftime('%d %b %Y - %H:%M UTC')}")

    y -= 34
    c.setStrokeColor(HexColor("#c05e44"))
    c.setLineWidth(3)
    c.line(margin, y, margin + 110, y)

    y -= 42
    c.setFillColor(HexColor("#2f2b26"))
    c.setFont("Helvetica-Bold", 13)
    c.drawString(margin, y, "Comment / approval note")

    y -= 26
    c.setFont("Helvetica", 11)
    note = (comment or "(no comment provided)").strip()
    for raw_line in note.splitlines() or [note]:
        lines = textwrap.wrap(raw_line.strip(), width=88) or [""]
        for line in lines:
            if y < 70:
                c.showPage()
                y = height - 72
                c.setFillColor(HexColor("#2f2b26"))
                c.setFont("Helvetica", 11)
            c.drawString(margin, y, line)
            y -= 17
        y -= 6

    c.save()
    packet.seek(0)
    return packet.getvalue()


def append_submission_note_page(pdf_bytes: bytes, comment: str, submitted_at: datetime) -> bytes:
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    original = PdfReader(io.BytesIO(pdf_bytes))
    for page in original.pages:
        writer.add_page(page)

    note_pdf = PdfReader(io.BytesIO(render_submission_note_pdf(comment, submitted_at)))
    for page in note_pdf.pages:
        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def render_image_with_note_pdf(image_bytes: bytes, comment: str, submitted_at: datetime) -> bytes:
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image_buffer = io.BytesIO()
    image.save(image_buffer, format="JPEG", quality=90)
    image_buffer.seek(0)

    packet = io.BytesIO()
    page_w, page_h = A4
    margin = 36
    max_w = page_w - (margin * 2)
    max_h = page_h - (margin * 2)
    scale = min(max_w / image.width, max_h / image.height)
    draw_w = image.width * scale
    draw_h = image.height * scale
    x = (page_w - draw_w) / 2
    y = (page_h - draw_h) / 2

    c = canvas.Canvas(packet, pagesize=A4)
    c.setFillColor(HexColor("#ffffff"))
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)
    c.drawImage(ImageReader(image_buffer), x, y, width=draw_w, height=draw_h)
    c.save()
    packet.seek(0)

    return append_submission_note_page(packet.getvalue(), comment, submitted_at)


def render_document_page(title: str, comment: str, submitted_at: datetime) -> bytes:
    """Render a clean white A4-style page containing the invoice description,
    the submission timestamp and the client's comment. Used when the client
    submits without a photo so an image attachment is always produced."""
    W, H = 1240, 1754  # ~A4 at 150dpi
    img = Image.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    try:
        font_h1 = load_font(True, 64)
        font_label = load_font(True, 30)
        font_body = load_font(False, 40)
        font_meta = load_font(False, 34)
    except Exception:
        font_h1 = font_label = font_body = font_meta = ImageFont.load_default()

    def wrap(text: str, font, max_width: int) -> List[str]:
        lines, cur = [], ""
        for w in (text or "").split():
            test = (cur + " " + w).strip()
            if draw.textlength(test, font=font) <= max_width:
                cur = test
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines or [""]

    margin = 90
    inner_w = W - 2 * margin

    # Brand accent bar at top
    draw.rectangle([(0, 0), (W, 18)], fill=(23, 43, 38))
    draw.rectangle([(margin, 90), (margin + 120, 100)], fill=(192, 94, 68))

    y = 130
    for line in wrap(title or "Additional invoice", font_h1, inner_w):
        draw.text((margin, y), line, font=font_h1, fill=(23, 43, 38))
        y += 78

    y += 30
    draw.line([(margin, y), (W - margin, y)], fill=(220, 216, 208), width=2)
    y += 40

    draw.text((margin, y), "SUBMITTED", font=font_label, fill=(150, 145, 135))
    y += 42
    draw.text((margin, y), submitted_at.strftime("%d %b %Y · %H:%M UTC"), font=font_meta, fill=(60, 60, 60))
    y += 80

    draw.text((margin, y), "COMMENT", font=font_label, fill=(150, 145, 135))
    y += 50
    for line in wrap(comment or "(no comment provided)", font_body, inner_w):
        draw.text((margin, y), line, font=font_body, fill=(40, 40, 40))
        y += 56

    # Footer note
    draw.text((margin, H - 90), "No photo was provided — this page was generated automatically.",
              font=font_meta, fill=(170, 165, 158))

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=90)
    return out.getvalue()


def upload_content_type(file: UploadFile) -> str:
    guessed, _ = mimetypes.guess_type(file.filename or "")
    return (file.content_type or guessed or "application/octet-stream").split(";")[0].lower()


def is_supported_document(file: UploadFile) -> bool:
    content_type = upload_content_type(file)
    if content_type in SUPPORTED_DOCUMENT_TYPES:
        return True
    suffix = Path(file.filename or "").suffix.lower()
    return suffix in SUPPORTED_DOCUMENT_SUFFIXES


def is_image_document(file: UploadFile) -> bool:
    content_type = upload_content_type(file)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix == ".pdf" or content_type == "application/pdf":
        return False
    return content_type in SUPPORTED_IMAGE_TYPES or suffix in SUPPORTED_IMAGE_SUFFIXES


def is_pdf_document(file: UploadFile) -> bool:
    content_type = upload_content_type(file)
    suffix = Path(file.filename or "").suffix.lower()
    return content_type == "application/pdf" or suffix == ".pdf"


def upload_extension(file: UploadFile, fallback: str = ".bin") -> str:
    content_type = upload_content_type(file)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix in SUPPORTED_DOCUMENT_SUFFIXES:
        return ".jpg" if suffix == ".jpeg" else suffix
    return SUPPORTED_DOCUMENT_TYPES.get(content_type, fallback)


def attachment_mime(path: str) -> tuple[str, str]:
    mime_type, _ = mimetypes.guess_type(path)
    maintype, subtype = (mime_type or "application/octet-stream").split("/", 1)
    return maintype, subtype


CODING_FIELD_KEYS = (
    "vendor_name",
    "vendor_account",
    "category",
    "date",
    "due_date",
    "description",
    "document_type",
    "bill_number",
    "reference",
    "net",
    "vat",
    "total",
    "vat_code",
    "currency",
    "payment_method",
    "mark_as_paid",
    "bank_account",
    "price_is",
    "line_items",
    "ocr_text_lines",
    "ocr_text_boxes",
)


def parse_money_value(value: str) -> Optional[float]:
    text_value = str(value or "").replace(",", "")
    match = re.search(r"-?\d+(?:\.\d{1,2})?", text_value)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def format_money_value(value: float) -> str:
    return f"{value:.2f}"


def first_reference_candidate(lines: list[str]) -> str:
    keywords = ("receipt", "ref", "reference", "auth", "approval", "transaction", "trans", "txn", "invoice", "inv", "till", "terminal")
    for line in lines:
        if any(keyword in line.lower() for keyword in keywords):
            cleaned = re.sub(r"\s+", " ", line).strip()
            if cleaned:
                return cleaned[:128]
    for line in lines:
        if re.search(r"\d{4,}", line):
            cleaned = re.sub(r"\s+", " ", line).strip()
            if cleaned:
                return cleaned[:128]
    return ""


def captured_lines_from_fields(fields: dict) -> list[str]:
    lines = []
    for key in ("vendor_name", "date", "bill_number", "reference", "net", "vat", "total", "payment_method"):
        value = str(fields.get(key) or "").strip()
        if value:
            lines.append(value)
    for line in fields.get("line_items") or []:
        if not isinstance(line, dict):
            continue
        parts = [
            str(line.get("description") or "").strip(),
            str(line.get("units") or "").strip(),
            str(line.get("price") or line.get("net") or "").strip(),
            str(line.get("vat") or "").strip(),
            str(line.get("total") or "").strip(),
        ]
        text = " ".join(part for part in parts if part)
        if text:
            lines.append(text[:300])
    deduped = []
    seen = set()
    for line in lines:
        if line in seen:
            continue
        seen.add(line)
        deduped.append(line)
    return deduped[:120]


def normalize_ocr_text_boxes(value) -> list[dict]:
    boxes = value if isinstance(value, list) else []
    normalized = []
    for box in boxes[:160]:
        if not isinstance(box, dict):
            continue
        text = str(box.get("text") or "").strip()
        if not text:
            continue
        def bounded_float(raw, default=0.0):
            try:
                number = float(raw)
            except (TypeError, ValueError):
                return default
            return min(1.0, max(0.0, number))

        normalized.append({
            "text": text[:300],
            "page": max(1, int(box.get("page") or 1)),
            "x": bounded_float(box.get("x")),
            "y": bounded_float(box.get("y")),
            "width": bounded_float(box.get("width"), 0.2),
            "height": bounded_float(box.get("height"), 0.025),
        })
    return normalized


def reconcile_coding_totals(fields: dict) -> dict:
    total_value = parse_money_value(fields.get("total"))
    vat_value = parse_money_value(fields.get("vat"))
    net_value = parse_money_value(fields.get("net"))
    if net_value is None and total_value is not None:
        fields["net"] = format_money_value(total_value - vat_value) if vat_value is not None else format_money_value(total_value)
        net_value = parse_money_value(fields["net"])
    if total_value is None and net_value is not None:
        fields["total"] = format_money_value(net_value + vat_value) if vat_value is not None else format_money_value(net_value)
        total_value = parse_money_value(fields["total"])

    line_items = fields.get("line_items") if isinstance(fields.get("line_items"), list) else []
    line_total_sum = 0.0
    line_net_sum = 0.0
    line_vat_sum = 0.0
    counted_total = 0
    counted_net = 0
    counted_vat = 0
    for line in line_items:
        if not isinstance(line, dict):
            continue
        line_total = parse_money_value(line.get("total"))
        line_vat = parse_money_value(line.get("vat"))
        line_net = parse_money_value(line.get("net"))
        if line_net is None and line_total is not None:
            line["net"] = format_money_value(line_total - line_vat) if line_vat is not None else format_money_value(line_total)
            line_net = parse_money_value(line["net"])
        if line_total is None and line_net is not None:
            line["total"] = format_money_value(line_net + line_vat) if line_vat is not None else format_money_value(line_net)
            line_total = parse_money_value(line["total"])
        if not str(line.get("price") or "").strip():
            line["price"] = line.get("net") or line.get("total") or ""
        if line_total is not None:
            line_total_sum += line_total
            counted_total += 1
        if line_net is not None:
            line_net_sum += line_net
            counted_net += 1
        if line_vat is not None:
            line_vat_sum += line_vat
            counted_vat += 1

    if len(line_items) == 1:
        line = line_items[0]
        if total_value is not None:
            line["total"] = format_money_value(total_value)
        if net_value is not None:
            line["net"] = format_money_value(net_value)
        if vat_value is not None:
            line["vat"] = format_money_value(vat_value)
        if not str(line.get("price") or "").strip():
            line["price"] = line.get("net") or line.get("total") or ""
    elif len(line_items) > 1:
        if total_value is None and counted_total:
            fields["total"] = format_money_value(line_total_sum)
        if net_value is None and counted_net:
            fields["net"] = format_money_value(line_net_sum)
        if vat_value is None and counted_vat:
            fields["vat"] = format_money_value(line_vat_sum)

    if parse_money_value(fields.get("net")) is None and parse_money_value(fields.get("total")) is not None and parse_money_value(fields.get("vat")) is None:
        fields["net"] = fields["total"]
    return fields


def normalize_ai_coding_fields(data: dict) -> dict:
    source = data.get("coding_fields") if isinstance(data.get("coding_fields"), dict) else {}
    ocr_text_lines = source.get("ocr_text_lines") if isinstance(source.get("ocr_text_lines"), list) else []
    ocr_text_lines = [str(line).strip()[:300] for line in ocr_text_lines if str(line or "").strip()][:120]
    ocr_text_boxes = normalize_ocr_text_boxes(source.get("ocr_text_boxes"))
    fields = {
        "vendor_name": str(source.get("vendor_name") or "").strip()[:255],
        "vendor_account": str(source.get("vendor_account") or "").strip()[:255],
        "category": str(source.get("category") or "").strip()[:255],
        "date": str(source.get("date") or "").strip()[:32],
        "due_date": str(source.get("due_date") or "").strip()[:32],
        "description": str(source.get("description") or "").strip()[:500],
        "document_type": str(source.get("document_type") or "bill").strip()[:32],
        "bill_number": str(source.get("bill_number") or "").strip()[:128],
        "reference": str(source.get("reference") or "").strip()[:128],
        "net": str(source.get("net") or "").strip()[:64],
        "vat": str(source.get("vat") or "").strip()[:64],
        "total": str(source.get("total") or "").strip()[:64],
        "vat_code": str(source.get("vat_code") or "").strip()[:64],
        "currency": str(source.get("currency") or "GBP").strip()[:8] or "GBP",
        "payment_method": str(source.get("payment_method") or data.get("payment_method") or "not_clear").strip()[:64],
        "mark_as_paid": bool(source.get("mark_as_paid")),
        "bank_account": "",
        "price_is": str(source.get("price_is") or "Tax Exclusive").strip()[:32],
        "line_items": [],
        "ocr_text_lines": ocr_text_lines,
        "ocr_text_boxes": ocr_text_boxes,
    }
    if fields["document_type"] not in ("bill", "credit_note"):
        fields["document_type"] = "bill"
    if not fields["reference"]:
        fields["reference"] = first_reference_candidate(ocr_text_lines)
    if not fields["bill_number"]:
        fields["bill_number"] = fields["reference"]
    line_items = source.get("line_items") if isinstance(source.get("line_items"), list) else []
    for line in line_items[:80]:
        if not isinstance(line, dict):
            continue
        line_net = str(line.get("net") or "").strip()[:64]
        line_vat = str(line.get("vat") or "").strip()[:64]
        line_total = str(line.get("total") or "").strip()[:64]
        line_price = str(line.get("price") or "").strip()[:64]
        line_total_value = parse_money_value(line_total)
        line_vat_value = parse_money_value(line_vat)
        line_net_value = parse_money_value(line_net)
        if line_net_value is None and line_total_value is not None and line_vat_value is not None:
            line_net = format_money_value(line_total_value - line_vat_value)
        if line_total_value is None and line_net_value is not None and line_vat_value is not None:
            line_total = format_money_value(line_net_value + line_vat_value)
        if not line_price:
            line_price = line_net or line_total
        fields["line_items"].append({
            "description": str(line.get("description") or "").strip()[:500],
            "category": str(line.get("category") or "").strip()[:255],
            "vat_code": str(line.get("vat_code") or "").strip()[:64],
            "units": str(line.get("units") or "1").strip()[:64],
            "price": line_price,
            "net": line_net,
            "vat": line_vat,
            "total": line_total,
        })
    if not fields["line_items"] and (fields["description"] or fields["total"] or fields["net"] or fields["vat"]):
        fields["line_items"].append({
            "description": fields["description"] or fields["vendor_name"] or "Receipt",
            "category": fields["category"],
            "vat_code": fields["vat_code"],
            "units": "1",
            "price": fields["net"] or fields["total"],
            "net": fields["net"],
            "vat": fields["vat"],
            "total": fields["total"],
        })
    fields = reconcile_coding_totals(fields)
    if not fields["ocr_text_lines"]:
        fields["ocr_text_lines"] = captured_lines_from_fields(fields)
    return fields


def normalize_line_items(value) -> list[dict]:
    line_items = value if isinstance(value, list) else []
    normalized = []
    for line in line_items[:80]:
        if not isinstance(line, dict):
            continue
        line_net = str(line.get("net") or "").strip()[:64]
        line_vat = str(line.get("vat") or "").strip()[:64]
        line_total = str(line.get("total") or "").strip()[:64]
        line_price = str(line.get("price") or "").strip()[:64]
        line_total_value = parse_money_value(line_total)
        line_vat_value = parse_money_value(line_vat)
        line_net_value = parse_money_value(line_net)
        if line_net_value is None and line_total_value is not None and line_vat_value is not None:
            line_net = format_money_value(line_total_value - line_vat_value)
        if line_total_value is None and line_net_value is not None and line_vat_value is not None:
            line_total = format_money_value(line_net_value + line_vat_value)
        if not line_price:
            line_price = line_net or line_total
        normalized.append({
            "description": str(line.get("description") or "").strip()[:500],
            "category": str(line.get("category") or "").strip()[:255],
            "vat_code": str(line.get("vat_code") or "").strip()[:64],
            "units": str(line.get("units") or "1").strip()[:64],
            "price": line_price,
            "net": line_net,
            "vat": line_vat,
            "total": line_total,
        })
    return normalized


def build_openai_document_part(document_bytes: bytes, content_type: str, filename: Optional[str]) -> dict:
    suffix = Path(filename or "").suffix.lower()
    guessed_content_type, _ = mimetypes.guess_type(filename or "")
    safe_content_type = (content_type or guessed_content_type or "application/octet-stream").split(";")[0].lower()
    encoded_document = base64.b64encode(document_bytes).decode("ascii")
    if safe_content_type == "application/pdf" or suffix == ".pdf":
        safe_filename = Path(filename or "submitted-document.pdf").name or "submitted-document.pdf"
        pdf_data_url = f"data:application/pdf;base64,{encoded_document}"
        return {"type": "input_file", "filename": safe_filename, "file_data": pdf_data_url, "detail": "high"}
    if safe_content_type in SUPPORTED_IMAGE_TYPES or suffix in SUPPORTED_IMAGE_SUFFIXES:
        image_content_type = safe_content_type if safe_content_type in SUPPORTED_IMAGE_TYPES else (guessed_content_type or "image/jpeg")
        data_url = f"data:{image_content_type};base64,{encoded_document}"
        return {"type": "input_image", "image_url": data_url, "detail": "high"}
    raise HTTPException(status_code=400, detail="AI document check can only review image or PDF files.")


def parse_json_object(value: Optional[str]) -> Optional[dict]:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


async def get_coding_history(session: AsyncSession, client_id: str, doc_type: str, limit: int = 12) -> list[dict]:
    docs = await many(
        session,
        select(submissions.c.coding_fields, submissions.c.description, submissions.c.reviewed_at)
        .where(
            submissions.c.client_id == client_id,
            submissions.c.type == doc_type,
            submissions.c.review_status == "published",
            submissions.c.coding_fields.is_not(None),
        )
        .order_by(submissions.c.reviewed_at.desc())
        .limit(limit),
    )
    history = []
    for row in docs:
        fields = parse_json_object(row.get("coding_fields"))
        if not fields:
            continue
        history.append({
            "vendor_name": fields.get("vendor_name", ""),
            "vendor_account": fields.get("vendor_account", ""),
            "category": fields.get("category", ""),
            "document_type": fields.get("document_type", "bill"),
            "bill_number_style": fields.get("bill_number", ""),
            "reference_style": fields.get("reference", ""),
            "net": fields.get("net", ""),
            "vat": fields.get("vat", ""),
            "total": fields.get("total", ""),
            "vat_code": fields.get("vat_code", ""),
            "currency": fields.get("currency", "GBP"),
            "payment_method": fields.get("payment_method", ""),
            "bank_account": fields.get("bank_account", ""),
            "price_is": fields.get("price_is", ""),
            "description": fields.get("description") or row.get("description") or "",
            "line_items": (fields.get("line_items") or [])[:8],
            "published_at": row.get("reviewed_at") or "",
        })
    return history


def integration_choice_label(record: dict, include_description: bool = False) -> str:
    parts = [record.get("code"), record.get("name")]
    if include_description:
        parts.append(record.get("description"))
    return " - ".join([str(part).strip() for part in parts if str(part or "").strip()]) or str(record.get("name") or record.get("code") or "").strip()


async def get_quickbooks_coding_choices(session: AsyncSession, client_id: str) -> dict:
    try:
        accounts = await get_active_integration_records(session, client_id, "account")
        suppliers = await get_active_integration_records(session, client_id, "supplier")
        tax_codes = await get_active_integration_records(session, client_id, "tax_code")
    except Exception:
        return {"categories": [], "suppliers": [], "vat_codes": []}
    return {
        "categories": [integration_choice_label(record, True) for record in accounts if record.get("external_id")][:500],
        "suppliers": [str(record.get("name") or "").strip() for record in suppliers if record.get("external_id") and record.get("name")][:500],
        "vat_codes": [integration_choice_label(record, True) for record in tax_codes if record.get("external_id")][:200],
    }


def choice_match_score(value: str, choice: str) -> float:
    left = normalize_lookup_value(value)
    right = normalize_lookup_value(choice)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if left in right or right in left:
        return 0.86
    return difflib.SequenceMatcher(None, left, right).ratio()


def best_choice(value: Optional[str], choices: list[str], minimum: float = 0.62) -> str:
    text_value = str(value or "").strip()
    if not text_value:
        return ""
    best = ""
    best_score = 0.0
    for choice in choices:
        score = choice_match_score(text_value, choice)
        if score > best_score:
            best = choice
            best_score = score
    return best if best_score >= minimum else ""


def zero_vat_choice(choices: list[str]) -> str:
    best = ""
    best_score = 0
    for choice in choices:
        text = normalize_lookup_value(choice)
        if not text:
            continue
        score = 0
        if any(term in text for term in ("no vat", "notax", "non-tax", "non taxable", "non-taxable")):
            score = 100
        elif "zero-rated" in text or "zero rated" in text:
            score = 90
        elif "exempt" in text:
            score = 82
        elif re.search(r"(^|[^\d-])0(?:\.0+)?\s*%", text):
            score = 76
        elif re.search(r"\b0(?:\.0+)?\b", text) and re.search(r"\bz\b|\bzero\b", text):
            score = 70
        if score > best_score:
            best = choice
            best_score = score
    return best


def normalize_non_vat_values(fields: dict, zero_code: str) -> dict:
    fields["vat"] = "0.00"
    if zero_code:
        fields["vat_code"] = zero_code
    total_value = parse_money_value(fields.get("total"))
    net_value = parse_money_value(fields.get("net"))
    if total_value is not None:
        fields["net"] = format_money_value(total_value)
    elif net_value is not None:
        fields["total"] = format_money_value(net_value)
    for line in fields.get("line_items") or []:
        if not isinstance(line, dict):
            continue
        line["vat"] = "0.00"
        if zero_code:
            line["vat_code"] = zero_code
        line_total = parse_money_value(line.get("total"))
        line_net = parse_money_value(line.get("net"))
        if line_total is not None:
            line["net"] = format_money_value(line_total)
        elif line_net is not None:
            line["total"] = format_money_value(line_net)
        if not str(line.get("price") or "").strip():
            line["price"] = line.get("net") or line.get("total") or ""
    return reconcile_coding_totals(fields)


def apply_synced_coding_choices(review: dict, coding_choices: Optional[dict], is_vat_client: bool = True) -> dict:
    coding_choices = coding_choices or {}
    fields = review.get("coding_fields") or {}
    if not isinstance(fields, dict):
        return review
    categories = coding_choices.get("categories") or []
    vat_codes = coding_choices.get("vat_codes") or []
    suppliers = coding_choices.get("suppliers") or []

    supplier_match = best_choice(fields.get("vendor_name"), suppliers, 0.76)
    if supplier_match:
        fields["vendor_name"] = supplier_match
    fields["category"] = best_choice(fields.get("category"), categories, 0.56)
    zero_code = zero_vat_choice(vat_codes)
    fields["bank_account"] = ""
    if is_vat_client:
        matched_vat = best_choice(fields.get("vat_code"), vat_codes, 0.56)
        if matched_vat:
            fields["vat_code"] = matched_vat
        elif parse_money_value(fields.get("vat")) in (0, 0.0) and zero_code:
            fields["vat_code"] = zero_code
    else:
        fields = normalize_non_vat_values(fields, zero_code)
    for line in fields.get("line_items") or []:
        if not isinstance(line, dict):
            continue
        line["category"] = best_choice(line.get("category") or fields.get("category"), categories, 0.56)
        line["bank_account"] = ""
        if is_vat_client:
            matched_line_vat = best_choice(line.get("vat_code") or fields.get("vat_code"), vat_codes, 0.56)
            if matched_line_vat:
                line["vat_code"] = matched_line_vat
            elif parse_money_value(line.get("vat")) in (0, 0.0) and zero_code:
                line["vat_code"] = zero_code
        else:
            line["vat"] = "0.00"
            if zero_code:
                line["vat_code"] = zero_code
    review["coding_fields"] = fields
    return review


def normalize_ai_review(data: dict) -> dict:
    status = str(data.get("status") or "").lower().strip()
    if status not in ("approved", "needs_review", "rejected"):
        status = "needs_review"
    message = str(data.get("message") or data.get("short_message") or "").strip()
    if not message:
        message = "Please check this document before submitting."
    payment_method = str(data.get("payment_method") or "not_clear").lower().strip()
    payment_method = payment_method.replace(" ", "_").replace("-", "_")
    if payment_method not in ("card", "cash", "payment_terms", "not_clear"):
        payment_method = "not_clear"
    return {
        "status": status,
        "message": message[:240],
        "document_type": str(data.get("document_type") or "unknown").strip()[:64],
        "payment_method": payment_method,
        "confidence": str(data.get("confidence") or "medium").lower().strip()[:24],
        "coding_fields": normalize_ai_coding_fields(data),
    }


async def review_document_with_openai(
    document_bytes: bytes,
    content_type: str,
    item: dict,
    client_user: dict,
    api_key: str,
    model: str,
    filename: Optional[str] = None,
    coding_history: Optional[list[dict]] = None,
    coding_choices: Optional[dict] = None,
) -> dict:
    if not api_key:
        raise HTTPException(status_code=400, detail="AI document check is enabled for this client, but OpenAI settings are not configured. Ask your administrator to add an API key.")

    is_vat_client = bool(client_user.get("is_vat_client"))
    invoice_kind = "purchase" if item.get("type") == "purchase" else "sales"
    vat_instruction = (
        "This is a VAT client. If the document is an invoice/receipt but VAT evidence is missing "
        "(VAT number, VAT amount/rate, or net/gross breakdown where expected), use needs_review "
        "rather than rejected unless it is clearly not an invoice/receipt."
        if is_vat_client
        else (
            "This is not marked as a VAT client. Do not reject only because VAT details are absent. "
            "For coding, treat VAT as 0.00 and use the closest synced zero/no-VAT VAT code."
        )
    )
    prompt = (
        "Check whether the uploaded document is a valid invoice or receipt for accounting submission. "
        "If it is a valid invoice or receipt, identify whether it appears paid by card, paid by cash, "
        "payable on payment terms/bank transfer, or not clear. "
        "Also extract accounting coding fields from the document. Populate header fields and line items "
        "where visible. Use blank strings for values that are not clear rather than guessing. "
        "For scanned receipts, read the visible text from the image/PDF and capture store name, VAT number, "
        "receipt date, subtotal/net, VAT and total where legible. Return useful ocr_text_lines in reading order "
        "for traceability, especially item rows, amounts, discounts, subtotal, VAT, card/auth/payment lines, "
        "transaction references and receipt numbers. ocr_text_boxes can be an empty array. "
        "Do not leave bill_number blank when any receipt number, invoice number, transaction reference, auth code, "
        "approval code, till number, terminal number, order number, or other stable reference is visible. If no "
        "explicit bill number exists, use the best transaction/reference candidate. "
        "For receipts with itemised lines, extract each readable purchased item row into line_items. Do not collapse "
        "a supermarket/shop receipt into one summary line when item rows and prices are visible. For discount rows "
        "or clubcard/savings rows, include them as negative lines when they clearly relate to an item. If itemised "
        "lines are not readable but the document total is readable, create one summary line. If VAT and gross total "
        "are readable, calculate net as gross minus VAT. If net and VAT are readable, calculate gross total as net plus VAT. "
        "Use dates as DD/MM/YYYY where possible. Use GBP unless another currency is clearly shown. "
        "For payment_method use Card, Cash, Payment terms, or Not clear. "
        "Reject only documents that are clearly not invoices/receipts, such as statements, orders, "
        "remittance advice, quotes, delivery notes, or unrelated images. Use needs_review for unclear "
        "or partially valid cases. Keep the message short and client-friendly. "
        f"Expected document area: {invoice_kind}. Listed item: {item.get('description') or 'Additional invoice'}. "
        f"{vat_instruction} "
        "Use the published accountant-corrected examples below as supplier memory. If the supplier, VAT number, "
        "receipt layout, or bill/reference style matches, reuse the coding pattern, VAT code/category, payment "
        "method style and line item approach. Do not copy old dates or amounts from examples. "
        "Always leave bank_account blank. The accountant will choose the bank account at publish time; that "
        "published choice is stored for future history but should not be prefilled by AI yet. "
        "For VAT clients, evaluate VAT evidence and choose the closest synced active VAT code. For non-VAT "
        "clients, treat VAT as 0.00 and choose the closest synced active zero/no-VAT VAT code. "
        "For supplier, category, line category, VAT code and line VAT code, use the synced QuickBooks choices below "
        "when possible. Do not invent category/account names or VAT codes. If no synced option is a reasonable match, "
        "leave that field blank for the accountant to choose. "
        f"Synced QuickBooks choices: {json.dumps(coding_choices or {})[:7000]}. "
        f"Published correction examples for this client/type: {json.dumps(coding_history or [])[:5000]}"
    )
    line_item_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "description": {"type": "string"},
            "category": {"type": "string"},
            "vat_code": {"type": "string"},
            "units": {"type": "string"},
            "price": {"type": "string"},
            "net": {"type": "string"},
            "vat": {"type": "string"},
            "total": {"type": "string"},
        },
        "required": ["description", "category", "vat_code", "units", "price", "net", "vat", "total"],
    }
    ocr_text_box_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "text": {"type": "string"},
            "page": {"type": "integer"},
            "x": {"type": "number"},
            "y": {"type": "number"},
            "width": {"type": "number"},
            "height": {"type": "number"},
        },
        "required": ["text", "page", "x", "y", "width", "height"],
    }
    coding_fields_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "vendor_name": {"type": "string"},
            "vendor_account": {"type": "string"},
            "category": {"type": "string"},
            "date": {"type": "string"},
            "due_date": {"type": "string"},
            "description": {"type": "string"},
            "document_type": {"type": "string", "enum": ["bill", "credit_note"]},
            "bill_number": {"type": "string"},
            "reference": {"type": "string"},
            "net": {"type": "string"},
            "vat": {"type": "string"},
            "total": {"type": "string"},
            "vat_code": {"type": "string"},
            "currency": {"type": "string"},
            "payment_method": {"type": "string"},
            "mark_as_paid": {"type": "boolean"},
            "bank_account": {"type": "string"},
            "price_is": {"type": "string", "enum": ["Tax Exclusive", "Tax Inclusive"]},
            "line_items": {"type": "array", "items": line_item_schema},
            "ocr_text_lines": {"type": "array", "items": {"type": "string"}},
            "ocr_text_boxes": {"type": "array", "items": ocr_text_box_schema},
        },
        "required": [
            "vendor_name", "vendor_account", "category", "date", "due_date", "description",
            "document_type", "bill_number", "reference", "net", "vat", "total", "vat_code",
            "currency", "payment_method", "mark_as_paid", "bank_account", "price_is", "line_items", "ocr_text_lines", "ocr_text_boxes",
        ],
    }
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["approved", "needs_review", "rejected"]},
            "document_type": {"type": "string"},
            "message": {"type": "string"},
            "payment_method": {"type": "string", "enum": ["card", "cash", "payment_terms", "not_clear"]},
            "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
            "coding_fields": coding_fields_schema,
        },
        "required": ["status", "document_type", "message", "payment_method", "confidence", "coding_fields"],
    }
    document_part = build_openai_document_part(document_bytes, content_type, filename)
    payload = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "You are a careful UK accountancy document checker. "
                            "Return only the requested structured result."
                        ),
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    document_part,
                ],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "invoice_document_check",
                "schema": schema,
                "strict": True,
            }
        },
    }

    try:
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            resp.raise_for_status()
            body = resp.json()
    except httpx.HTTPStatusError as exc:
        openai_detail = exc.response.text
        try:
            error_body = exc.response.json()
            openai_detail = error_body.get("error", {}).get("message") or openai_detail
        except Exception:
            pass
        logger.exception("OpenAI invoice check failed: %s", openai_detail)
        raise HTTPException(
            status_code=400,
            detail=(
                "Document check is temporarily unavailable: "
                f"OpenAI rejected the document check request ({exc.response.status_code}): "
                f"{openai_detail[:300]}"
            ),
        )
    except httpx.HTTPError as exc:
        logger.exception("OpenAI invoice check failed")
        raise HTTPException(status_code=400, detail=f"Document check is temporarily unavailable: {exc}")

    output_text = body.get("output_text")
    if not output_text:
        for item_out in body.get("output", []):
            for content in item_out.get("content", []):
                if content.get("type") in ("output_text", "text") and content.get("text"):
                    output_text = content["text"]
                    break
            if output_text:
                break
    try:
        return apply_synced_coding_choices(normalize_ai_review(json.loads(output_text or "{}")), coding_choices, is_vat_client)
    except json.JSONDecodeError:
        logger.warning("OpenAI invoice check returned non-JSON output: %s", output_text)
        return {"status": "needs_review", "message": "Please check this document before submitting.", "document_type": "unknown", "payment_method": "not_clear", "confidence": "low"}


def is_invoice_or_receipt_review(review: Optional[dict]) -> bool:
    if not review or review.get("status") == "rejected":
        return False
    document_type = str(review.get("document_type") or "").lower()
    return "invoice" in document_type or "receipt" in document_type


def payment_method_label(review: Optional[dict]) -> Optional[str]:
    if not is_invoice_or_receipt_review(review):
        return None
    labels = {
        "card": "Card",
        "cash": "Cash",
        "payment_terms": "Payment terms",
        "not_clear": "Payment method not clear",
    }
    return labels.get(str(review.get("payment_method") or "not_clear"), "Payment method not clear")


def build_submission_note(comment: str, review: Optional[dict], client_approved_ai_warning: bool) -> str:
    lines = []
    if comment and comment.strip():
        lines.append(comment.strip())
    payment_label = payment_method_label(review)
    if payment_label:
        lines.append(f"Payment method: {payment_label}")
    if client_approved_ai_warning and review:
        lines.append(f"Client approved after document check warning: {review.get('message') or 'Needs review'}")
    return "\n".join(lines)


async def send_submission_email(client_user: dict, item: dict, comment: str, image_path: Optional[str]):
    smtp = await get_smtp_settings()
    if not smtp:
        raise HTTPException(status_code=400, detail="SMTP is not configured. Ask your administrator to configure email settings.")

    is_additional = bool(item.get("additional"))
    msg = EmailMessage()
    msg["Subject"] = "Additional Document Submission" if is_additional else "Outstanding Document Submission"
    msg["From"] = f'{smtp["sender_name"]} <{smtp["sender_email"]}>'
    recipient = client_user.get("autoentry_email")
    if item.get("type") == "sales" and client_user.get("sales_autoentry_email"):
        recipient = client_user.get("sales_autoentry_email")
    if not recipient:
        raise HTTPException(status_code=400, detail="Client AutoEntry email is not configured.")
    msg["To"] = recipient

    body = (
        f"Business Name: {client_user.get('business_name','')}\n"
        f"Client Name: {client_user.get('first_name','')} {client_user.get('last_name','')}\n"
        f"Description: {item.get('description','')}\n"
        f"Date: {item.get('date','')}\n"
        f"Amount: {item.get('amount','')}\n"
        f"Type: {item.get('type','').title()}\n"
        f"Additional (not on outstanding list): {'Yes' if is_additional else 'No'}\n"
        f"Submission Date: {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}\n"
        f"Comment: {comment or '(none)'}\n"
    )
    msg.set_content(body)

    if image_path:
        maintype, subtype = attachment_mime(image_path)
        with open(image_path, "rb") as f:
            msg.add_attachment(f.read(), maintype=maintype, subtype=subtype, filename=Path(image_path).name)

    def _send_sync():
        socket.setdefaulttimeout(10)
        if int(smtp["port"]) == 465:
            with smtplib.SMTP_SSL(smtp["host"], int(smtp["port"]), timeout=10) as s:
                s.login(smtp["username"], smtp["password"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(smtp["host"], int(smtp["port"]), timeout=10) as s:
                s.ehlo()
                if smtp.get("use_tls", True):
                    s.starttls()
                    s.ehlo()
                s.login(smtp["username"], smtp["password"])
                s.send_message(msg)

    try:
        await asyncio.wait_for(asyncio.to_thread(_send_sync), timeout=15)
    except asyncio.TimeoutError:
        logger.error("SMTP send timed out")
        raise HTTPException(status_code=400, detail="Email server did not respond in time. Please try again or contact your administrator.")
    except (smtplib.SMTPException, socket.gaierror, OSError, ConnectionError) as e:
        logger.exception("SMTP send failed")
        raise HTTPException(status_code=400, detail=f"Unable to deliver email: {e}")
    except Exception as e:
        logger.exception("SMTP send failed (unexpected)")
        raise HTTPException(status_code=400, detail=f"Failed to send email: {e}")


@api.post("/client/items/{item_id}/submit")
async def submit_item(
    item_id: str,
    comment: str = Form(""),
    mode: str = Form(...),
    client_approved_ai_warning: bool = Form(False),
    ai_review_token: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    user: dict = Depends(require_client),
    session: AsyncSession = Depends(get_db),
):
    item = await one(
        session,
        select(outstanding_items).where(outstanding_items.c.id == item_id, outstanding_items.c.client_id == user["id"]),
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item["status"] == "submitted":
        raise HTTPException(status_code=400, detail="Item already submitted. Contact admin to reset.")

    comment = (comment or "").strip()
    image_path = None
    ai_review = None
    ai_client_approved = False
    now = datetime.now(timezone.utc)
    if mode == "no_photo":
        if not comment:
            raise HTTPException(status_code=400, detail="Comment is required when no photo is provided")
        fname = f"{user['id']}_{item_id}_{int(now.timestamp())}.jpg"
        fpath = UPLOAD_DIR / fname
        with open(fpath, "wb") as f:
            f.write(render_document_page(item.get("description", ""), comment, now))
        image_path = str(fpath)
    elif mode == "photo":
        if not file:
            raise HTTPException(status_code=400, detail="Document file is required")
        if not is_supported_document(file):
            raise HTTPException(status_code=400, detail="Please upload an image or PDF document")
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty file")
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="File is too large. Maximum upload size is 25 MB")
        image_upload = is_image_document(file)
        pdf_upload = is_pdf_document(file)
        if user.get("ai_analysis_enabled") and (image_upload or pdf_upload):
            image_hash = hashlib.sha256(raw).hexdigest()
            ai_token_verified = False
            if client_approved_ai_warning and ai_review_token:
                ai_review = verify_ai_review_token(ai_review_token, str(user["id"]), image_hash)
                ai_token_verified = ai_review is not None
            if ai_review is None:
                ai_settings = await get_openai_runtime_settings(session)
                coding_history = await get_coding_history(session, str(user["id"]), item["type"])
                coding_choices = await get_quickbooks_coding_choices(session, str(user["id"]))
                ai_review = await review_document_with_openai(
                    raw,
                    upload_content_type(file),
                    item,
                    user,
                    ai_settings["api_key"],
                    ai_settings["model"],
                    file.filename,
                    coding_history,
                    coding_choices,
                )
            if ai_review["status"] in ("needs_review", "rejected") and not ai_token_verified:
                return {
                    "ok": False,
                    "ai_review": {
                        **ai_review,
                        "token": create_ai_review_token(str(user["id"]), image_hash, ai_review),
                    },
                }
            ai_client_approved = ai_review["status"] in ("needs_review", "rejected") and ai_token_verified
        watermark_comment = build_submission_note(comment, ai_review, ai_client_approved)
        fname_ext = ".pdf" if watermark_comment else (".jpg" if image_upload else upload_extension(file, ".pdf"))
        fname = f"{user['id']}_{item_id}_{int(now.timestamp())}{fname_ext}"
        fpath = UPLOAD_DIR / fname
        if image_upload:
            if watermark_comment:
                with open(fpath, "wb") as f:
                    f.write(render_image_with_note_pdf(raw, watermark_comment, now))
            else:
                img = Image.open(io.BytesIO(raw)).convert("RGB")
                img.save(fpath, format="JPEG", quality=88)
        else:
            with open(fpath, "wb") as f:
                f.write(append_submission_note_page(raw, watermark_comment, now) if watermark_comment else raw)
        image_path = str(fpath)
    else:
        raise HTTPException(status_code=400, detail="Invalid mode")

    await send_submission_email(user, item, comment, image_path)

    submission_id = new_id()
    await session.execute(
        insert(submissions).values(
            id=submission_id,
            client_id=user["id"],
            type=item["type"],
            description=item.get("description", ""),
            date=item.get("date", ""),
            amount=item.get("amount", ""),
            comment=comment,
            image_filename=Path(image_path).name if image_path else None,
            is_additional=False,
            ai_review_status=ai_review.get("status") if ai_review else None,
            ai_review_message=ai_review.get("message") if ai_review else None,
            ai_document_type=ai_review.get("document_type") if ai_review else None,
            ai_extracted_fields=json.dumps(ai_review.get("coding_fields") or {}) if ai_review else None,
            ai_client_approved=ai_client_approved,
            review_status="inbox",
            submitted_at=utc_now_iso(),
            client_business_name=user.get("business_name", ""),
            client_first_name=user.get("first_name", ""),
            client_last_name=user.get("last_name", ""),
        )
    )
    await session.execute(delete(outstanding_items).where(outstanding_items.c.id == item_id))
    await session.commit()
    return {"ok": True, "submission_id": submission_id}


@api.post("/client/submit-additional")
async def submit_additional(
    type: str = Form(...),
    description: str = Form(...),
    comment: str = Form(""),
    mode: str = Form(...),
    client_approved_ai_warning: bool = Form(False),
    ai_review_token: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    user: dict = Depends(require_client),
    session: AsyncSession = Depends(get_db),
):
    """Submit an invoice that is NOT in the client's outstanding list."""
    if type not in ("purchase", "sales"):
        raise HTTPException(status_code=400, detail="Invalid invoice type")
    description = (description or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="Description is required")

    comment = (comment or "").strip()
    now = datetime.now(timezone.utc)
    fname = f"{user['id']}_additional_{int(now.timestamp())}.jpg"
    fpath = UPLOAD_DIR / fname
    ai_review = None
    ai_client_approved = False

    if mode == "no_photo":
        if not comment:
            raise HTTPException(status_code=400, detail="Comment is required when no photo is provided")
        with open(fpath, "wb") as f:
            f.write(render_document_page(description, comment, now))
    elif mode == "photo":
        if not file:
            raise HTTPException(status_code=400, detail="Document file is required")
        if not is_supported_document(file):
            raise HTTPException(status_code=400, detail="Please upload an image or PDF document")
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty file")
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="File is too large. Maximum upload size is 25 MB")
        item = {"description": description, "date": "", "amount": "", "type": type, "additional": True}
        image_upload = is_image_document(file)
        pdf_upload = is_pdf_document(file)
        if user.get("ai_analysis_enabled") and (image_upload or pdf_upload):
            image_hash = hashlib.sha256(raw).hexdigest()
            ai_token_verified = False
            if client_approved_ai_warning and ai_review_token:
                ai_review = verify_ai_review_token(ai_review_token, str(user["id"]), image_hash)
                ai_token_verified = ai_review is not None
            if ai_review is None:
                ai_settings = await get_openai_runtime_settings(session)
                coding_history = await get_coding_history(session, str(user["id"]), type)
                coding_choices = await get_quickbooks_coding_choices(session, str(user["id"]))
                ai_review = await review_document_with_openai(
                    raw,
                    upload_content_type(file),
                    item,
                    user,
                    ai_settings["api_key"],
                    ai_settings["model"],
                    file.filename,
                    coding_history,
                    coding_choices,
                )
            if ai_review["status"] in ("needs_review", "rejected") and not ai_token_verified:
                return {
                    "ok": False,
                    "ai_review": {
                        **ai_review,
                        "token": create_ai_review_token(str(user["id"]), image_hash, ai_review),
                    },
                }
            ai_client_approved = ai_review["status"] in ("needs_review", "rejected") and ai_token_verified
        watermark_comment = build_submission_note(comment, ai_review, ai_client_approved)
        fname_ext = ".pdf" if watermark_comment else (".jpg" if image_upload else upload_extension(file, ".pdf"))
        fname = f"{user['id']}_additional_{int(now.timestamp())}{fname_ext}"
        fpath = UPLOAD_DIR / fname
        if image_upload:
            if watermark_comment:
                with open(fpath, "wb") as f:
                    f.write(render_image_with_note_pdf(raw, watermark_comment, now))
            else:
                Image.open(io.BytesIO(raw)).convert("RGB").save(fpath, format="JPEG", quality=88)
        else:
            with open(fpath, "wb") as f:
                f.write(append_submission_note_page(raw, watermark_comment, now) if watermark_comment else raw)
    else:
        raise HTTPException(status_code=400, detail="Invalid mode")

    image_path = str(fpath)
    item = {"description": description, "date": "", "amount": "", "type": type, "additional": True}
    await send_submission_email(user, item, comment, image_path)

    submission_id = new_id()
    await session.execute(
        insert(submissions).values(
            id=submission_id,
            client_id=user["id"],
            type=type,
            description=description,
            date="",
            amount="",
            comment=comment,
            image_filename=fname,
            is_additional=True,
            ai_review_status=ai_review.get("status") if ai_review else None,
            ai_review_message=ai_review.get("message") if ai_review else None,
            ai_document_type=ai_review.get("document_type") if ai_review else None,
            ai_extracted_fields=json.dumps(ai_review.get("coding_fields") or {}) if ai_review else None,
            ai_client_approved=ai_client_approved,
            review_status="inbox",
            submitted_at=now.isoformat(),
            client_business_name=user.get("business_name", ""),
            client_first_name=user.get("first_name", ""),
            client_last_name=user.get("last_name", ""),
        )
    )
    await session.commit()
    return {"ok": True, "submission_id": submission_id}



# ---------- Admin: Submissions ----------
@api.get("/admin/submissions")
async def list_submissions(
    client_id: Optional[str] = None,
    type: Optional[str] = None,
    review_status: Optional[str] = None,
    q: Optional[str] = None,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await require_document_processing_module(session)
    stmt = select(submissions)
    conditions = []
    if client_id:
        conditions.append(submissions.c.client_id == client_id)
    if type in ("purchase", "sales"):
        conditions.append(submissions.c.type == type)
    if review_status == "inbox":
        conditions.append(or_(submissions.c.review_status == "inbox", submissions.c.review_status.is_(None)))
    elif review_status == "archived":
        conditions.append(submissions.c.review_status.in_(["archived", "published"]))
    elif review_status in ("rejected", "published"):
        conditions.append(submissions.c.review_status == review_status)
    if q:
        like = f"%{q}%"
        conditions.append(or_(submissions.c.description.ilike(like), submissions.c.comment.ilike(like)))
    if conditions:
        stmt = stmt.where(and_(*conditions))
    docs = await many(session, stmt.order_by(submissions.c.submitted_at.desc()).limit(2000))

    client_map = {}
    result = []
    for d in docs:
        d = serialize_submission(d)
        cid = d.get("client_id")
        if cid and cid not in client_map:
            cu = await get_user_by_id(session, cid)
            client_map[cid] = serialize_user(cu) if cu else None
        d["client"] = client_map.get(cid)
        result.append(d)
    return result


@api.patch("/admin/submissions/{submission_id}/review-status")
async def update_submission_review_status(
    submission_id: str,
    payload: SubmissionReviewStatusIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await require_document_processing_module(session)
    status = payload.review_status.strip().lower()
    if status not in {"inbox", "archived", "rejected", "published"}:
        raise HTTPException(status_code=400, detail="Invalid submission status")
    existing_submission = await one(session, select(submissions).where(submissions.c.id == submission_id))
    if not existing_submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    values = {"review_status": status, "reviewed_at": utc_now_iso()}
    memory_updated = False
    supplier_name = ""
    accounting_publish = None
    if payload.coding_fields is not None:
        coding_fields = dict(payload.coding_fields)
        supplier_name = str(coding_fields.get("vendor_name") or "").strip()
        if status == "published":
            accounting_publish = await publish_submission_to_accounting_destination(session, existing_submission, coding_fields, str(user.get("id")))
            coding_fields["accounting_publish"] = accounting_publish
            if accounting_publish.get("provider") == "quickbooks":
                coding_fields["quickbooks_publish"] = accounting_publish
            if accounting_publish.get("provider") == "epos_native":
                coding_fields["native_accounting_publish"] = accounting_publish
        values["coding_fields"] = json.dumps(coding_fields)
        memory_updated = status == "published"
    result = await session.execute(
        update(submissions)
        .where(submissions.c.id == submission_id)
        .values(**values)
    )
    if result.rowcount == 0:
        await session.rollback()
        raise HTTPException(status_code=404, detail="Submission not found")
    await session.commit()
    return {
        "ok": True,
        "review_status": status,
        "memory_updated": memory_updated,
        "supplier_name": supplier_name,
        "accounting_publish": accounting_publish,
        "quickbooks_publish": accounting_publish if accounting_publish and accounting_publish.get("provider") == "quickbooks" else None,
    }


@api.post("/admin/submissions/{submission_id}/extract-fields")
async def extract_submission_fields(
    submission_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await require_document_processing_module(session)
    doc = await one(session, select(submissions).where(submissions.c.id == submission_id))
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found")
    filename = doc.get("image_filename")
    if not filename:
        raise HTTPException(status_code=400, detail="Submission has no document attached")
    path = UPLOAD_DIR / Path(filename).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Submitted document file was not found")
    client_user = await get_user_by_id(session, doc["client_id"])
    if not client_user:
        raise HTTPException(status_code=404, detail="Client was not found")
    ai_settings = await get_openai_runtime_settings(session)
    raw = path.read_bytes()
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    item = {
        "description": doc.get("description") or "",
        "date": doc.get("date") or "",
        "amount": doc.get("amount") or "",
        "type": doc.get("type") or "purchase",
        "additional": bool(doc.get("is_additional")),
    }
    coding_history = await get_coding_history(session, str(doc["client_id"]), doc.get("type") or "purchase")
    coding_choices = await get_quickbooks_coding_choices(session, str(doc["client_id"]))
    ai_review = await review_document_with_openai(
        raw,
        content_type,
        item,
        client_user,
        ai_settings["api_key"],
        ai_settings["model"],
        filename,
        coding_history,
        coding_choices,
    )
    extracted = ai_review.get("coding_fields") or {}
    await session.execute(
        update(submissions)
        .where(submissions.c.id == submission_id)
        .values(
            ai_review_status=ai_review.get("status"),
            ai_review_message=ai_review.get("message"),
            ai_document_type=ai_review.get("document_type"),
            ai_extracted_fields=json.dumps(extracted),
        )
    )
    await session.commit()
    return {"ok": True, "ai_review": ai_review, "ai_extracted_fields": extracted}


@api.post("/admin/submissions/{submission_id}/suggest-lines")
async def suggest_submission_lines(
    submission_id: str,
    payload: SubmissionLineSuggestionIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await require_document_processing_module(session)
    doc = await one(session, select(submissions).where(submissions.c.id == submission_id))
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found")
    filename = doc.get("image_filename")
    if not filename:
        raise HTTPException(status_code=400, detail="Submission has no document attached")
    path = UPLOAD_DIR / Path(filename).name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Submitted document file was not found")
    ai_settings = await get_openai_runtime_settings(session)
    raw = path.read_bytes()
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    document_part = build_openai_document_part(raw, content_type, filename)
    coding_history = await get_coding_history(session, str(doc["client_id"]), doc.get("type") or "purchase")
    line_item_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "description": {"type": "string"},
            "category": {"type": "string"},
            "vat_code": {"type": "string"},
            "units": {"type": "string"},
            "price": {"type": "string"},
            "net": {"type": "string"},
            "vat": {"type": "string"},
            "total": {"type": "string"},
        },
        "required": ["description", "category", "vat_code", "units", "price", "net", "vat", "total"],
    }
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "line_items": {"type": "array", "items": line_item_schema},
        },
        "required": ["line_items"],
    }
    prompt = (
        "Extract invoice or receipt line items from this document. Use the supplied example line as the coding pattern. "
        "Keep the document's visible line descriptions, units, price, net, VAT and total where legible. "
        "Apply category and VAT code consistently from the pattern unless the document clearly requires a different value. "
        "Return all visible document item rows where possible. For supermarket/shop receipts, each purchased product row "
        "with a visible amount should become a separate line item. Do not collapse a readable receipt into one summary line. "
        "Include discount/clubcard rows as negative lines when they are clearly visible. If the receipt only has a total "
        "and no itemised lines are readable, return one best summary line. "
        "For each line, populate net and total wherever possible. If VAT and gross total are visible, calculate net as gross minus VAT. "
        "If only a gross receipt total is visible, use it as total and leave VAT blank unless VAT is explicitly shown. "
        f"Current header/draft coding: {json.dumps(payload.coding_fields)[:4000]}. "
        f"Example line pattern: {json.dumps(payload.pattern_line)[:1500]}. "
        f"Previous approved examples: {json.dumps(coding_history)[:3000]}."
    )
    request_payload = {
        "model": ai_settings["model"],
        "input": [
            {
                "role": "system",
                "content": [{"type": "input_text", "text": "You are a UK bookkeeping line-item coding assistant. Return only structured line items."}],
            },
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    document_part,
                ],
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "line_item_suggestions",
                "schema": schema,
                "strict": True,
            }
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {ai_settings['api_key']}", "Content-Type": "application/json"},
                json=request_payload,
            )
            resp.raise_for_status()
            body = resp.json()
    except httpx.HTTPStatusError as exc:
        openai_detail = exc.response.text
        try:
            error_body = exc.response.json()
            openai_detail = error_body.get("error", {}).get("message") or openai_detail
        except Exception:
            pass
        logger.exception("OpenAI line suggestion failed: %s", openai_detail)
        raise HTTPException(status_code=400, detail=f"Unable to suggest line items: {openai_detail[:300]}")
    except httpx.HTTPError as exc:
        logger.exception("OpenAI line suggestion failed")
        raise HTTPException(status_code=400, detail=f"Unable to suggest line items: {exc}")

    output_text = body.get("output_text")
    if not output_text:
        for item_out in body.get("output", []):
            for content in item_out.get("content", []):
                if content.get("type") in ("output_text", "text") and content.get("text"):
                    output_text = content["text"]
                    break
            if output_text:
                break
    try:
        parsed = json.loads(output_text or "{}")
    except json.JSONDecodeError:
        logger.warning("OpenAI line suggestion returned non-JSON output: %s", output_text)
        parsed = {}
    line_items = normalize_line_items(parsed.get("line_items"))
    if not line_items:
        raise HTTPException(status_code=400, detail="AI could not identify line items from this document.")
    return {"ok": True, "line_items": line_items}


@api.post("/admin/submissions/download")
async def download_submissions(
    payload: SubmissionDownloadIn,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await require_document_processing_module(session)
    ids = [str(item).strip() for item in payload.ids if str(item).strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="Select at least one document")

    docs = await many(session, select(submissions).where(submissions.c.id.in_(ids)))
    buffer = io.BytesIO()
    added = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for doc in docs:
            filename = doc.get("image_filename")
            if not filename:
                continue
            path = UPLOAD_DIR / filename
            if not path.exists():
                continue
            submitted = (doc.get("submitted_at") or "").replace(":", "-").replace("T", "_")[:19]
            prefix = submitted or str(doc.get("id"))
            archive.write(path, arcname=f"{prefix}_{filename}")
            added += 1

    if added == 0:
        raise HTTPException(status_code=404, detail="No files found for selected submissions")

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="submissions.zip"'},
    )


@api.delete("/admin/submissions/{submission_id}")
async def delete_submission(
    submission_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await require_document_processing_module(session)
    result = await session.execute(delete(submissions).where(submissions.c.id == submission_id))
    if result.rowcount == 0:
        await session.rollback()
        raise HTTPException(status_code=404, detail="Submission not found")
    await session.commit()
    return {"ok": True}


@api.get("/admin/uploads/{filename}")
async def admin_upload(filename: str, user: dict = Depends(require_admin)):
    p = UPLOAD_DIR / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(p)


@api.get("/downloads/status")
async def downloads_status():
    return {
        "android": (DOWNLOADS_DIR / "epos-docs.apk").exists(),
        "ios": (DOWNLOADS_DIR / "epos-docs.ipa").exists(),
    }


@api.get("/downloads/android")
async def download_android():
    p = DOWNLOADS_DIR / "epos-docs.apk"
    if not p.exists():
        raise HTTPException(status_code=404, detail="Android app not yet available")
    return FileResponse(p, media_type="application/vnd.android.package-archive", filename="epos-docs.apk")


@api.get("/downloads/ios")
async def download_ios():
    p = DOWNLOADS_DIR / "epos-docs.ipa"
    if not p.exists():
        raise HTTPException(status_code=404, detail="iOS app not yet available")
    return FileResponse(p, media_type="application/octet-stream", filename="epos-docs.ipa")


@api.get("/health")
async def health(session: AsyncSession = Depends(get_db)):
    await session.execute(select(func.count()).select_from(users))
    return {"ok": True, "database": "sql"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
