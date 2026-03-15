# Kalamunda Crossover Application Portal — Backend API

FastAPI + PostgreSQL backend for the **public-facing** 8-step crossover application wizard.

Runs alongside the Officer Approval Portal backend (separate database, separate port).

## Architecture

```
kalamunda-applicant-backend/
├── app/
│   ├── main.py                # FastAPI entry point (port 8001)
│   ├── seed.py                # Reference data + sample applicants/applications
│   ├── core/
│   │   ├── config.py          # Settings from .env
│   │   ├── database.py        # SQLAlchemy engine
│   │   └── auth.py            # JWT for public applicants
│   ├── models/
│   │   ├── applicant.py       # Public user accounts
│   │   ├── application.py     # CrossoverApplication, Documents, Drafts, Messages, StatusHistory
│   │   └── reference.py       # Master lookup tables (road types, materials, fees, validations)
│   ├── schemas/               # Pydantic request/response models
│   └── api/
│       ├── auth.py            # Register, login, profile
│       ├── applications.py    # 8-step wizard: create, update, save-draft, upload, ai-review, submit, track, messages, withdraw
│       └── reference.py       # Form dropdown options from master tables
├── docker-compose.yml         # PostgreSQL (port 5433) + API (port 8001)
├── Dockerfile
└── requirements.txt
```

## Quick Start

```bash
docker-compose up --build
# API: http://localhost:8001/api/docs
# DB:  localhost:5433
```

## Database — 12 Tables

### Core Tables
| Table | Description |
|---|---|
| `applicants` | Public users (name, email, phone, password) |
| `crossover_applications` | The full 8-step application form |
| `application_documents` | Uploaded files (site plan, title, photos, etc.) |
| `application_drafts` | Versioned auto-save snapshots |
| `status_history` | Audit trail: draft → submitted → reviewed → approved |
| `application_messages` | Two-way messaging between applicant and officers |

### Reference/Master Tables
| Table | Description |
|---|---|
| `ref_road_types` | local, red, blue, rav, mrwa |
| `ref_surface_materials` | asphalt, concrete, brick_paver, chip_seal |
| `ref_lot_types` | res_urban_green, commercial_urban, etc. |
| `ref_drainage_types` | swale, soakwell, piped, culvert, detention_basin |
| `ref_document_categories` | 10 categories with required flags and hints |
| `ref_validation_rules` | Configurable form validation from database |
| `ref_fee_schedule` | Application fees and contribution amounts |

## API — 22 Endpoints

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login (OAuth2 form) |
| GET | `/api/auth/me` | Current profile |
| PATCH | `/api/auth/me` | Update profile |

### Applications (8-step wizard)
| Method | Endpoint | Step | Description |
|---|---|---|---|
| POST | `/api/applications/` | 0 | Create new draft |
| GET | `/api/applications/` | — | List my applications |
| GET | `/api/applications/{id}` | — | Full detail with docs, history, messages |
| PATCH | `/api/applications/{id}` | 1-5 | Update form fields (any step) |
| POST | `/api/applications/{id}/save-draft` | — | Auto-save versioned snapshot |
| GET | `/api/applications/{id}/drafts` | — | List all draft versions |
| POST | `/api/applications/{id}/drafts/{v}/restore` | — | Restore a saved draft |
| POST | `/api/applications/{id}/documents` | 5 | Upload document (multipart) |
| DELETE | `/api/applications/{id}/documents/{doc_id}` | 5 | Remove document |
| POST | `/api/applications/{id}/ai-review` | 6 | Run AI pre-submit checks |
| POST | `/api/applications/{id}/submit` | 7 | Final submission |
| POST | `/api/applications/{id}/withdraw` | — | Withdraw application |
| GET | `/api/applications/{id}/track` | — | Status timeline |
| POST | `/api/applications/{id}/messages` | — | Send message |
| PATCH | `/api/applications/{id}/messages/{id}/read` | — | Mark message read |

### Reference Data (public, no auth)
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/reference/road-types` | Road type dropdown options |
| GET | `/api/reference/surface-materials` | Surface material options |
| GET | `/api/reference/lot-types` | Lot type options |
| GET | `/api/reference/drainage-types` | Drainage type options |
| GET | `/api/reference/document-categories` | Upload categories with required flags |
| GET | `/api/reference/validation-rules` | Client-side validation rules |
| GET | `/api/reference/fees` | Fee schedule |

## Application Lifecycle

```
draft → submitted → acknowledged → under_review → approved
                                                 → rejected
                                                 → info_requested → (applicant edits) → submitted
         ↓
      withdrawn
```

## Sample Logins

| Name | Email | Password |
|---|---|---|
| Sarah Mitchell | sarah.m@email.com | applicant123 |
| David Foster | d.foster@outlook.com | applicant123 |
| Andrew Nair | a.nair@email.com | applicant123 |

## Both Backends Running Together

| Service | Port | Database | Purpose |
|---|---|---|---|
| Approval Portal API | 8000 | kalamunda_db (5432) | Internal officers |
| **Applicant Portal API** | **8001** | **kalamunda_applicant_db (5433)** | **Public applicants** |

The approval backend picks up submitted applications and processes them through the 60-item checklist. The applicant backend lets the public create, save, upload, and submit applications.
