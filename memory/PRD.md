# Outstanding Documents Portal — PRD

## Original Problem Statement
Responsive web app for an accounting practice to let clients see their outstanding bookkeeping documents (purchase / sales invoices) and submit a photo (or comment) against each item. Submissions are forwarded by email to the client's dedicated AutoEntry inbox.

## User Roles
- **Administrator** — single seeded account `admin@eposaccountancy.co.uk`. Manages clients, uploads CSVs of outstanding invoices per client, configures SMTP, reviews submissions.
- **Client** — logs in with email/password, sees outstanding items per type, submits photo (camera or upload) or "no photo + comment" against each.

## Architecture
- **Backend**: FastAPI + Motor + MongoDB. JWT in httpOnly cookie with `Authorization: Bearer` fallback. bcrypt password hashing. Fernet-encrypted SMTP password at rest.
- **Frontend**: React + react-router + shadcn/ui + sonner toasts. Mobile-first layout. Warm "Organic & Earthy" palette (deep forest green primary, sand background, terracotta accent), Cabinet Grotesk + Work Sans fonts.
- **Image stamping**: Pillow renders a semi-transparent black band with the submission timestamp + comment onto the bottom of the photo before emailing.
- **Email**: `smtplib` (with TLS) in a threadpool wrapped by `asyncio.wait_for` (15 s) + `socket.setdefaulttimeout(10)`. Errors return HTTP 400 with JSON detail (4xx avoids Cloudflare overriding 5xx with HTML).
- **Local file storage** at `/app/backend/uploads/` — abstracted by a single helper so swapping to S3 is straightforward.

## Implemented (Feb 2026)
- Custom JWT auth (login / me / logout) with role gates `require_admin` / `require_client`.
- Admin client CRUD + search + password reset.
- Admin CSV upload (purchase / sales) — flexible column mapping, replaces previous list.
- Admin SMTP settings page (encrypted password + DELETE to clear).
- Admin submissions table with filters (client / type / status / search) + image preview + reset-to-outstanding.
- Client dashboard with large outstanding counts.
- Client outstanding list (search, status badges, submitted items locked).
- Client submission screen: take photo / upload photo / no photo + comment (mandatory rules enforced).
- Image stamping (semi-transparent watermark with date/time/comment).
- Email submission only marks item submitted on success.

## Updates (Jun 2026)
- Watermark text enlarged (~2x): bold title `W//24` and bold comment `W//30`, taller semi-transparent band, more padding/leading. Verified with a generated test image.
- **Additional invoice submission**: clients can submit invoices not on their outstanding list from the Purchase/Sales list pages ("Add another invoice" → `/portal/submit-additional/:type`). Requires a description + photo/comment. Backend `POST /api/client/submit-additional`; logged in Submissions with `is_additional` flag (shown as "Additional" badge in admin) and emailed (subject/body flag it).
- **White-page image for no-photo submissions**: the "No photo needed" flow (existing items AND additional) now auto-generates a clean white A4-style JPEG containing the description, timestamp and comment (`render_document_page`), so an image attachment is always emailed. Verified via curl + admin submissions (image_filename now populated for no-photo).

## Backlog (P1/P2 — deferred for first finish)
- P1 — Capacitor project setup (Android + iOS platforms, config, permissions/icons) — files only, no binary builds (per user).
- P1 — CSV duplicate detection summary on upload (count of identical invoice numbers).
- P1 — CSV export of submissions.
- P1 — Audit log of admin actions.
- P1 — Automatic email reminders for items outstanding > N days.
- P2 — Push notifications.
- P2 — OCR on uploaded invoices.
- P2 — AutoEntry API integration.
- P2 — Multiple administrators / practice multi-user.
- P2 — Dashboard analytics (submission velocity, per-client backlog trend).
- P2 — S3 storage backend (swap in by replacing the file helper).

## Test Credentials
See `/app/memory/test_credentials.md`.
