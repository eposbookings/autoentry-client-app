# Project Notes

This file is the practical handover for Codex/new chats. It records the setup that is currently working and the deployment rules we want to follow.

## Current Working Setup

Local frontend:

`http://localhost:3000/login`

Local API health:

`http://localhost:8000/api/health`

VPS app:

`http://45.8.225.73/login`

VPS API health:

`http://45.8.225.73/api/health`

VPS project path:

`/opt/autoentry-client-app`

Database:

MySQL / SQL

Expected health response:

```json
{"ok":true,"database":"sql"}
```

SMTP:

Working.

## Development Flow

1. Make changes locally.
2. Test changes on localhost first.
3. Commit and push with GitHub Desktop.
4. Open and merge the pull request manually on GitHub.
5. Run the GitHub Action named `Sync code to 20i VPS`.
6. Confirm the VPS has the latest code.
7. Restart or rebuild VPS containers only when needed.

## Deployment Rule

The GitHub Action should only sync code to the VPS unless we intentionally change it.

Do not install packages, rebuild Docker images, change Docker config, or change VPS config unless explicitly requested.

## Useful VPS Commands

Always go to the project folder first:

```bash
cd /opt/autoentry-client-app
```

Check containers:

```bash
docker compose ps
```

Check API health from the VPS:

```bash
curl -i http://localhost:8000/api/health
```

Check recent logs:

```bash
docker compose logs --tail=80 api
docker compose logs --tail=80 mysql
docker compose logs --tail=80 nginx
```

## Important Notes

- The app has moved away from MongoDB. Current database is MySQL.
- The live app currently runs from the 20i VPS IP.
- The domain/DNS can be handled later after the IP version is stable.
- If a new Codex chat is opened, ask it to read this file first.
