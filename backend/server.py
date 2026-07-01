from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import io
import csv
import jwt
import bcrypt
import logging
import smtplib
import asyncio
import socket
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Annotated
from email.message import EmailMessage

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, EmailStr, Field, ConfigDict
from bson import ObjectId
from cryptography.fernet import Fernet
from PIL import Image, ImageDraw, ImageFont

# ---------- Config ----------
JWT_ALGORITHM = "HS256"
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(ROOT_DIR / "uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

fernet = Fernet(os.environ["FERNET_KEY"].encode())

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("portal")

app = FastAPI()
api = APIRouter(prefix="/api")


def _to_str(v) -> str:
    return str(v)


PyObjectId = Annotated[str, BeforeValidator(_to_str)]


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ClientCreate(BaseModel):
    first_name: str
    last_name: str
    business_name: str
    email: EmailStr
    autoentry_email: EmailStr
    password: str
    status: str = "active"


class ClientUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    business_name: Optional[str] = None
    email: Optional[EmailStr] = None
    autoentry_email: Optional[EmailStr] = None
    status: Optional[str] = None


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


# ---------- Helpers ----------
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


def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=8 * 3600,
        path="/",
    )


def clear_auth_cookie(response: Response):
    response.delete_cookie("access_token", path="/")


async def get_current_user(request: Request) -> dict:
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
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
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
    uid = str(u["_id"])
    return {
        "id": uid,
        "_id": uid,
        "email": u["email"],
        "role": u["role"],
        "first_name": u.get("first_name"),
        "last_name": u.get("last_name"),
        "business_name": u.get("business_name"),
        "autoentry_email": u.get("autoentry_email"),
        "status": u.get("status", "active"),
    }


def serialize_item(d: dict) -> dict:
    d = dict(d)
    d["_id"] = str(d["_id"])
    d["id"] = d["_id"]
    return d


# ---------- Auth ----------
@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("status") == "inactive":
        raise HTTPException(status_code=403, detail="Account is inactive. Contact your administrator.")
    token = create_access_token(str(user["_id"]), user["role"])
    set_auth_cookie(response, token)
    return {"user": serialize_user(user), "access_token": token}


@api.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return serialize_user({"_id": user["_id"], **user})


# ---------- Admin: Clients ----------
@api.get("/admin/clients")
async def list_clients(q: Optional[str] = None, user: dict = Depends(require_admin)):
    query: dict = {"role": "client"}
    if q:
        rgx = {"$regex": q, "$options": "i"}
        query["$or"] = [
            {"first_name": rgx}, {"last_name": rgx}, {"business_name": rgx}, {"email": rgx},
        ]
    docs = await db.users.find(query).sort("business_name", 1).to_list(1000)
    result = []
    for d in docs:
        s = serialize_user(d)
        s["purchase_outstanding"] = await db.outstanding_items.count_documents(
            {"client_id": str(d["_id"]), "type": "purchase"}
        )
        s["sales_outstanding"] = await db.outstanding_items.count_documents(
            {"client_id": str(d["_id"]), "type": "sales"}
        )
        result.append(s)
    return result


@api.post("/admin/clients")
async def create_client(payload: ClientCreate, user: dict = Depends(require_admin)):
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="A user with this email already exists")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "role": "client",
        "first_name": payload.first_name.strip(),
        "last_name": payload.last_name.strip(),
        "business_name": payload.business_name.strip(),
        "autoentry_email": payload.autoentry_email.lower().strip(),
        "status": payload.status or "active",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    r = await db.users.insert_one(doc)
    doc["_id"] = r.inserted_id
    return serialize_user(doc)


@api.get("/admin/clients/{client_id}")
async def get_client(client_id: str, user: dict = Depends(require_admin)):
    d = await db.users.find_one({"_id": ObjectId(client_id), "role": "client"})
    if not d:
        raise HTTPException(status_code=404, detail="Client not found")
    return serialize_user(d)


@api.put("/admin/clients/{client_id}")
async def update_client(client_id: str, payload: ClientUpdate, user: dict = Depends(require_admin)):
    update = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "email" in update:
        update["email"] = update["email"].lower().strip()
        other = await db.users.find_one({"email": update["email"], "_id": {"$ne": ObjectId(client_id)}})
        if other:
            raise HTTPException(status_code=400, detail="Email already in use")
    if "autoentry_email" in update:
        update["autoentry_email"] = update["autoentry_email"].lower().strip()
    if update:
        await db.users.update_one({"_id": ObjectId(client_id), "role": "client"}, {"$set": update})
    d = await db.users.find_one({"_id": ObjectId(client_id)})
    if not d:
        raise HTTPException(status_code=404, detail="Client not found")
    return serialize_user(d)


