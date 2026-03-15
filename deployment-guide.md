# Kalamunda Crossover System — Deployment & Project Structure Guide

## System Overview

The Kalamunda Crossover system consists of **4 components** that work together:

```
┌─────────────────────────────────────────────────────────────────┐
│                        INTERNET / LAN                           │
├─────────────────────┬───────────────────────────────────────────┤
│   PUBLIC FACING     │          INTERNAL (OFFICERS)              │
│                     │                                           │
│  ┌───────────────┐  │  ┌───────────────┐                       │
│  │  Applicant    │  │  │  Approval     │                       │
│  │  Frontend     │  │  │  Frontend     │                       │
│  │  (React)      │  │  │  (React)      │                       │
│  │  Port 3000    │  │  │  Port 3001    │                       │
│  └───────┬───────┘  │  └───────┬───────┘                       │
│          │          │          │                                │
│  ┌───────▼───────┐  │  ┌───────▼───────┐                       │
│  │  Applicant    │  │  │  Approval     │                       │
│  │  Backend API  │  │  │  Backend API  │                       │
│  │  (FastAPI)    │  │  │  (FastAPI)    │                       │
│  │  Port 8001    │  │  │  Port 8000    │                       │
│  └───────┬───────┘  │  └───────┬───────┘                       │
│          │          │          │                                │
│  ┌───────▼───────┐  │  ┌───────▼───────┐                       │
│  │  PostgreSQL   │  │  │  PostgreSQL   │                       │
│  │  Port 5433    │  │  │  Port 5432    │                       │
│  │  applicant_db │  │  │  approval_db  │                       │
│  └───────────────┘  │  └───────────────┘                       │
└─────────────────────┴───────────────────────────────────────────┘
```

| Component | Purpose | Port | Tech |
|-----------|---------|------|------|
| Applicant Frontend | Public 8-step wizard | 3000 | React (JSX) |
| Applicant Backend | Application CRUD, uploads, AI review | 8001 | FastAPI + PostgreSQL |
| Approval Frontend | Officer dashboard, checklist, maps | 3001 | React (JSX) |
| Approval Backend | Assessment, reports, user management | 8000 | FastAPI + PostgreSQL |

---

## Complete Project Structure

```
kalamunda-crossover/
│
├── docker-compose.yml              ← Master compose (all 4 services + 2 DBs)
├── nginx.conf                      ← Reverse proxy (optional, for production)
├── .env                            ← Shared environment variables
│
├── applicant-frontend/             ← PUBLIC applicant portal
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── main.jsx                ← Entry point
│       └── App.jsx                 ← kalamunda-crossover-app-v3.jsx content
│
├── approval-frontend/              ← INTERNAL officer portal
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── public/
│   └── src/
│       ├── main.jsx
│       └── App.jsx                 ← kalamunda-approval-portal-v3-sight.jsx content
│
├── applicant-backend/              ← PUBLIC API
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/
│   └── app/
│       ├── __init__.py
│       ├── main.py                 ← FastAPI app (port 8001)
│       ├── seed.py                 ← Reference data + sample applicants
│       ├── core/
│       │   ├── __init__.py
│       │   ├── config.py           ← Pydantic settings from .env
│       │   ├── database.py         ← SQLAlchemy engine + session
│       │   └── auth.py             ← JWT auth for public applicants
│       ├── models/
│       │   ├── __init__.py
│       │   ├── applicant.py        ← Applicant (public user)
│       │   ├── application.py      ← CrossoverApplication, Documents, Drafts,
│       │   │                          StatusHistory, Messages
│       │   └── reference.py        ← RoadType, SurfaceMaterial, LotType,
│       │                              DocumentCategory, DrainageType,
│       │                              ValidationRule, FeeSchedule
│       ├── schemas/
│       │   └── __init__.py         ← All Pydantic request/response models
│       ├── api/
│       │   ├── __init__.py
│       │   ├── auth.py             ← Register, login, profile (4 routes)
│       │   ├── applications.py     ← 8-step wizard API (15 routes)
│       │   └── reference.py        ← Form dropdowns from master tables (7 routes)
│       └── services/
│           └── __init__.py
│
├── approval-backend/               ← INTERNAL API (officers)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/
│   └── app/
│       ├── __init__.py
│       ├── main.py                 ← FastAPI app (port 8000)
│       ├── seed.py                 ← Officers + 7 sample applications + 60 checklist items
│       ├── core/
│       │   ├── __init__.py
│       │   ├── config.py
│       │   ├── database.py
│       │   └── auth.py             ← JWT auth + role guards (admin/manager/engineer)
│       ├── models/
│       │   ├── __init__.py
│       │   ├── user.py             ← User (officers)
│       │   ├── application.py      ← Application, Notes, Documents,
│       │   │                          Inspections, Reports
│       │   └── assessment.py       ← AssessmentCategory, AssessmentItem,
│       │                              CaseAssessment
│       ├── schemas/
│       │   └── __init__.py
│       ├── api/
│       │   ├── __init__.py
│       │   ├── auth.py             ← Officer login (2 routes)
│       │   ├── users.py            ← User CRUD (5 routes)
│       │   ├── applications.py     ← Application management + reports (23 routes)
│       │   └── assessments.py      ← Checklist CRUD + AI engine (10 routes)
│       └── services/
│           └── __init__.py
│
└── shared/                         ← Shared assets (optional)
    ├── kalamunda_lots.geojson      ← 23,910 cadastral lot boundaries
    ├── kalamunda_speed_limits.geojson
    └── sightdistance.json          ← AS 2890.1 sight distance table
```

