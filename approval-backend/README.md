# Council Crossover Approval System — Backend API

FastAPI + PostgreSQL backend for the City of Council crossover approval portal.

## Architecture

```
council-backend/
├── app/
│   ├── main.py              # FastAPI app entry point
│   ├── seed.py              # Database seeder (users + sample applications)
│   ├── core/
│   │   ├── config.py        # Settings from environment
│   │   ├── database.py      # SQLAlchemy engine + session
│   │   └── auth.py          # JWT auth + password hashing + role guards
│   ├── models/
│   │   ├── user.py          # User model (admin/manager/engineer)
│   │   └── application.py   # Application, Note, Document, Inspection models
│   ├── schemas/
│   │   └── __init__.py      # Pydantic request/response schemas
│   └── api/
│       ├── auth.py          # POST /login, GET /me
│       ├── users.py         # CRUD users (admin only)
│       └── applications.py  # CRUD applications + assign + checklist + notes + docs
├── alembic/                 # Database migrations
├── docker-compose.yml       # PostgreSQL + API containers
├── Dockerfile
├── requirements.txt
└── .env.example
```

## Quick Start

### Option 1: Docker (recommended)

```bash
docker-compose up --build
```

This starts:
- **PostgreSQL 16** on port 5432
- **FastAPI** on port 8000 (auto-seeds database on first run)

### Option 2: Local

```bash
# 1. Start PostgreSQL and create database
createdb council_db

# 2. Configure environment
cp .env.example .env
# Edit .env with your database credentials

# 3. Install dependencies
pip install -r requirements.txt

# 4. Seed database
python -m app.seed

# 5. Run server
uvicorn app.main:app --reload --port 8000
```

### API Docs

Once running, visit:
- **Swagger UI**: http://localhost:8000/api/docs
- **ReDoc**: http://localhost:8000/api/redoc

---

## User Roles & Permissions

| Role       | Login Password | Can View           | Can Do                                    |
|------------|---------------|--------------------|-------------------------------------------|
| **admin**    | admin123      | All applications   | Manage users, assign, approve/reject, all |
| **manager**  | manager123    | All applications   | Assign officers, approve/reject, refer    |
| **engineer** | engineer123   | Assigned cases only | Assess checklist, add notes, inspect      |

### Seeded Users

| Name          | Email                              | Role     |
|---------------|-------------------------------------|----------|
| M. Thompson   | m.thompson@council.wa.gov.au     | admin    |
| K. Williams   | k.williams@council.wa.gov.au     | manager  |
| S. Patel      | s.patel@council.wa.gov.au        | engineer |
| J. Morrison   | j.morrison@council.wa.gov.au     | engineer |
| R. Singh      | r.singh@council.wa.gov.au        | manager  |

---

## API Reference

### Authentication

```
POST /api/auth/login          # Login (form: username=email, password)
GET  /api/auth/me             # Get current user (Bearer token)
```

### Users (admin only for write)

```
GET    /api/users/             # List all users (admin/manager)
GET    /api/users/{id}         # Get user
POST   /api/users/             # Create user (admin)
PATCH  /api/users/{id}         # Update user (admin)
DELETE /api/users/{id}         # Delete user (admin)
```

### Applications

```
GET    /api/applications/                         # List (filtered by role)
GET    /api/applications/?status=pending_review   # Filter by status
GET    /api/applications/{id}                     # Get with notes, docs, inspections
POST   /api/applications/                         # Create new
PATCH  /api/applications/{id}                     # Update status, checklist, etc.
POST   /api/applications/{id}/assign/{officer_id} # Assign officer (manager/admin)
PATCH  /api/applications/{id}/checklist           # Update checklist data
POST   /api/applications/{id}/notes               # Add note
GET    /api/applications/{id}/documents            # List documents
POST   /api/applications/{id}/documents            # Add document
PATCH  /api/applications/{id}/documents/{doc_id}   # Update doc status
POST   /api/applications/{id}/inspections          # Schedule inspection
PATCH  /api/applications/{id}/inspections/{insp_id}# Update inspection
```

### Health Check

```
GET /api/health    # → {"status": "ok", "version": "3.1.0"}
```

---

## Database Schema

### users
| Column          | Type         | Notes                        |
|-----------------|-------------|------------------------------|
| id              | serial PK   |                              |
| email           | varchar(255)| unique, indexed              |
| name            | varchar(255)|                              |
| initials        | varchar(4)  |                              |
| hashed_password | varchar(255)| bcrypt                       |
| role            | varchar(20) | admin / manager / engineer   |
| department      | varchar(100)|                              |
| is_active       | boolean     | default true                 |
| created_at      | timestamptz |                              |
| updated_at      | timestamptz |                              |

### applications
| Column                | Type          | Notes                      |
|-----------------------|--------------|----------------------------|
| id                    | serial PK    |                            |
| ref_number            | varchar(20)  | unique, e.g. CX-2026-0041 |
| status                | varchar(30)  | pending_review, under_assessment, approved, rejected, etc. |
| owner_name/phone/email| varchar      |                            |
| property_address      | varchar(500) |                            |
| lot_number, plan_number| varchar     |                            |
| frontage, depth       | float        | metres                     |
| road_name, road_type  | varchar      | local / red / blue         |
| crossover_width/count/surface | various |                        |
| officer_id            | FK → users   | assigned engineer          |
| checklist_data        | jsonb        | {item_id: {auto, officer}} |
| lot_polygon           | jsonb        | [[lat,lng], ...]           |
| trees_data            | jsonb        | [{species, x, y, canopy}]  |

### application_notes
| Column         | Type        |
|---------------|-------------|
| id            | serial PK   |
| application_id| FK → applications |
| author_id     | FK → users  |
| text          | text        |
| created_at    | timestamptz |

### documents
| Column         | Type        |
|---------------|-------------|
| id            | serial PK   |
| application_id| FK → applications |
| name          | varchar(500)|
| file_type     | varchar(10) |
| file_size     | varchar(20) |
| category      | varchar(50) |
| status        | varchar(20) | received / verified / rejected |
| file_path     | varchar     | storage path                   |
| uploaded_at   | timestamptz |

### inspections
| Column         | Type        |
|---------------|-------------|
| id            | serial PK   |
| application_id| FK → applications |
| inspector_id  | FK → users  |
| inspection_type| varchar(50)| Pre-construction / Post-construction |
| scheduled_date| timestamptz |
| status        | varchar(20) | scheduled / passed / failed    |
| notes         | text        |

---

## Connecting the Frontend

Update the React frontend to call the API instead of using mock data:

```javascript
const API_BASE = "http://localhost:8000/api";

// Login
const res = await fetch(`${API_BASE}/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username: email, password }),
});
const { access_token, user } = await res.json();

// Authenticated requests
const apps = await fetch(`${API_BASE}/applications/`, {
  headers: { Authorization: `Bearer ${access_token}` },
}).then(r => r.json());

// Assign officer (manager/admin)
await fetch(`${API_BASE}/applications/${appId}/assign/${officerId}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});

// Add note
await fetch(`${API_BASE}/applications/${appId}/notes`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ text: "Verified clearance on site." }),
});
```

---

## Migrations

```bash
# Generate migration after model changes
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Rollback one step
alembic downgrade -1
```
