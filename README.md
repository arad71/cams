# CAMS — Council Approval Management System

Crossover (driveway) permit assessment system for Western Australian local councils.

## Features

- Officers upload crossover applications with site plans
- AI extracts dimensions, materials, utilities from site plan PDFs
- 206 assessment rules auto-check compliance (12 categories, 70 items)
- Interactive map with sight triangle analysis, corner lot detection, 3D terrain
- PDF measure tool for on-screen verification
- Officer review dashboard with pass/fail/review/n/a checklist
- Document management, audit logging, role-based access
- Admin rule editor with field dropdowns, priority reordering

## Tech Stack

- **Frontend**: React + Vite, Leaflet maps, nginx
- **Backend**: FastAPI, SQLAlchemy, PostgreSQL
- **AI**: Anthropic Claude (site plan analysis)
- **Deploy**: Docker Compose, Azure

## Quick Start

```bash
# First-time Azure VM setup (Docker)
curl -fsSL https://raw.githubusercontent.com/arad71/cams/master/setup-azure.sh -o setup.sh
sudo bash setup.sh

# Or if repo is already cloned (Docker)
./deploy.sh test       # Test environment (Docker DB)
./deploy.sh prod       # Production (external DB)
```

### Local Development (no Docker)

```bash
# Prerequisites: PostgreSQL on localhost:5432, Python 3.11+, Node 18+
./run-local.sh setup     # Create DB, venv, install deps, seed
./run-local.sh start     # Start backend (uvicorn :8000) + frontend (vite :5173)
```

Or run separately:
```bash
./run-local.sh backend   # uvicorn on :8000 with hot reload
./run-local.sh frontend  # vite dev server on :5173
./run-local.sh seed      # Re-seed database (clears all data)
```

## Deploy Commands

```
./deploy.sh test       Deploy test environment (Docker DB)
./deploy.sh prod       Deploy production (external DB)
./deploy.sh status     Show what's running
./deploy.sh logs       View logs
./deploy.sh update     Pull latest + rebuild
./deploy.sh backup     Backup database
./deploy.sh reset      Reset database
./deploy.sh reseed     Re-seed assessment rules only
./deploy.sh stop       Stop services
```

## Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@council.wa.gov.au | admin123 |
| Manager | manager@council.wa.gov.au | manager123 |
| Engineer | engineer@council.wa.gov.au | engineer123 |
| Viewer | viewer@council.wa.gov.au | viewer123 |

## Repository Structure

```
cams/
├── approval-backend/          FastAPI backend
│   ├── app/api/               REST endpoints
│   ├── app/models/            SQLAlchemy models
│   ├── app/services/          AI analyser, extractor
│   ├── app/seed.py            Database seed data
│   └── scripts/               Reference documents
├── approval-frontend/         React SPA
│   ├── src/components/        Map, UI components
│   ├── src/views/             Pages
│   └── public/                GeoJSON data
├── .env.test                  Test config template
├── .env.production            Production config template
├── deploy.sh                  Deploy/manage script
├── setup-azure.sh             First-time VM setup
├── docker-compose.prod.yml    Test (Docker DB)
├── docker-compose.external-db.yml  Production (external DB)
├── DEPLOY-LOCAL.md            Local dev guide (uvicorn + vite)
├── DEPLOY-TEST.md             Test deployment (Azure VM + Docker DB)
├── DEPLOY.md                  Production deployment (Azure VM + external DB)
```

## Deployment Options

| | Test | Production |
|---|---|---|
| Command | `./deploy.sh test` | `./deploy.sh prod` |
| Database | Docker container | Azure Flexible Server |
| Backups | Manual | Automated daily |
| SSO | Disabled | Entra ID |
| Cost | ~$50 AUD/mo | ~$80 AUD/mo |