---

## Step-by-Step Deployment

### Option A: Docker Compose (Recommended)

This runs all 4 services + 2 databases with a single command.

#### 1. Create the project directory

```bash
mkdir kalamunda-crossover && cd kalamunda-crossover
```

#### 2. Set up each frontend as a Vite React project

**Applicant Frontend:**

```bash
mkdir -p applicant-frontend/src

cat > applicant-frontend/package.json << 'EOF'
{
  "name": "kalamunda-applicant-portal",
  "version": "3.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.0"
  }
}
EOF

cat > applicant-frontend/vite.config.js << 'EOF'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, host: "0.0.0.0" },
  preview: { port: 3000 },
});
EOF

cat > applicant-frontend/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>City of Kalamunda — Crossover Application</title></head>
<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
EOF

cat > applicant-frontend/src/main.jsx << 'EOF'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
EOF

# Copy the JSX artifact as App.jsx
cp kalamunda-crossover-app-v3.jsx applicant-frontend/src/App.jsx
```

**Approval Frontend:**

```bash
mkdir -p approval-frontend/src

cat > approval-frontend/package.json << 'EOF'
{
  "name": "kalamunda-approval-portal",
  "version": "3.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "leaflet": "^1.9.4"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^6.0.0"
  }
}
EOF

cat > approval-frontend/vite.config.js << 'EOF'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { port: 3001, host: "0.0.0.0" },
  preview: { port: 3001 },
});
EOF

cat > approval-frontend/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>City of Kalamunda — Officer Approval Portal</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" /></head>
<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
EOF

cat > approval-frontend/src/main.jsx << 'EOF'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
EOF

# Copy the JSX artifact as App.jsx
cp kalamunda-approval-portal-v3-sight.jsx approval-frontend/src/App.jsx
```

#### 3. Place backends

```bash
# Extract the backend tar files
tar xzf kalamunda-applicant-backend.tar.gz
mv kalamunda-applicant-backend applicant-backend

tar xzf kalamunda-backend.tar.gz
mv kalamunda-backend approval-backend
```

#### 4. Create frontend Dockerfiles

```bash
# Applicant frontend Dockerfile
cat > applicant-frontend/Dockerfile << 'EOF'
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
EOF

cat > applicant-frontend/nginx.conf << 'EOF'
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
EOF

# Same for approval frontend (port 3001)
cat > approval-frontend/Dockerfile << 'EOF'
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3001
CMD ["nginx", "-g", "daemon off;"]
EOF

cat > approval-frontend/nginx.conf << 'EOF'
server {
    listen 3001;
    root /usr/share/nginx/html;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
EOF
```

#### 5. Create master Docker Compose

```bash
cat > docker-compose.yml << 'EOF'
version: "3.9"

services:
  # ═══ DATABASES ═══════════════════════════════════════
  applicant-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: kalamunda_applicant_db
      POSTGRES_USER: kalamunda_user
      POSTGRES_PASSWORD: kalamunda_pass
    ports: ["5433:5432"]
    volumes: [pgdata_applicant:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kalamunda_user -d kalamunda_applicant_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  approval-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: kalamunda_db
      POSTGRES_USER: kalamunda_user
      POSTGRES_PASSWORD: kalamunda_pass
    ports: ["5432:5432"]
    volumes: [pgdata_approval:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U kalamunda_user -d kalamunda_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ═══ BACKEND APIs ═══════════════════════════════════
  applicant-api:
    build: ./applicant-backend
    ports: ["8001:8000"]
    environment:
      DATABASE_URL: postgresql://kalamunda_user:kalamunda_pass@applicant-db:5432/kalamunda_applicant_db
      SECRET_KEY: change-me-applicant-secret-key-64chars-random
      DEBUG: "true"
      CORS_ORIGINS: "http://localhost:3000,http://localhost:3001"
      UPLOAD_DIR: /app/uploads
    depends_on:
      applicant-db: { condition: service_healthy }
    volumes: [applicant_uploads:/app/uploads]
    command: sh -c "python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

  approval-api:
    build: ./approval-backend
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql://kalamunda_user:kalamunda_pass@approval-db:5432/kalamunda_db
      SECRET_KEY: change-me-approval-secret-key-64chars-random
      DEBUG: "true"
      CORS_ORIGINS: "http://localhost:3000,http://localhost:3001"
    depends_on:
      approval-db: { condition: service_healthy }
    command: sh -c "python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

  # ═══ FRONTENDS ═════════════════════════════════════
  applicant-frontend:
    build: ./applicant-frontend
    ports: ["3000:3000"]
    depends_on: [applicant-api]

  approval-frontend:
    build: ./approval-frontend
    ports: ["3001:3001"]
    depends_on: [approval-api]

volumes:
  pgdata_applicant:
  pgdata_approval:
  applicant_uploads:
EOF
```