@api.delete("/admin/clients/{client_id}")
async def delete_client(client_id: str, user: dict = Depends(require_admin)):
    r = await db.users.delete_one({"_id": ObjectId(client_id), "role": "client"})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    await db.outstanding_items.delete_many({"client_id": client_id})
    await db.submissions.delete_many({"client_id": client_id})
    return {"ok": True}


@api.post("/admin/clients/{client_id}/reset-password")
async def reset_client_password(client_id: str, payload: PasswordReset, user: dict = Depends(require_admin)):
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    r = await db.users.update_one(
        {"_id": ObjectId(client_id), "role": "client"},
        {"$set": {"password_hash": hash_password(payload.new_password)}},
    )
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"ok": True}


# ---------- Admin: CSV Upload ----------
@api.get("/admin/clients/{client_id}/items")
async def admin_client_items(client_id: str, type: str, user: dict = Depends(require_admin)):
    if type not in ("purchase", "sales"):
        raise HTTPException(status_code=400, detail="invalid type")
    docs = await db.outstanding_items.find({"client_id": client_id, "type": type}).sort("date", -1).to_list(2000)
    return [serialize_item(d) for d in docs]


@api.post("/admin/clients/{client_id}/upload-csv")
async def upload_csv(
    client_id: str,
    type: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    if type not in ("purchase", "sales"):
        raise HTTPException(status_code=400, detail="type must be 'purchase' or 'sales'")
    client = await db.users.find_one({"_id": ObjectId(client_id), "role": "client"})
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
    if not f_desc: missing_cols.append("Description")
    if not f_date: missing_cols.append("Date")
    if not f_amount: missing_cols.append("Amount")
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
        return None  # unparseable

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

        items.append({
            "client_id": client_id,
            "type": type,
            "description": desc,
            "date": norm_date,
            "amount": raw_amount,
            "status": "outstanding",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        rows_imported += 1

    await db.outstanding_items.delete_many({"client_id": client_id, "type": type})
    if items:
        await db.outstanding_items.insert_many(items)

    return {"rows_imported": rows_imported, "errors": errors}


# ---------- Admin: SMTP Settings ----------
@api.get("/admin/settings/smtp")
async def get_smtp(user: dict = Depends(require_admin)):
    s = await db.settings.find_one({"key": "smtp"})
    if not s:
        return {"host": "", "port": 587, "username": "", "sender_email": "", "sender_name": "", "use_tls": True, "configured": False}
    return {
        "host": s.get("host", ""),
        "port": s.get("port", 587),
        "username": s.get("username", ""),
        "sender_email": s.get("sender_email", ""),
        "sender_name": s.get("sender_name", ""),
        "use_tls": s.get("use_tls", True),
        "configured": bool(s.get("password_enc")),
    }


@api.put("/admin/settings/smtp")
async def update_smtp(payload: SMTPSettingsIn, user: dict = Depends(require_admin)):
    existing = await db.settings.find_one({"key": "smtp"}) or {}
    doc = {
        "key": "smtp",
        "host": payload.host.strip(),
        "port": int(payload.port),
        "username": payload.username.strip(),
        "sender_email": payload.sender_email.lower().strip(),
        "sender_name": payload.sender_name.strip(),
        "use_tls": payload.use_tls,
    }
    if payload.password:
        doc["password_enc"] = fernet.encrypt(payload.password.encode()).decode()
    elif existing.get("password_enc"):
        doc["password_enc"] = existing["password_enc"]
    await db.settings.update_one({"key": "smtp"}, {"$set": doc}, upsert=True)
    return {"ok": True}


@api.delete("/admin/settings/smtp")
async def clear_smtp(user: dict = Depends(require_admin)):
    await db.settings.delete_one({"key": "smtp"})
    return {"ok": True}


async def get_smtp_settings() -> Optional[dict]:
    s = await db.settings.find_one({"key": "smtp"})
    if not s or not s.get("password_enc"):
        return None
    pw = fernet.decrypt(s["password_enc"].encode()).decode()
    return {**s, "password": pw}


# ---------- Client: Outstanding & Submissions ----------
@api.get("/client/counts")
async def client_counts(user: dict = Depends(require_client)):
    cid = user["_id"]
    p = await db.outstanding_items.count_documents({"client_id": cid, "type": "purchase"})
    s = await db.outstanding_items.count_documents({"client_id": cid, "type": "sales"})
    return {"purchase_outstanding": p, "sales_outstanding": s}


@api.get("/client/items")
async def client_items(type: str, user: dict = Depends(require_client)):
    if type not in ("purchase", "sales"):
        raise HTTPException(status_code=400, detail="invalid type")
    docs = await db.outstanding_items.find({"client_id": user["_id"], "type": type}).sort("date", -1).to_list(2000)
    return [serialize_item(d) for d in docs]


@api.get("/client/items/{item_id}")
async def client_item(item_id: str, user: dict = Depends(require_client)):
    d = await db.outstanding_items.find_one({"_id": ObjectId(item_id), "client_id": user["_id"]})
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

    timestamp = submitted_at.strftime("%d %b %Y · %H:%M UTC")
    title_size = max(40, W // 24)
    body_size = max(34, W // 30)
    try:
        font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", title_size)
        font_body = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", body_size)
    except Exception:
        font_title = ImageFont.load_default()
        font_body = ImageFont.load_default()

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

def render_document_page(title: str, comment: str, submitted_at: datetime) -> bytes:
    """Render a clean white A4-style page containing the invoice description,
    the submission timestamp and the client's comment. Used when the client
    submits without a photo so an image attachment is always produced."""
    W, H = 1240, 1754  # ~A4 at 150dpi
    img = Image.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    try:
        font_h1 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 64)
        font_label = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
        font_body = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 40)
        font_meta = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34)
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


    out = io.BytesIO()
    composed.save(out, format="JPEG", quality=88)
    return out.getvalue()


async def send_submission_email(client_user: dict, item: dict, comment: str, image_path: Optional[str]):
    smtp = await get_smtp_settings()
    if not smtp:
        raise HTTPException(status_code=400, detail="SMTP is not configured. Ask your administrator to configure email settings.")

    is_additional = bool(item.get("additional"))
    msg = EmailMessage()
    msg["Subject"] = "Additional Document Submission" if is_additional else "Outstanding Document Submission"
    msg["From"] = f'{smtp["sender_name"]} <{smtp["sender_email"]}>'
    msg["To"] = client_user["autoentry_email"]

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
        with open(image_path, "rb") as f:
            msg.add_attachment(f.read(), maintype="image", subtype="jpeg", filename=Path(image_path).name)

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
    file: Optional[UploadFile] = File(None),
    user: dict = Depends(require_client),
):
    item = await db.outstanding_items.find_one({"_id": ObjectId(item_id), "client_id": user["_id"]})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item["status"] == "submitted":
        raise HTTPException(status_code=400, detail="Item already submitted. Contact admin to reset.")

    comment = (comment or "").strip()
    image_path = None
    now = datetime.now(timezone.utc)
    if mode == "no_photo":
        if not comment:
            raise HTTPException(status_code=400, detail="Comment is required when no photo is provided")
        fname = f"{user['_id']}_{item_id}_{int(now.timestamp())}.jpg"
        fpath = UPLOAD_DIR / fname
        with open(fpath, "wb") as f:
            f.write(render_document_page(item.get("description", ""), comment, now))
        image_path = str(fpath)
    elif mode == "photo":
        if not file:
            raise HTTPException(status_code=400, detail="Photo file is required")
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty file")
        fname = f"{user['_id']}_{item_id}_{int(now.timestamp())}.jpg"
        fpath = UPLOAD_DIR / fname
        if comment:
            final_bytes = stamp_image(raw, comment, now)
            with open(fpath, "wb") as f:
                f.write(final_bytes)
        else:
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            img.save(fpath, format="JPEG", quality=88)
        image_path = str(fpath)
    else:
        raise HTTPException(status_code=400, detail="Invalid mode")

    await send_submission_email(user, item, comment, image_path)

    sub_doc = {
        "client_id": user["_id"],
        "type": item["type"],
        "description": item.get("description", ""),
        "date": item.get("date", ""),
        "amount": item.get("amount", ""),
        "comment": comment,
        "image_filename": Path(image_path).name if image_path else None,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "client_business_name": user.get("business_name", ""),
        "client_first_name": user.get("first_name", ""),
        "client_last_name": user.get("last_name", ""),
    }
    r = await db.submissions.insert_one(sub_doc)
    # Remove the item from the outstanding list once successfully submitted
    await db.outstanding_items.delete_one({"_id": ObjectId(item_id)})
    return {"ok": True, "submission_id": str(r.inserted_id)}


@api.post("/client/submit-additional")
async def submit_additional(
    type: str = Form(...),
    description: str = Form(...),
    comment: str = Form(""),
    mode: str = Form(...),
    file: Optional[UploadFile] = File(None),
    user: dict = Depends(require_client),
):
    """Submit an invoice that is NOT in the client's outstanding list."""
    if type not in ("purchase", "sales"):
        raise HTTPException(status_code=400, detail="Invalid invoice type")
    description = (description or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="Description is required")

    comment = (comment or "").strip()
    now = datetime.now(timezone.utc)
    fname = f"{user['_id']}_additional_{int(now.timestamp())}.jpg"
    fpath = UPLOAD_DIR / fname

    if mode == "no_photo":
        if not comment:
            raise HTTPException(status_code=400, detail="Comment is required when no photo is provided")
        with open(fpath, "wb") as f:
            f.write(render_document_page(description, comment, now))
    elif mode == "photo":
        if not file:
            raise HTTPException(status_code=400, detail="Photo file is required")
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Empty file")
        if comment:
            with open(fpath, "wb") as f:
                f.write(stamp_image(raw, comment, now))
        else:
            Image.open(io.BytesIO(raw)).convert("RGB").save(fpath, format="JPEG", quality=88)
    else:
        raise HTTPException(status_code=400, detail="Invalid mode")

    image_path = str(fpath)
    item = {"description": description, "date": "", "amount": "", "type": type, "additional": True}
    await send_submission_email(user, item, comment, image_path)

    sub_doc = {
        "client_id": user["_id"],
        "type": type,
        "description": description,
        "date": "",
        "amount": "",
        "comment": comment,
        "image_filename": fname,
        "is_additional": True,
        "submitted_at": now.isoformat(),
        "client_business_name": user.get("business_name", ""),
        "client_first_name": user.get("first_name", ""),
        "client_last_name": user.get("last_name", ""),
    }
    r = await db.submissions.insert_one(sub_doc)
    return {"ok": True, "submission_id": str(r.inserted_id)}



# ---------- Admin: Submissions ----------
@api.get("/admin/submissions")
async def list_submissions(
    client_id: Optional[str] = None,
    type: Optional[str] = None,
    q: Optional[str] = None,
    user: dict = Depends(require_admin),
):
    """List historical submissions from the submissions collection."""
    query: dict = {}
    if client_id:
        query["client_id"] = client_id
    if type in ("purchase", "sales"):
        query["type"] = type
    if q:
        query["$or"] = [
            {"description": {"$regex": q, "$options": "i"}},
            {"comment": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.submissions.find(query).sort("submitted_at", -1).to_list(2000)

    client_map = {}
    result = []
    for d in docs:
        d["_id"] = str(d["_id"])
        d["id"] = d["_id"]
        cid = d.get("client_id")
        if cid and cid not in client_map:
            cu = await db.users.find_one({"_id": ObjectId(cid)})
            client_map[cid] = serialize_user(cu) if cu else None
        d["client"] = client_map.get(cid)
        result.append(d)
    return result


@api.delete("/admin/submissions/{submission_id}")
async def delete_submission(submission_id: str, user: dict = Depends(require_admin)):
    r = await db.submissions.delete_one({"_id": ObjectId(submission_id)})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Submission not found")
    return {"ok": True}


@api.get("/admin/uploads/{filename}")
async def admin_upload(filename: str, user: dict = Depends(require_admin)):
    p = UPLOAD_DIR / filename
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(p)


DOWNLOADS_DIR = ROOT_DIR / "downloads"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

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


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.outstanding_items.create_index([("client_id", 1), ("type", 1), ("status", 1)])
    await db.submissions.create_index("client_id")
    await db.settings.create_index("key", unique=True)

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower().strip()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "role": "admin",
            "first_name": "Practice",
            "last_name": "Admin",
            "status": "active",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("Admin seeded: %s", admin_email)
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password), "role": "admin"}})
        logger.info("Admin password updated.")


@app.on_event("shutdown")
async def shutdown():
    mongo_client.close()
