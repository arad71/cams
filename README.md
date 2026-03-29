# CAMS — Council Approval Management System

Crossover (driveway) permit assessment system for Western Australian local councils.

## What it does

- Officers upload crossover applications with site plans
- AI extracts dimensions, materials, utilities from site plan PDFs
- 206 assessment rules auto-check compliance (12 categories, 70 items)
- Interactive map with sight triangle analysis, corner lot detection, 3D terrain
- PDF measure tool for on-screen verification
- Officer review dashboard with pass/fail/review checklist
- Document management, audit logging, role-based access

## Tech Stack

- **Frontend**: React + Vite, Leaflet maps, nginx
- **Backend**: FastAPI, SQLAlchemy, PostgreSQL
- **AI**: Anthropic Claude (site plan analysis)
- **Deploy**: Docker Compose, Azure

## Quick Start (Test)

```bash
git clone https://github.com/arad71/cams.git
cd cams
./deploy.sh test
```

Opens at `http://localhost:3001` with test accounts:

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@council.wa.gov.au | admin123 |
| Manager | manager@council.wa.gov.au | manager123 |
| Engineer | engineer@council.wa.gov.au | engineer123 |
| Viewer | viewer@council.wa.gov.au | viewer123 |

## Deploy

| Command | What it does |
|---------|-------------|
| `./deploy.sh test` | Test environment (Docker DB, ~$50 AUD/mo) |
| `./deploy.sh prod` | Production (Azure Postgres, ~$80 AUD/mo) |
| `./deploy.sh stop` | Stop services |
| `./deploy.sh update` | Pull latest + rebuild |
| `./deploy.sh backup` | Dump database to SQL |
| `./deploy.sh status` | Show what's running |
| `./deploy.sh reseed` | Re-seed assessment rules |

See [DEPLOY-AZURE.md](DEPLOY-AZURE.md) and [DEPLOY-PRODUCTION.md](DEPLOY-PRODUCTION.md) for full guides.

## Project Structure

```
cams/
├── approval-backend/        FastAPI backend
│   ├── app/
│   │   ├── api/             API endpoints
│   │   ├── models/          SQLAlchemy models
│   │   ├── services/        AI analyser, audit, etc
│   │   └── seed.py          Database seed (users, rules, test data)
│   ├── Dockerfile
│   └── requirements.txt
├── approval-frontend/       React frontend
│   ├── src/
│   │   ├── App.jsx          Main app
│   │   ├── components/      Map, UI components
│   │   ├── views/           Pages (login, list, detail, admin)
│   │   └── services/        API client
│   ├── public/              GeoJSON data files
│   ├── Dockerfile
│   └── nginx.conf
├── deploy.sh                Deploy/manage script
├── setup-azure.sh           One-line Azure VM setup
├── docker-compose.prod.yml  Test (includes DB)
├── docker-compose.external-db.yml  Production (external DB)
├── .env.test                Test config template
└── .env.production          Production config template
```