#### 6. Launch everything

```bash
docker-compose up --build
```

#### 7. Access the system

| URL | Service |
|-----|---------|
| http://localhost:3000 | Applicant Portal (public) |
| http://localhost:3001 | Officer Approval Portal (internal) |
| http://localhost:8001/api/docs | Applicant API — Swagger UI |
| http://localhost:8000/api/docs | Approval API — Swagger UI |

---

### Option B: Local Development (no Docker)

#### Prerequisites

- Node.js 20+
- Python 3.12+
- PostgreSQL 16

#### 1. Create databases

```bash
psql -U postgres -c "CREATE DATABASE kalamunda_applicant_db;"
psql -U postgres -c "CREATE DATABASE kalamunda_db;"
psql -U postgres -c "CREATE USER kalamunda_user WITH PASSWORD 'kalamunda_pass';"
psql -U postgres -c "GRANT ALL ON DATABASE kalamunda_applicant_db TO kalamunda_user;"
psql -U postgres -c "GRANT ALL ON DATABASE kalamunda_db TO kalamunda_user;"
```

#### 2. Start applicant backend (terminal 1)

```bash
cd applicant-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Edit DATABASE_URL if needed
pip install --upgrade "bcrypt==4.0.1" "passlib[bcrypt]==1.7.4"
python -m app.seed     # Seed reference data + samples
uvicorn app.main:app --reload --port 8001
```

#### 3. Start approval backend (terminal 2)

```bash
cd approval-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install --upgrade "bcrypt==4.0.1" "passlib[bcrypt]==1.7.4"
cp .env.example .env
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

#### 4. Start applicant frontend (terminal 3)

```bash
cd applicant-frontend
npm install
npm run dev   # → http://localhost:3000
```

#### 5. Start approval frontend (terminal 4)

```bash
cd approval-frontend
npm install
npm run dev   # → http://localhost:3001
```

---

### Option C: Production Deployment (VPS / Cloud)

#### Nginx Reverse Proxy

Put everything behind a single domain with path-based routing:

```nginx
# /etc/nginx/sites-available/kalamunda
server {
    listen 80;
    server_name crossover.kalamunda.wa.gov.au;

    # Public applicant portal
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
    }

    # Public API
    location /api/ {
        proxy_pass http://localhost:8001/api/;
        proxy_set_header Host $host;
        client_max_body_size 25M;  # For file uploads
    }

    # Internal officer portal (restrict by IP or VPN)
    location /officer/ {
        # allow 10.0.0.0/8;  # Internal network only
        # deny all;
        proxy_pass http://localhost:3001/;
        proxy_set_header Host $host;
    }

    # Internal API
    location /officer-api/ {
        # allow 10.0.0.0/8;
        # deny all;
        proxy_pass http://localhost:8000/api/;
        proxy_set_header Host $host;
    }
}
```

#### SSL with Certbot

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d crossover.kalamunda.wa.gov.au
```

#### Systemd Services

```bash
# /etc/systemd/system/kalamunda-applicant-api.service
[Unit]
Description=Kalamunda Applicant API
After=postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/kalamunda/applicant-backend
Environment="DATABASE_URL=postgresql://kalamunda_user:SECURE_PASSWORD@localhost:5432/kalamunda_applicant_db"
Environment="SECRET_KEY=GENERATE_A_64_CHAR_RANDOM_STRING"
ExecStart=/opt/kalamunda/applicant-backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001 --workers 4
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable kalamunda-applicant-api
sudo systemctl start kalamunda-applicant-api
```

---

## Database Schema Summary

### Applicant Database (12 tables)

