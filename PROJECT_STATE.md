# PROJECT_STATE — EPOS Accountancy · Outstanding Documents Portal

_Last updated: 12 Jul 2026_

## 1. Current Project Status
A fully functional full-stack web app for an accounting practice (EPOS Accountancy).
Clients log in to view their outstanding purchase/sales invoices and submit a photo
(or a "no photo + comment") against each item. Every submission is watermarked
(timestamp + comment) and emailed to the client's dedicated AutoEntry inbox via
Amazon SES. Admins manage clients, upload CSVs of outstanding items, configure SMTP,
and review submissions. **Status: stable and deployed to production.**

## 2. Git
- **Branch:** `main`
- **Latest commit (at handoff prep):** `f5c48c0f148226c8de06173e668425d889acaad3`
- NOTE: This `PROJECT_STATE.md`, `README.md`, and untracked `yarn.lock` files still
  need to be committed/pushed via the Emergent **"Save to GitHub"** button (the agent
  cannot push directly). After pushing, update the commit SHA above.

## 3. Deployment
- **Production URL:** https://outstanding-items.emergent.host — **LIVE / healthy**
  (frontend HTTP 200, `/api/*` HTTP 200 verified 12 Jul 2026).
- **Preview/dev:** https://outstanding-items.preview.emergentagent.com
- **Custom domain (GoDaddy):** in progress — user was setting up a GoDaddy domain;
  DNS/SSL binding is a production/platform concern (handled via Emergent deploy
  settings / Emergent Support), not in app code. Verification pending user input.
- Deployment method: Emergent one-click deploy (managed MongoDB provided by platform).

## 4. Database
- **Engine:** MongoDB (via Motor async driver).
- **Connected instance:** configured through `MONGO_URL` (local in preview; managed
  MongoDB in the Emergent production deployment). **Secrets not stored in this file.**
- **Database name:** provided via `DB_NAME`.
- **Collections:** `users`, `outstanding_items`, `submissions`, `settings`.
- NOTE: A future migration to **PostgreSQL + multi-tenant foundation** was discussed
  (recommended for the long-term Dext/accountancy/HR/payroll platform vision) but
  **NOT yet started**. Current code is MongoDB.

## 5. Environment
- **Production** and **development** both run the same codebase; behaviour driven by
  environment variables only.

## 6. Required Environment Variables (names only — do NOT regenerate/expose values)
**Backend (`backend/.env`):**
- `MONGO_URL`
- `DB_NAME`
- `CORS_ORIGINS`
- `JWT_SECRET`
- `FERNET_KEY`  ⚠️ MUST be preserved — decrypts stored SMTP passwords. Regenerating it
  breaks saved SMTP settings.
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `UPLOAD_DIR`

**Frontend (`frontend/.env`):**
- `REACT_APP_BACKEND_URL`
- `WDS_SOCKET_PORT`
- `ENABLE_HEALTH_CHECK`

## 7. Features Completed
- JWT auth via httpOnly cookie (+ Bearer fallback); admin/client role gates.
- Admin: client CRUD + search + password reset.
- Admin: CSV upload per client (purchase/sales; columns `Description, Date, Amount`;
  replaces the previous list; DD/MM/YYYY normalisation; detailed row errors).
- Admin: SMTP settings (Amazon SES). **AWS IAM → SES SMTP password auto-conversion**
  toggle (derives the correct SES SMTP password from an IAM Secret Access Key;
  region auto-detected from the `email-smtp.<region>.amazonaws.com` host).
- Admin: submissions table with filters + image preview + "Additional" badge.
- Client: dashboard counts, outstanding lists (search), submit screen
  (take photo / upload / no-photo+comment with mandatory rules).
- **Additional invoice submission** ("Add another invoice") for items NOT on the
  outstanding list — description + photo/comment; logged & tagged as Additional.
- **Image watermarking** (Pillow) — timestamp + comment stamped on a dark band;
  fonts bundled in-repo at `backend/assets/fonts/` (DejaVuSans + Bold) so text is
  large/legible in both preview and production.
- **White-page image generation** for "no photo" submissions (so an attachment is
  always emailed).
- Email delivery via smtplib/SES; SMTP failures return HTTP 400 (intentional — avoids
  Cloudflare replacing JSON errors with HTML).
- Mobile app download buttons on the login page (APK/IPA served from backend if present).
- "Made with Emergent" badge removed from `frontend/public/index.html`.

## 8. Features In Progress / Pending
- **GoDaddy custom domain verification** (production/platform side).
- **Capacitor native wrapper setup** (Android + iOS project files only, no binary
  builds) — NOT started.
- **PostgreSQL migration + multi-tenant foundation** — planned/agreed direction, NOT
  started. Would break Emergent one-click deploy (needs self-hosted/managed Postgres).

## 9. Known Issues
- Amount field can display a broken `�` instead of `£` in the client list (likely a
  CSV encoding nuance on upload) — not yet fixed (user hasn't confirmed a fix).
- Minor a11y console warning: `DialogContent` missing description on the admin
  submission preview dialog (non-blocking).
- Test data left in the DB from QA: client `testclient@example.com` and various
  `TEST_watermark_*` items (safe to delete).
- `server.py` is ~965 lines — consider splitting into modules (auth / clients /
  submissions / settings) in a future refactor.

## 10. Next Recommended Tasks
1. Confirm/complete the GoDaddy custom domain (DNS CNAME → deployment + SSL).
2. Decide & (if agreed) execute the **PostgreSQL + multi-tenant** migration before the
   codebase grows — foundation for the Dext / accountancy / HR / payroll roadmap.
3. Optional quick wins: "Send test email" button on SMTP settings; fix the `£`
   encoding; CSV export of submissions; admin audit log.
4. Capacitor project setup (files only) if native apps are still desired.

## 11. Test Credentials
See `/app/memory/test_credentials.md`. Admin: `admin@eposaccountancy.co.uk`.
(Values live in that file / env — not duplicated here.)

## 12. Reference Docs In Repo
- `/app/memory/PRD.md` — product requirements & change log.
- `/app/memory/test_credentials.md` — test accounts.
- `/app/test_reports/iteration_*.json` — QA reports (watermark, SES, badge, etc.).
