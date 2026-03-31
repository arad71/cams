# CAMS — Local Development Guide

Run CAMS on your machine without Docker. Backend (uvicorn) + Frontend (vite) with hot reload.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Your Machine                                │
│                                              │
│  ┌───────────────────┐  ┌────────────────┐  │
│  │ approval-frontend  │  │ PostgreSQL     │  │
│  │ (vite dev server) │  │ (local)        │  │
│  │ localhost:5173    │  │ localhost:5432  │  │
│  └────────┬──────────┘  └───────┬────────┘  │
│           │ API proxy           │            │
│  ┌────────┴─────────────────────┴─────┐     │
│  │       approval-api                  │     │
│  │       (uvicorn --reload)            │     │
│  │       localhost:8000                │     │
│  └─────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

---

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| PostgreSQL | 14+ | `psql --version` |
| Python | 3.11+ | `python3 --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |

### Install PostgreSQL

**Ubuntu/WSL**:
```bash
sudo apt update && sudo apt install -y postgresql postgresql-client
sudo systemctl start postgresql
```

**macOS**:
```bash
brew install postgresql@16 && brew services start postgresql@16
```

**Windows**: Download from https://www.postgresql.org/download/windows/

---

## Quick Start

```bash
cd cams
./run-local.sh setup     # Create DB, Python venv, install deps, seed
./run-local.sh start     # Start backend + frontend (Ctrl+C stops both)
```

Open http://localhost:5173

---

## Step by Step

### 1. Clone and Enter

```bash
git clone https://github.com/arad71/cams.git
cd cams
```

### 2. Create Database

```bash
createdb cams_approval
# Or: sudo -u postgres createdb cams_approval
```

### 3. Setup Backend

```bash
cd approval-backend
python3 -m venv .venv
source .venv/bin/activate          # Linux/Mac
# .venv\Scripts\activate           # Windows
pip install -r requirements.txt
cd ..
```

### 4. Setup Frontend

```bash
cd approval-frontend
npm install
cd ..
```

### 5. Environment Config

The script auto-copies `.env.test` → `.env` with local defaults. Or manually:

```bash
cp .env.test .env
```

Add to `.env` (the script adds this automatically):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cams_approval
```

For AI features, also set:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### 6. Seed Database

```bash
cd approval-backend
source .venv/bin/activate
python -c "from app.seed import run_seed; run_seed()"
cd ..
```

### 7. Run

**Both together** (one terminal):
```bash
./run-local.sh start
```

**Or separately** (two terminals):

Terminal 1 — Backend:
```bash
cd approval-backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Terminal 2 — Frontend:
```bash
cd approval-frontend
npx vite --host 0.0.0.0
```

---

## URLs

| Service | URL |
|---------|-----|
| Portal | http://localhost:5173 |
| API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |

## Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Super Admin | superadmin@council.wa.gov.au | superpassword123 |
| Admin | admin@council.wa.gov.au | admin123 |
| Manager | manager@council.wa.gov.au | manager123 |
| Engineer | engineer@council.wa.gov.au | engineer123 |
| Viewer | viewer@council.wa.gov.au | viewer123 |

---

## run-local.sh Commands

```
./run-local.sh setup     First time: DB + venv + deps + seed
./run-local.sh start     Backend + frontend together
./run-local.sh backend   Backend only (uvicorn :8000)
./run-local.sh frontend  Frontend only (vite :5173)
./run-local.sh seed      Clear all data + reseed
./run-local.sh dbcreate  Create PostgreSQL database
```

---

## Common Issues

### uvicorn: FileNotFoundError: No such file or directory

WSL issue — the working directory handle is stale. Fix:
```bash
cd /mnt/c/Projects_Self/cams/approval-backend
source .venv/bin/activate
uvicorn app.main:app --reload
```
Or close terminal and reopen.

### psql: connection refused

PostgreSQL not running:
```bash
sudo systemctl start postgresql       # Linux
brew services start postgresql@16     # macOS
```

### createdb: role "postgres" does not exist

Create the role:
```bash
sudo -u postgres createuser -s $USER
createdb cams_approval
```

### npm install fails

Clear cache and retry:
```bash
cd approval-frontend
rm -rf node_modules package-lock.json
npm install
```

### Port already in use

Kill existing process:
```bash
lsof -ti:8000 | xargs kill -9    # Backend
lsof -ti:5173 | xargs kill -9    # Frontend
```

---

## Database Reset

```bash
./run-local.sh seed
```

This clears all applications, assessments, documents, and AI data, then re-seeds users, rules, and sample apps.

---

## Frontend Proxy Config

The vite dev server proxies `/api` requests to the backend. Check `approval-frontend/vite.config.js`:

```js
server: {
  proxy: {
    '/api': 'http://localhost:8000'
  }
}
```

If your backend runs on a different port, update this.
