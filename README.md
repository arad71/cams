# CAMS — Crossover Assessment Management System

Crossover (driveway) permit assessment system for Western Australian local councils.

## Features

### Application Management
- Create crossover applications with owner details, lot info, and documents
- Upload application forms (PDF) — AI auto-extracts owner, phone, email, address, DA number
- Upload site plans (PDF) — AI auto-extracts 74 fields: crossover dimensions, road names, setbacks, fences, utilities
- Address search from 23,000+ lot boundaries (Data WA cadastre)
- Document management with categories, review status, and versioning

### AI Site Plan Analysis
- Reads crossover width, verge depth, boundary distances from engineering drawings
- Identifies crossover road (follows garage direction for corner lots)
- Detects corner lots, constrained side, fence/wall obstructions
- Extracts setbacks, kerb type, footpath, drainage, utilities
- Officer can correct AI values or measure directly on the site plan
- Re-run analysis with lock to protect officer corrections

### 206-Rule Assessment Checklist
- 12 categories, 70+ assessment items with auto-evaluation
- Rules reference: AS 2890.1, council R-codes (R-030 to R-140)
- AI auto-assesses pass/fail/review for each rule
- Officer overrides with notes for review items
- Real-time compliance score

### Sight Distance Analysis
- Auto-draws sight triangle from AI-extracted data (crossover road, boundary distance, width)
- Point A calculated: x=2.5m from kerb, y=boundary distance + 0.5 x crossover width
- Point B projected perpendicular to road centreline
- Speed zone from Legal Speed Limits GeoJSON (50/60/70/80 km/h)
- 3D AI analysis using satellite imagery and elevation data
- Separate curve overlay button for corner lots
- Manual click mode as fallback when data is incomplete

### Interactive Map
- 9 data layers from Data WA SLIP services
- Lot boundaries, road network, speed limits, 2m contours
- Urban forest canopy, drainage pipes/pits, water pipes
- Site plan boundaries overlay (lot, building, crossover polygons)
- Measure tool, annotation tool, zoom-to-property

### Mobile Field Inspection
- Full-screen mobile view for on-site inspections
- 16-item checklist: crossover, sight distance, road/verge, services
- Camera capture tagged to checklist items
- GPS auto-capture with accuracy display
- Pass/Fail/N/A tap buttons with per-item notes
- Auto-saves every 10 seconds
- Pre-construction and post-construction inspection types
- Photos viewable from desktop with expandable inspection details

### Decision & Reporting
- Approve / Approve with Conditions / Reject
- 18 condition templates in 5 categories (construction, dimensions, sight distance, drainage, services)
- Custom conditions with free-text input
- Decision note for reasoning
- PDF assessment report: application details, checklist results, conditions, officer notes, recommendation, signature block
- Versioned report snapshots

### Email Notifications
- Officer assignment notification (application ref, address, applicant, assigned by)
- Status change notification (old to new status, colour-coded)
- HTML email template with council branding
- Non-blocking background send
- Configurable via SMTP settings (disabled by default)

### Administration
- Role-based access: Admin, Manager, Engineer, Viewer
- User management with Microsoft Entra ID (SSO) support
- GeoData refresh panel for all 8 layers
- Site settings (council name, contact, branding)
- Audit trail logging
- Assessment rule editor

## Tech Stack

- **Frontend**: React 18, Vite, Leaflet maps, nginx
- **Backend**: FastAPI, SQLAlchemy, PostgreSQL
- **AI**: Vision AI for site plan analysis (configurable model)
- **Deploy**: Docker Compose on Azure VM
- **Email**: SMTP (Gmail, Outlook, or council mail server)

## Quick Start

```bash
git clone https://github.com/arad71/cams.git
cd cams
./deploy.sh test
```

### Update (safe — no data loss)

```bash
./update.sh                # Pull + rebuild + restart
./update.sh --no-cache     # Force clean rebuild
./update.sh --frontend     # Frontend only
./update.sh --backend      # Backend only
./update.sh --geodata      # Also refresh GeoData after update
```

### Clean Transaction Data

```bash
./cleanup.sh               # Interactive — type DELETE to confirm
./cleanup.sh --dry-run     # Show counts only
./cleanup.sh --force       # Skip confirmation
./cleanup.sh --keep-audit  # Keep audit log
```

Clears: applications, notes, documents, inspections, reports, assessments, AI training.
Keeps: users, roles, assessment rules, site settings, GeoJSON data.

## Configuration (.env)

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/cams_db

# AI (required for site plan analysis)
ANTHROPIC_API_KEY=sk-ant-api03-...

# Email notifications (optional)
SMTP_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=noreply@council.wa.gov.au
SMTP_FROM_NAME=CAMS Crossover System

# SSO (optional)
ENTRA_ENABLED=true
ENTRA_TENANT_ID=...
ENTRA_CLIENT_ID=...
ENTRA_CLIENT_SECRET=...
```

## Test Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@council.wa.gov.au | admin123 |
| Manager | manager@council.wa.gov.au | manager123 |
| Engineer | engineer@council.wa.gov.au | engineer123 |
| Viewer | viewer@council.wa.gov.au | viewer123 |

## GeoData Layers (Data WA)

| Layer | Source | File |
|-------|--------|------|
| Lot boundaries | LGATE-002 Cadastre | lot.geojson |
| Road network | LGATE-195 Transport | Road_Network.geojson |
| Speed limits | MRWA | Legal_Speed_Limits.geojson |
| 2m Contours | DPIRD-072 | Contours_2m.geojson |
| Urban forest | DPLH-109 | Urban_Forest.geojson |
| Drainage pipes | WCORP-080 | Drainage_Pipes.geojson |
| Drain inlets | WCORP-290 | Drainage_Pits.geojson |
| Water pipes | WCORP-002 | Water_Pipes.geojson |

Refresh via Admin panel or CLI:
```bash
docker compose exec approval-api python scripts/update_geodata.py --layer all
```

## Repository Structure

```
cams/
├── approval-backend/
│   ├── app/api/                 REST endpoints (78 endpoints)
│   ├── app/models/              SQLAlchemy models (10 tables)
│   ├── app/services/
│   │   ├── ai_analyser.py       Site plan AI extraction (74 fields)
│   │   ├── report_pdf.py        PDF report generation
│   │   ├── email.py             Email notifications
│   │   └── extractor_app_form.py Application form OCR
│   ├── app/seed.py              Database seed + migrations
│   └── scripts/update_geodata.py GeoJSON download pipeline
├── approval-frontend/
│   ├── src/components/
│   │   ├── map/                 MapWithOverlay, LeafletMap
│   │   ├── ui/                  AIExtractionReview, SitePlanMeasure,
│   │   │                        MobileInspection, ReportGenerator
│   │   └── workflow/            WorkflowView (5-step workflow)
│   ├── src/views/               Login, ApplicationList, Detail, Admin
│   └── src/services/api.js      API client
├── deploy.sh                    Deploy/manage script
├── update.sh                    Safe update (no data loss)
├── cleanup.sh                   Clear transaction data
├── docker-compose.prod.yml      Docker config (with DB)
└── docker-compose.external-db.yml Docker config (external DB)
```

## Workflow

1. **Upload** — Upload application form + site plan, AI auto-extracts
2. **Extract** — Review/correct AI extraction, measure on site plan
3. **Assess** — 206-rule checklist auto-evaluates, sight triangle analysis
4. **Review** — Manager review, field inspection (mobile)
5. **Decision** — Approve/reject with conditions, generate PDF report
