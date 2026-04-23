# CAMS Project Context for Claude

## Repository
- GitHub: github.com/arad71/cams
- Token: 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

## Tech Stack
- Backend: FastAPI + SQLAlchemy + PostgreSQL
- Frontend: React + Vite + Leaflet maps
- AI: Anthropic Claude API for site plan extraction
- Deployment: Docker on Azure

## Key Files
- approval-frontend/src/components/workflow/WorkflowView.jsx — main workflow (4 steps)
- approval-frontend/src/components/map/MapWithOverlay.jsx — map, sight analysis, measure
- approval-frontend/src/components/ui/DocumentList.jsx — document upload, AI extraction
- approval-frontend/src/components/ui/ApprovalChecklist.jsx — assessment checklist
- approval-frontend/src/views/ApplicationListView.jsx — app list + new app form
- approval-frontend/src/views/SystemAdmin.jsx — admin, rules, users
- approval-frontend/src/views/WorkflowDashboard.jsx — dashboard
- approval-frontend/src/utils/geo.js — GIS utilities
- approval-frontend/src/services/api.js — API client
- approval-frontend/src/styles/tokens.js — design tokens
- approval-backend/app/api/documents.py — upload, extraction endpoints
- approval-backend/app/api/assessments.py — assessment engine, rules
- approval-backend/app/api/applications.py — CRUD
- approval-backend/app/services/ai_analyser.py — Claude API prompt
- approval-backend/app/seed.py — database seed (users, rules, sample apps)
- approval-backend/app/models/ — SQLAlchemy models

## Current Workflow (4 steps)
1. Submit — upload docs, auto AI extract, auto assess
2. Review — verify AI extractions + assessment checklist side-by-side
3. Analyse — sight triangle, measure tool, utility clearance on map
4. Decision — approve/reject/request info, generate report

## Assessment System
- 12 categories, 65+ items, 90+ rules (simple + compound AND/OR)
- Rules in seed.py, engine in assessments.py
- Compound rules use conditions JSON: {"logic":"and","checks":[...]}
- Priority chain: P0-P1 app fields, P3-P4 compound cross-verify, P5-P7 site plan, P9 fallback

## Sight Analysis
- Auto-draws triangle from lot polygon + road GeoJSON
- Point A: 2.5m from road edge, perpendicular to road, measured from constrained boundary
- Point B: perpendicular projection onto road centreline
- Triple fallback: named road → nearest road → longest lot edge
- Left/right: anticlockwise = left, clockwise = right (when facing road)

## Recent Issues Fixed
- Left/right boundary swapped (was clockwise=left, fixed to anticlockwise=left)
- Triangle pointing backward (now uses road perpendicular, not edge normal)
- Flickering (removed Math.random from useEffect)
- "road not near lot" eliminated (all distance thresholds removed)
- Corner lot false positives (AI prompt tightened)
- Docker env_file crash (removed, uses ${VAR:-default})
- Site plan extraction Claude-only (removed ai_local for site plans)
- Document deletion clears extraction data

## Pending Work
- Professional GUI redesign (make more attractive and polished)
- Site plan overlay on map (Claude extraction → GeoJSON → Leaflet layer)
- Custom GeoJSON layer support via env var or DB admin
- Driveway coordinate extraction from overlay
- Point A calculation still needs validation on more lots
