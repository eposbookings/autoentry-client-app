from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import hmac
import base64
import hashlib
import asyncio
import csv
import io
import json
import logging
import mimetypes
import os
import smtplib
import socket
import textwrap
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import List, Optional

import bcrypt
import httpx
import jwt
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
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
    Column("ai_client_approved", Boolean, default=False),
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
    for table in (users, outstanding_items, submissions, settings):
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
    }


async def review_document_with_openai(
    document_bytes: bytes,
    content_type: str,
    item: dict,
    client_user: dict,
    api_key: str,
    model: str,
) -> dict:
    if not api_key:
        raise HTTPException(status_code=400, detail="AI document check is enabled for this client, but OpenAI settings are not configured. Ask your administrator to add an API key.")

    is_vat_client = bool(client_user.get("is_vat_client"))
    safe_content_type = content_type or "application/octet-stream"
    data_url = f"data:{safe_content_type};base64,{base64.b64encode(document_bytes).decode('ascii')}"
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
        "Reject only documents that are clearly not invoices/receipts, such as statements, orders, "
        "remittance advice, quotes, delivery notes, or unrelated images. Use needs_review for unclear "
        "or partially valid cases. Keep the message short and client-friendly. "
        f"Expected document area: {invoice_kind}. Listed item: {item.get('description') or 'Additional invoice'}. "
        f"{vat_instruction}"
    )
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["approved", "needs_review", "rejected"]},
            "document_type": {"type": "string"},
            "message": {"type": "string"},
            "payment_method": {"type": "string", "enum": ["card", "cash", "payment_terms", "not_clear"]},
            "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        },
        "required": ["status", "document_type", "message", "payment_method", "confidence"],
    }
    document_part = (
        {"type": "input_file", "filename": "submitted-document.pdf", "file_data": data_url}
        if safe_content_type == "application/pdf"
        else {"type": "input_image", "image_url": data_url, "detail": "low"}
    )
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
        return normalize_ai_review(json.loads(output_text or "{}"))
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
                ai_review = await review_document_with_openai(
                    raw,
                    upload_content_type(file),
                    item,
                    user,
                    ai_settings["api_key"],
                    ai_settings["model"],
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
            ai_client_approved=ai_client_approved,
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
                ai_review = await review_document_with_openai(
                    raw,
                    upload_content_type(file),
                    item,
                    user,
                    ai_settings["api_key"],
                    ai_settings["model"],
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
            ai_client_approved=ai_client_approved,
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
    q: Optional[str] = None,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
    stmt = select(submissions)
    conditions = []
    if client_id:
        conditions.append(submissions.c.client_id == client_id)
    if type in ("purchase", "sales"):
        conditions.append(submissions.c.type == type)
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


@api.delete("/admin/submissions/{submission_id}")
async def delete_submission(
    submission_id: str,
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_db),
):
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
