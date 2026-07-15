# PROJECT_STATE - EPOS Accountancy Outstanding Documents Portal

Last updated: 15 Jul 2026

## Current Status

Full-stack client document submission portal for EPOS Accountancy.

Clients can:
- sign in to the portal,
- view outstanding purchase/sales invoice items,
- upload images or PDFs,
- submit additional invoices,
- approve AI document-check warnings and submit anyway.

Admins can:
- manage clients,
- upload outstanding-item CSVs,
- configure SMTP,
- configure OpenAI document checks,
- review submitted documents.
- configure QuickBooks client integrations.
- disable the admin document-processing inbox without changing the client
  submission/email flow.

## Current Stack

- Frontend: React on port 3000 locally.
- Backend: FastAPI on port 8000 locally.
- Database: MySQL / SQL.
- Production: 20i VPS at `45.8.225.73`.
- Domain: GoDaddy DNS pointing to the VPS.

## Deployment

Work locally first. Do not change the VPS unless explicitly requested.

Normal deployment flow:
1. GitHub Desktop
2. PR
3. Manual merge
4. GitHub Action `Sync code to 20i VPS`

The deployment workflow builds the frontend and API Docker image on GitHub, copies
artifacts to the VPS, then restarts Docker Compose services.

## Important Runtime Notes

- Preserve `FERNET_KEY`; it decrypts saved SMTP/OpenAI settings.
- Local frontend: `http://localhost:3000`
- Local API health: `http://localhost:8000/api/health`
- VPS login: `http://45.8.225.73/login`
- Live frontend/API origin: `https://eposbookings.net`
- Live QuickBooks callback:
  `https://eposbookings.net/api/integrations/quickbooks/callback`
- On live HTTPS, set `COOKIE_SECURE=true`.
- Set `FRONTEND_URL` and `BACKEND_URL` to `https://eposbookings.net` so OAuth
  redirects return to the live app correctly.

## Recent Features

- OpenAI document review for client uploads.
- Per-client AI analysis toggle.
- Per-client VAT client toggle.
- Client warning flow with submit-anyway approval.
- Image and PDF uploads.
- PDF/image comments and approval notes added as a separate PDF page.
- EPOS Accountancy logo and browser tab branding.
- QuickBooks OAuth connection with chart of accounts, suppliers and customers.
- Admin feature toggle for the Submitted items/document-processing inbox.