```
applicants              ← Public user accounts
crossover_applications  ← 8-step application form (30+ columns)
application_documents   ← Uploaded files
application_drafts      ← Versioned auto-save snapshots
status_history          ← Audit trail
application_messages    ← Applicant ↔ Officer messaging
ref_road_types          ← Master lookup
ref_surface_materials   ← Master lookup
ref_lot_types           ← Master lookup
ref_drainage_types      ← Master lookup
ref_document_categories ← Master lookup (10 categories)
ref_validation_rules    ← Configurable form validation
ref_fee_schedule        ← Fees and contribution amounts
```

### Approval Database (8 tables)

```
users                   ← Officers (admin/manager/engineer)
applications            ← Mirrored application data (30+ columns)
application_notes       ← Officer notes
documents               ← Document metadata
inspections             ← Pre/post construction inspections
reports                 ← Versioned assessment report snapshots
assessment_categories   ← 11 checklist categories (master)
assessment_items        ← 60 checklist items (master)
case_assessments        ← Per-application per-item results
```

---

## API Endpoints Summary

### Applicant API (http://localhost:8001) — 26 routes

| Group | Routes | Auth |
|-------|--------|------|
| Auth | register, login, me, update profile | Public / JWT |
| Applications | create, list, get, update, save-draft, list-drafts, restore-draft, upload-doc, delete-doc, ai-review, submit, withdraw | JWT |
| Messages | send, mark-read | JWT |
| Tracking | status timeline | JWT |
| Reference | road-types, surface-materials, lot-types, drainage-types, document-categories, validation-rules, fees | Public |

### Approval API (http://localhost:8000) — 40 routes

| Group | Routes | Auth |
|-------|--------|------|
| Auth | login, me | JWT |
| Users | list, get, create, update, delete | JWT + role |
| Applications | list, get, create, update, assign, checklist, notes, documents, update-doc, inspections, update-inspection | JWT + role |
| Assessments | categories, create-category, update-category, add-item, update-item, get-results, update-result, ai-assess, bulk-officer, summary | JWT + role |
| Reports | generate, list, get-version | JWT |

---

## Login Credentials

### Applicant Portal (http://localhost:3000)

| Name | Email | Password |
|------|-------|----------|
| Sarah Mitchell | sarah.m@email.com | applicant123 |
| David Foster | d.foster@outlook.com | applicant123 |
| Andrew Nair | a.nair@email.com | applicant123 |

### Officer Portal (http://localhost:3001)

| Name | Email | Password | Role |
|------|-------|----------|------|
| M. Thompson | m.thompson@kalamunda.wa.gov.au | admin123 | Admin |
| K. Williams | k.williams@kalamunda.wa.gov.au | manager123 | Manager |
| S. Patel | s.patel@kalamunda.wa.gov.au | engineer123 | Engineer |
| J. Morrison | j.morrison@kalamunda.wa.gov.au | engineer123 | Engineer |
| R. Singh | r.singh@kalamunda.wa.gov.au | manager123 | Manager |

---

## Database Migrations

```bash
# Generate migration after model changes
cd applicant-backend   # or approval-backend
alembic revision --autogenerate -m "description of change"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1

# View current state
alembic current
```

---

## Environment Variables

### Applicant Backend (.env)

```env
DATABASE_URL=postgresql://kalamunda_user:kalamunda_pass@localhost:5433/kalamunda_applicant_db
SECRET_KEY=generate-64-char-random-string-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440
CORS_ORIGINS=http://localhost:3000
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=25
DEBUG=false
```

### Approval Backend (.env)

```env
DATABASE_URL=postgresql://kalamunda_user:kalamunda_pass@localhost:5432/kalamunda_db
SECRET_KEY=different-64-char-random-string-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
CORS_ORIGINS=http://localhost:3001
DEBUG=false
```

### Generating Secret Keys

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| CORS errors in browser | Check CORS_ORIGINS in backend .env matches frontend URL |
| Database connection refused | Ensure PostgreSQL is running, check DATABASE_URL |
| Port already in use | Change port in docker-compose.yml or vite.config.js |
| File upload fails | Check UPLOAD_DIR exists and has write permissions |
| JWT expired | Token lasts 24h (applicant) or 8h (officer), re-login |
| Seed data not loading | Run `python -m app.seed` manually, check for errors |
| Frontend blank page | Check browser console, ensure API URL in App.jsx matches backend port |
| Docker build fails | Run `docker-compose build --no-cache` to rebuild from scratch |

---

## Updating the Frontend API URL

If your backend runs on a different host or port, update the `API` constant at the top of each frontend:

**Applicant Frontend** (`src/App.jsx` line 4):
```javascript
const API = "http://localhost:8001/api";  // Change this
```

**Approval Frontend** (`src/App.jsx`): The approval frontend currently uses mock data. To connect it to the backend, replace the mock `APPLICATIONS` array with `fetch()` calls to `http://localhost:8000/api/applications/`.
