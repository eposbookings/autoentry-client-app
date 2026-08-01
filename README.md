# EPOS Accountancy App

Parent repository for the EPOS Accountancy platform. It contains the connected
Client App and Fieldcraft PDF form-authoring project while retaining the existing
Git remote and deployment history.

Current Client App handover: see [PROJECT_NOTES.md](<./Client App/PROJECT_NOTES.md>) first.

## Tech Stack

- Frontend: React, React Router, Tailwind CSS, shadcn/ui, Axios, sonner.
- Backend: FastAPI, SQLAlchemy async, MySQL, Pillow, pypdf/reportlab, smtplib.
- Payroll: lazy React module plus a private, signed TypeScript payroll worker.
- Database: MySQL / SQL, with a dedicated SQLite volume for the existing payroll ledger.
- Deployment: Docker Compose on the 20i VPS.

## Repository Layout

```text
Client App/
  backend/
    server.py            FastAPI app and accounting services
    assets/              Official and generated document templates
    uploads/             Submitted/generated documents
  frontend/
    src/                 React application
    public/              Browser assets and official form previews
Payroll 2/               Complete payroll source, migrations, tests and worker data
PDF Editor and Viewer/
  src/                   Fieldcraft Electron application
  package.json           Fieldcraft runtime and dependencies
.github/workflows/       Manual VPS deployment workflow
```

## Environment Variables

Backend (`Client App/backend/.env`):

- `DATABASE_URL`
- `CORS_ORIGINS`
- `FRONTEND_URL` - public frontend origin used after OAuth callbacks.
- `BACKEND_URL` - public backend origin used to build OAuth callback defaults.
- `JWT_SECRET`
- `PAYROLL_INTEGRATION_SECRET` - a separate random value of at least 32 characters, shared only by FastAPI and the private payroll worker
- `FERNET_KEY` - preserve this; it decrypts saved SMTP/OpenAI settings.
- `COOKIE_SECURE` - use `true` on HTTPS/live.
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` for the higher-level platform login that creates practice accounts and owns global integration settings
- `DEFAULT_PRACTICE_NAME` for the migration tenant assigned to existing administrators and clients
- `UPLOAD_DIR`
- optional: `OPENAI_API_KEY`, `OPENAI_INVOICE_CHECK_MODEL`
- optional: `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`,
  `QUICKBOOKS_ENVIRONMENT`, `QUICKBOOKS_REDIRECT_URI`
- optional: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`
- optional: `SAGE_CLIENT_ID`, `SAGE_CLIENT_SECRET`, `SAGE_REDIRECT_URI`

Frontend (`Client App/frontend/.env`):

- `REACT_APP_BACKEND_URL`
- `WDS_SOCKET_PORT`
- `ENABLE_HEALTH_CHECK`

All backend API routes are prefixed with `/api`.

Payroll is mounted at `/admin/payroll/:clientId`. The menu is populated only from clients whose `service_settings.payroll.enabled` flag is true. Every `/api/payroll/*` request repeats EPOS authentication, practice ownership, active-client and service-entitlement checks before the private worker is called.

## Local Development

On Windows, `Start Client App.cmd` starts the frontend, FastAPI backend and private Payroll worker together with one temporary shared signing secret.

Frontend:

```bash
cd "Client App/frontend"
pnpm install
pnpm start
```

Backend:

```bash
cd "Client App/backend"
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
PAYROLL_INTEGRATION_SECRET=replace-with-a-separate-random-secret-of-at-least-32-characters
COOKIE_SECURE=true
QUICKBOOKS_ENVIRONMENT=production
QUICKBOOKS_REDIRECT_URI=https://eposbookings.net/api/integrations/quickbooks/callback
XERO_REDIRECT_URI=https://eposbookings.net/api/integrations/xero/callback
SAGE_REDIRECT_URI=https://eposbookings.net/api/integrations/sage/callback
```

In the Intuit developer portal, add the exact production Redirect URI:

```text
https://eposbookings.net/api/integrations/quickbooks/callback
```

Register the matching Xero and Sage callback URIs in their developer portals:

```text
https://eposbookings.net/api/integrations/xero/callback
https://eposbookings.net/api/integrations/sage/callback
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
