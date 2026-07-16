from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import hmac
import base64
import hashlib
import asyncio
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
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import List, Optional
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
    Column("autoentry_email", String(255)),
    Column("sales_autoentry_email", String(255)),
    Column("is_vat_client", Boolean, default=False),
    Column("ai_analysis_enabled", Boolean, default=False),
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
    Column("quickbooks_client_id", String(255)),
    Column("quickbooks_client_secret_enc", Text),
    Column("quickbooks_environment", String(32)),
    Column("quickbooks_redirect_uri", String(512)),
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
    for table in (users, outstanding_items, submissions, settings, client_integrations, integration_records):
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
        "autoentry_email": u.get("autoentry_email"),
        "sales_autoentry_email": u.get("sales_autoentry_email"),
        "is_vat_client": bool(u.get("is_vat_client")),
        "ai_analysis_enabled": bool(u.get("ai_analysis_enabled")),
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
        "status": payload.status or "active",
        "created_at": utc_now_iso(),
    }
    await session.execute(insert(users).values(**doc))
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
    if values:
        result = await session.execute(
            update(users).where(users.c.id == client_id, users.c.role == "client").values(**values)
        )
        if result.rowcount == 0:
            await session.rollback()
            raise HTTPException(status_code=404, detail="Client not found")
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


def quickbooks_is_active(item: dict) -> bool:
    if not isinstance(item, dict):
        return True
    for key in ("Active", "active"):
        if key not in item:
            continue
        value = item.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() not in {"false", "0", "inactive", "disabled", "deleted", "no"}
        return bool(value)
    status = str(item.get("Status") or item.get("status") or "").strip().lower()
    if status in {"inactive", "disabled", "deleted"}:
        return False
    return True


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
        .where(integration_records.c.active == True)  # noqa: E712
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
        "sandbox": bool(payload.sandbox),
        "auto_create_suppliers": bool(payload.auto_create_suppliers),
        "auto_create_customers": bool(payload.auto_create_customers),
        "default_purchase_account": (payload.default_purchase_account or "").strip(),
        "default_sales_account": (payload.default_sales_account or "").strip(),
        "default_vat_code": (payload.default_vat_code or "").strip(),
        "notes": (payload.notes or "").strip(),
        "updated_at": now,
    }
    existing = await one(session, select(client_integrations).where(client_integrations.c.client_id == client_id))
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
        "environment": creds["environment"],
        "redirect_uri": creds["redirect_uri"],
        "source": creds["source"],
        "client_id_saved": bool(creds["client_id"]),
        "client_secret_saved": bool(creds["client_secret"]),
    }


@api.get("/admin/integrations/clients/{client_id}/quickbooks/connect")
async def start_quickbooks_connect(
    client_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    await get_client_or_404(session, client_id)
    creds = await get_quickbooks_credentials(session)
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
        return RedirectResponse(f"{frontend_url}/admin/integrations?quickbooks=connected&sync=ok")
    except Exception as exc:
        logger.exception("QuickBooks connected but initial sync failed for client %s", client_id)
        message = urlencode({"m": f"QuickBooks connected, but list sync failed: {str(exc)}"})[2:]
        return RedirectResponse(f"{frontend_url}/admin/integrations?quickbooks=connected&sync=error&message={message}")


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
                "active": quickbooks_is_active(record.get("raw") or {}) and bool(record.get("active", True)),
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

    accounts_response = await quickbooks_query(access_token, realm_id, environment, "SELECT * FROM Account MAXRESULTS 1000")
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
    tax_rates_response = {}
    for tax_rate_query in ("SELECT * FROM TaxRate MAXRESULTS 1000", "SELECT * FROM TaxRate"):
        tax_rates_response, warning = await optional_quickbooks_query(access_token, realm_id, environment, tax_rate_query)
        if warning:
            sync_warnings.append(warning)
            logger.warning("QuickBooks tax rate query skipped for client %s: %s", client_id, warning)
            continue
        if tax_rates_response.get("TaxRate"):
            break
    company_info = (company_response.get("CompanyInfo") or [{}])[0] or {}

    accounts = [
        {
            "external_id": item.get("Id"),
            "code": item.get("AcctNum") or item.get("Id") or "",
            "name": item.get("Name") or item.get("FullyQualifiedName") or "",
            "description": item.get("AccountType") or item.get("Classification") or "",
            "active": quickbooks_is_active(item),
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
            "active": quickbooks_is_active(item),
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
            "active": quickbooks_is_active(item),
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
            "active": quickbooks_is_active(item),
            "raw": item,
        }
        for item in tax_codes_response.get("TaxCode", []) or []
    ]
    existing_tax_names = {str(item.get("name") or "").strip().lower() for item in tax_codes}
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
            "active": quickbooks_is_active(item),
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
        "bank_account": str(source.get("bank_account") or "").strip()[:255],
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


def apply_synced_coding_choices(review: dict, coding_choices: Optional[dict]) -> dict:
    if not coding_choices:
        return review
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
    fields["vat_code"] = best_choice(fields.get("vat_code"), vat_codes, 0.56)
    for line in fields.get("line_items") or []:
        if not isinstance(line, dict):
            continue
        line["category"] = best_choice(line.get("category") or fields.get("category"), categories, 0.56)
        line["vat_code"] = best_choice(line.get("vat_code") or fields.get("vat_code"), vat_codes, 0.56)
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
        else "This is not marked as a VAT client. Do not reject only because VAT details are absent."
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
        "If Mark as Paid is true or payment is by card/cash, include the most likely bank/cash account only "
        "when there is a clear matching pattern in the published examples; otherwise leave bank_account blank. "
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
        return apply_synced_coding_choices(normalize_ai_review(json.loads(output_text or "{}")), coding_choices)
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
    quickbooks_publish = None
    if payload.coding_fields is not None:
        coding_fields = dict(payload.coding_fields)
        supplier_name = str(coding_fields.get("vendor_name") or "").strip()
        if status == "published":
            quickbooks_publish = await publish_submission_to_quickbooks(session, existing_submission, coding_fields)
            coding_fields["quickbooks_publish"] = quickbooks_publish
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
        "quickbooks_publish": quickbooks_publish,
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
