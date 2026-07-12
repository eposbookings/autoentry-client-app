# EPOS Accountancy — Outstanding Documents Portal

A full-stack portal for an accounting practice. Clients log in to view their
outstanding purchase/sales invoices and submit a photo (or a comment) against each
item. Submissions are watermarked with a timestamp + comment and emailed to the
client's dedicated AutoEntry inbox via Amazon SES. Admins manage clients, upload CSVs
of outstanding items, configure SMTP, and review submissions.

> For full status, architecture, and roadmap see **[`PROJECT_STATE.md`](./PROJECT_STATE.md)**
> and **[`memory/PRD.md`](./memory/PRD.md)**.

## Tech Stack
- **Frontend:** React, React Router, Tailwind CSS, shadcn/ui, Axios, sonner.
- **Backend:** FastAPI, Motor (async MongoDB), Pillow (image watermarking),
  smtplib (Amazon SES email), Fernet (SMTP password encryption at rest).
- **Database:** MongoDB (collections: `users`, `outstanding_items`, `submissions`,
  `settings`).

## Repository Layout
```
/app
├── backend/
│   ├── server.py            # FastAPI app: auth, clients, CSV, submissions, SMTP, image stamping
│   ├── assets/fonts/        # Bundled DejaVu TTF fonts (used by watermark rendering)
│   ├── uploads/             # Submitted/generated images (persistent, writable)
│   ├── tests/               # pytest suites (SMTP conversion, watermark)
│   ├── requirements.txt
│   └── .env                 # backend env vars (not committed)
├── frontend/
│   ├── src/pages/{admin,client}/ ...
│   └── .env                 # frontend env vars (not committed)
├── memory/                  # PRD.md, test_credentials.md
├── test_reports/            # QA iteration reports
└── PROJECT_STATE.md         # Handoff / current state
```

## Environment Variables
**Backend (`backend/.env`):** `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`, `JWT_SECRET`,
`FERNET_KEY` (⚠️ must be preserved — decrypts stored SMTP passwords), `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, `UPLOAD_DIR`.

**Frontend (`frontend/.env`):** `REACT_APP_BACKEND_URL`, `WDS_SOCKET_PORT`,
`ENABLE_HEALTH_CHECK`.

> All backend API routes are prefixed with `/api`. The frontend must call the backend
> via `REACT_APP_BACKEND_URL`. Do not hardcode URLs or secrets.

## Local Development
```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend
cd frontend
yarn install
yarn start
```
On Emergent, services are supervisor-managed (backend :8001, frontend :3000) with hot
reload; restart only after `.env` or dependency changes:
`sudo supervisorctl restart backend frontend`.

## Deployment
- **Production (Emergent managed):** https://outstanding-items.emergent.host — managed
  MongoDB is provisioned automatically by the platform; set env vars in the deploy
  settings. Redeploy from the Emergent chat after pushing changes.
- **Self-hosting (VPS):** build the frontend (`yarn build`) and serve it via Nginx;
  run the backend with `uvicorn server:app` behind Nginx (proxy `/api/*` → :8001);
  provide your own MongoDB (Atlas or local) and set the env vars above; add SSL via
  Let's Encrypt. Ensure `backend/assets/fonts/` is deployed (needed for watermarks).

## Amazon SES SMTP Note
SES does not accept a raw IAM Secret Access Key as an SMTP password. In Admin →
SMTP Settings, enable **"I'm pasting an AWS IAM Secret Access Key"** and the app will
derive the correct SES SMTP password automatically (region detected from the
`email-smtp.<region>.amazonaws.com` host). The IAM user needs `ses:SendRawEmail`.

## Test Credentials
See `memory/test_credentials.md`.

## Current Git Flow
Development changes are committed locally, pushed to the `deployment` branch on
GitHub, and then deployed to the VPS separately. The VPS deploy workflow is currently
manual-only while SSH deployment is being stabilised.
