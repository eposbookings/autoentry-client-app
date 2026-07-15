# EPOS Accountancy - Outstanding Documents Portal

A full-stack portal for EPOS Accountancy. Clients log in to view outstanding
purchase/sales invoices and submit supporting documents. Admins manage clients,
upload outstanding-item CSVs, configure SMTP/OpenAI settings, and review
submissions.

Current handover: see [PROJECT_NOTES.md](./PROJECT_NOTES.md) first.

## Tech Stack

- Frontend: React, React Router, Tailwind CSS, shadcn/ui, Axios, sonner.
- Backend: FastAPI, SQLAlchemy async, MySQL, Pillow, pypdf/reportlab, smtplib.
- Database: MySQL / SQL.
- Deployment: Docker Compose on the 20i VPS.

## Repository Layout

```text
backend/
  server.py              FastAPI app: auth, clients, CSV, submissions, settings
  assets/fonts/          Bundled DejaVu fonts
  uploads/               Submitted/generated documents
  requirements.txt       Production API dependencies
frontend/
  src/pages/             Admin/client/login screens
  src/components/Brand.jsx
  src/assets/epos-logo.png
  public/favicon.png
.github/workflows/       Manual VPS deployment workflow
```

## Environment Variables

Backend (`backend/.env`):

- `DATABASE_URL`
- `CORS_ORIGINS`
- `FRONTEND_URL` - public frontend origin used after OAuth callbacks.
- `BACKEND_URL` - public backend origin used to build OAuth callback defaults.
- `JWT_SECRET`
- `FERNET_KEY` - preserve this; it decrypts saved SMTP/OpenAI settings.
- `COOKIE_SECURE` - use `true` on HTTPS/live.
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `UPLOAD_DIR`
- optional: `OPENAI_API_KEY`, `OPENAI_INVOICE_CHECK_MODEL`
- optional: `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`,
  `QUICKBOOKS_ENVIRONMENT`, `QUICKBOOKS_REDIRECT_URI`

Frontend (`frontend/.env`):

- `REACT_APP_BACKEND_URL`
- `WDS_SOCKET_PORT`
- `ENABLE_HEALTH_CHECK`

All backend API routes are prefixed with `/api`.

## Local Development

Frontend:

```bash
cd frontend
pnpm install
pnpm start
```

Backend:

```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

Local frontend: `http://localhost:3000`

Local API health: `http://localhost:8000/api/health`

## Deployment

- Production VPS: `45.8.225.73`
- Database: MySQL
- Domain DNS: GoDaddy A record points to the VPS IP.
- Deployment flow: GitHub Desktop -> PR -> manual merge -> GitHub Action
  `Sync code to 20i VPS`.
- The workflow builds the frontend and API Docker image on GitHub, copies artifacts
  to the VPS, then restarts Docker services.

Work locally first. Do not change the VPS unless explicitly requested.

### Live Environment Checklist

For `https://eposbookings.net`, the VPS `.env` should include:

```bash
REACT_APP_BACKEND_URL=https://eposbookings.net
CORS_ORIGINS=https://eposbookings.net,https://www.eposbookings.net,http://45.8.225.73
FRONTEND_URL=https://eposbookings.net
BACKEND_URL=https://eposbookings.net
COOKIE_SECURE=true
QUICKBOOKS_ENVIRONMENT=production
QUICKBOOKS_REDIRECT_URI=https://eposbookings.net/api/integrations/quickbooks/callback
```

In the Intuit developer portal, add the exact production Redirect URI:

```text
https://eposbookings.net/api/integrations/quickbooks/callback
```

Use production QuickBooks keys for live testing. Development/sandbox keys should
stay with local or sandbox testing.

## Document Submission

- Clients can upload images or PDFs.
- Images and PDFs can run through OpenAI document review when enabled for the client.
- Warnings can be approved by the client and submitted anyway.
- Comments/approval notes are added as a separate PDF page, not over the invoice.

## Amazon SES SMTP Note

SES does not accept a raw IAM Secret Access Key as an SMTP password. In Admin ->
SMTP Settings, enable "I'm pasting an AWS IAM Secret Access Key" and the app will
derive the SES SMTP password automatically. The IAM user needs `ses:SendRawEmail`.
