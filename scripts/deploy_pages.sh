#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-atlas-embodied-vision}"
DEPLOY_DIR="$(mktemp -d /tmp/atlas-pages.XXXXXX)"
trap 'rm -rf -- "$DEPLOY_DIR"' EXIT

cd "$PROJECT_ROOT"
python3 scripts/validate_data.py

cp -a assets "$DEPLOY_DIR/assets"
mkdir -p "$DEPLOY_DIR/data"
cp -a data/details "$DEPLOY_DIR/data/details"
cp -a data/paper_details "$DEPLOY_DIR/data/paper_details"
cp data/index.json data/papers.json data/glossary.json \
  data/academic_tracker.json data/paper_analysis_index.json "$DEPLOY_DIR/data/"
cp index.html explore.html model.html compare.html radar.html venues.html \
  lineage.html timeline.html trends.html glossary.html reader.html favicon.svg "$DEPLOY_DIR/"

commit_hash="$(git rev-parse HEAD 2>/dev/null || printf unknown)"
npx -y wrangler@latest pages deploy "$DEPLOY_DIR" \
  --project-name "$PROJECT_NAME" \
  --branch main \
  --commit-hash "$commit_hash" \
  --commit-dirty=true
