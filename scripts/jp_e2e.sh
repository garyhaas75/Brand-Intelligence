#!/usr/bin/env bash
# End-to-end Japan scan for one brand slug. Default slug toysrus-jp.
# Usage: bash scripts/jp_e2e.sh [slug] [--dry-run]
# Order matters: site scrape first (feeds social handle discovery), then marketplace and
# demand (feed personas), social, then search_seo BEFORE personas (personas reads it).
# The marketplace hook inside competitive_analysis is skipped here: it already ran above. Each step logs and continues
# so one blocked site does not discard the rest.
set -u
cd "$(dirname "$0")/.."
SLUG="${1:-toysrus-jp}"
DRY="${2:-}"
mkdir -p logs
step() { echo; echo "=== $1 ==="; shift; "$@" || echo "STEP FAILED (continuing): $*"; }
step "env"          node -e "for (const k of ['ANTHROPIC_API_KEY','APIFY_API_TOKEN','YOUTUBE_API_KEY','RAKUTEN_APP_ID','ESTAT_APP_ID','SERP_API_KEY','PERPLEXITY_API_KEY']) console.log(k.padEnd(20), process.env[k] ? 'set' : 'MISSING')"
if [ -z "$DRY" ]; then step "website"      node analysis/website_audit.js --slug="$SLUG"; else echo "=== website: skipped in dry run ==="; fi
step "marketplace"  node scrapers/marketplace_jp.js --slug="$SLUG" $DRY
if [ -z "$DRY" ]; then step "competitive"  env BI_SKIP_MARKETPLACE_HOOK=1 node analysis/competitive_analysis.js --slug="$SLUG"; else echo "=== competitive: skipped in dry run ==="; fi
step "demand"       node analysis/jp_demand.js --slug="$SLUG" $DRY
step "social"       node analysis/social_audit.js --slug="$SLUG" $DRY
if [ -z "$DRY" ]; then step "search_seo"   node analysis/search_seo.js --slug="$SLUG"; step "personas"     node analysis/personas.js --slug="$SLUG"; else echo "=== search_seo, personas: skipped in dry run ==="; fi
echo; echo "Output: data/brands/$SLUG/"; ls -la "data/brands/$SLUG/"
