#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# cleanup.sh — Clear transaction/case data from CAMS
#
# Keeps:  users, roles, departments, assessment rules/categories/items,
#         site_settings, GeoJSON data files
# Clears: applications, notes, documents, inspections, reports,
#         case_assessments, AI training, audit log, sight distances
#
# Usage:
#   ./cleanup.sh              # Clear all case data (with confirmation)
#   ./cleanup.sh --force      # Skip confirmation prompt
#   ./cleanup.sh --dry-run    # Show what would be cleared without doing it
#   ./cleanup.sh --keep-audit # Clear cases but keep audit log
# ═══════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")"

FORCE=false
DRY_RUN=false
KEEP_AUDIT=false

for arg in "$@"; do
  case $arg in
    --force)      FORCE=true ;;
    --dry-run)    DRY_RUN=true ;;
    --keep-audit) KEEP_AUDIT=true ;;
    --help|-h)
      echo "Usage: ./cleanup.sh [--force] [--dry-run] [--keep-audit]"
      echo ""
      echo "Clears all application/case data while keeping system config."
      echo ""
      echo "  CLEARED: applications, notes, documents, inspections, reports,"
      echo "           case_assessments, AI training, sight_distances, audit_log"
      echo ""
      echo "  KEPT:    users, roles, departments, assessment_rules,"
      echo "           assessment_categories, assessment_items, site_settings,"
      echo "           GeoJSON data files"
      echo ""
      echo "Options:"
      echo "  --force       Skip confirmation prompt"
      echo "  --dry-run     Show counts without deleting"
      echo "  --keep-audit  Keep audit_log table"
      exit 0
      ;;
  esac
done

# ── Detect Docker compose file ──
COMPOSE_FILE=""
for f in docker-compose.prod.yml docker-compose.external-db.yml docker-compose.yml; do
  if [ -f "$f" ]; then COMPOSE_FILE="$f"; break; fi
done

if [ -z "$COMPOSE_FILE" ]; then
  echo "❌ No docker-compose file found"
  exit 1
fi

echo "═══════════════════════════════════════════════════"
echo "  CAMS Data Cleanup"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Build the SQL ──
# Tables to clear (order matters — children before parents due to FK)
TABLES=(
  "ai_training_corrections"
  "ai_training_samples"
  "case_assessments"
  "reports"
  "inspections"
  "documents"
  "application_notes"
  "sight_distances"
  "applications"
)

if [ "$KEEP_AUDIT" = false ]; then
  TABLES+=("audit_log")
fi

# ── Show current counts ──
echo "  Current record counts:"
echo ""

COUNT_SQL=""
for t in "${TABLES[@]}"; do
  COUNT_SQL+="SELECT '  ' || LPAD('$t', 30) || ': ' || COUNT(*)::text FROM $t UNION ALL "
done
# Add preserved tables
COUNT_SQL+="SELECT '  ' || LPAD('users', 30) || ': ' || COUNT(*)::text || ' (kept)' FROM users UNION ALL "
COUNT_SQL+="SELECT '  ' || LPAD('roles', 30) || ': ' || COUNT(*)::text || ' (kept)' FROM roles UNION ALL "
COUNT_SQL+="SELECT '  ' || LPAD('assessment_rules', 30) || ': ' || COUNT(*)::text || ' (kept)' FROM assessment_rules UNION ALL "
COUNT_SQL+="SELECT '  ' || LPAD('assessment_items', 30) || ': ' || COUNT(*)::text || ' (kept)' FROM assessment_items UNION ALL "
COUNT_SQL+="SELECT '  ' || LPAD('site_settings', 30) || ': ' || COUNT(*)::text || ' (kept)' FROM site_settings;"

docker compose -f "$COMPOSE_FILE" exec -T approval-db psql -U cams_user -d cams_db -t -c "$COUNT_SQL" 2>/dev/null || \
docker compose -f "$COMPOSE_FILE" exec -T approval-api python -c "
from app.core.database import SessionLocal
from sqlalchemy import text
db = SessionLocal()
tables = ['${TABLES[*]}'.replace(' ', \"', '\")]
tables = [$(printf "'%s'," "${TABLES[@]}" | sed 's/,$//')]
for t in tables:
    try:
        r = db.execute(text(f'SELECT COUNT(*) FROM {t}')).scalar()
        print(f'  {t:>30}: {r}')
    except: pass
for t in ['users','roles','assessment_rules','assessment_items','site_settings']:
    try:
        r = db.execute(text(f'SELECT COUNT(*) FROM {t}')).scalar()
        print(f'  {t:>30}: {r} (kept)')
    except: pass
db.close()
"

echo ""

if [ "$DRY_RUN" = true ]; then
  echo "  🔍 DRY RUN — no data was deleted"
  exit 0
fi

# ── Confirm ──
if [ "$FORCE" = false ]; then
  echo "  ⚠️  This will permanently delete ALL application/case data."
  echo "  Users, roles, assessment rules, and GeoJSON files are kept."
  echo ""
  read -p "  Type 'DELETE' to confirm: " confirm
  if [ "$confirm" != "DELETE" ]; then
    echo "  ❌ Cancelled"
    exit 1
  fi
fi

echo ""
echo "  Clearing data..."

# ── Execute cleanup via backend container ──
docker compose -f "$COMPOSE_FILE" exec -T approval-api python -c "
from app.core.database import SessionLocal
from sqlalchemy import text

db = SessionLocal()
tables = [$(printf "'%s'," "${TABLES[@]}" | sed 's/,$//')]

for t in tables:
    try:
        r = db.execute(text(f'DELETE FROM {t}'))
        db.commit()
        print(f'  ✓ {t}: {r.rowcount} rows deleted')
    except Exception as e:
        db.rollback()
        print(f'  ✕ {t}: {e}')

# Reset sequences
for t in tables:
    try:
        db.execute(text(f\"SELECT setval(pg_get_serial_sequence('{t}', 'id'), 1, false)\"))
        db.commit()
    except:
        db.rollback()

db.close()
print()
print('  ✅ Cleanup complete')
"

# ── Also clean uploaded document files ──
echo ""
echo "  Cleaning uploaded files..."
docker compose -f "$COMPOSE_FILE" exec -T approval-api sh -c '
  if [ -d /app/uploads ]; then
    count=$(find /app/uploads -type f | wc -l)
    rm -rf /app/uploads/*
    echo "  ✓ Removed $count uploaded files"
  else
    echo "  - No uploads directory"
  fi
'

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ All case data cleared. System config preserved."
echo "  Users, roles, assessment rules, GeoJSON files intact."
echo "═══════════════════════════════════════════════════"
