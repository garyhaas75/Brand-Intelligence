> **Follows [whp-standards](https://github.com/garyhaas75/whp-standards).** Three-role review before every commit (enforced by `.githooks/`), git-only deploys verified live, whp-auth + fail closed, no committed secrets, no em dashes. Exceptions for this repo are listed below.

# Development Protocol: Brand Intelligence

## Before EVERY push: test end-to-end locally

### 1. Start the server
```bash
node server.js &
sleep 3
```

### 2. Test every new/changed API endpoint
```bash
# Use Basic Auth (default password: changeme unless DASHBOARD_PASSWORD is set in .env)
curl -s -u admin:changeme http://localhost:3001/api/<endpoint>
# Verify: correct shape, no null where data is expected, no errors
```

### 3. For React UI changes: rebuild + verify bundle contains the change
```bash
npm run build --prefix dashboard
grep -c "key phrase from new UI code" dashboard/dist/assets/index-*.js
# Must return 1 (or more), never 0
```

### 4. For strategy/config endpoints: verify null-safety
```bash
# Temporarily rename the data file, re-test - server must return a valid default
mv data/content_strategy.json data/content_strategy.json.bak
curl -s -u admin:changeme http://localhost:3001/api/content-strategy | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('ok:',d.ok,'strategy null:',d.strategy===null)"
mv data/content_strategy.json.bak data/content_strategy.json
# strategy null must be FALSE
```

### 5. Kill local server before pushing
```bash
pkill -f "node server.js"
```

---

## Railway deployment rules

- After `git push`, Railway auto-deploys. Takes **2–4 minutes**.
- **NEVER** ask the user to test on Railway before confirming it works locally first.
- After deploy, user must **hard-refresh** (Cmd+Shift+R) to pick up new JS bundle hash.
- The Railway volume at `/app/data/` persists across deploys - files are NOT overwritten by git.
- Seed system: railway.toml copies `seed_data/brands/` into the volume without overwriting (`cp -rn`); server.js then fills missing or invalid files per brand (`BRAND_DATA_VALIDATORS`, `mergeBrandSeedData`) and registers shipped brands that carry a `_registry.json` (`modules/seed_registry.js`). A deleted seeded brand is remembered in `registry.deletedSeeds` and is not re-added.
- **Deploy branch is `main`.** Railway's connected branch was switched from `brand-intel` to `main` on 2026-11-17, and `brand-intel` is retired. A push to `main` deploys.
- Confirm a deploy by the live service, not the CLI: deployment status SUCCESS, the boot log, and `/api/status`.

---

## Japan market (Toys R Us Japan)

- Japan mode switches on from `profile.market` naming Japan or a `.jp` host (`utils/market.js`). Other markets keep the old behavior.
- The Japan Refresh All runs in phases: collect (website, marketplace, tech stack), analyse (demand, social, competitive, search, par matrix), discover (niche candidates), personas, blueprint, strategy (360), plan, then translate (`analysis/translate_outputs.js`, writes `translations.json`).
- **Website blueprint** (`analysis/site_blueprint.js`, `site_blueprint.json`): when the target's own site is not observed (blocked, stale or skipped), the website audit is labelled `auditBasis: benchmark` and must not claim anything about the current site. The blueprint turns competitor sites, marketplace best sellers and reviews, search demand, personas and search findings into recommended navigation, homepage, seasonal calendar, best practices, a 30/60/90 roadmap and a verify-first checklist, each item citing evidence. The action plan builds on it. With a manual capture it runs as `audit-informed`.
- **Bilingual output.** Any module read accepts `?lang=orig|en|ja` (a lookup in `translations.json`, no model call; header `X-Translations: missing|stale` says when it is absent or older than the module). `GET /api/brands/:slug/report?lang=en|ja` returns the full report as HTML and `/report.pdf` as a PDF (one at a time, gated to the Action Plan tab). The dashboard has an EN | 日本語 | Original toggle and a Download report menu. Translations are cached once per string in `data/translations_cache.json`. Only Japan-market brands can run the translations refresh.
- `toysrus-jp` is seeded with `scheduled:false`, so no cron job runs it. It refreshes only on demand (Refresh all runs the phased Japan run in `analysis/brand_discovery.js`; a per-brand run lock returns 409 if one is already active).
- Its site (toysrus.co.jp) is geo-fenced to Japan by its operator (traffic from outside Japan gets Cloudflare's "Sorry, you have been blocked" page, to keep sales inside the licensed territory). On 2026-11-18 WHP, the brand owner, authorized reading it through a Japanese residential proxy: only that host, a handful of read-only pages per module per run, slow pace, no login, no purchase. The authorization is the profile's `scrape.access` block (`mode: 'jp_proxy'`, who, when, why, `maxPagesPerModule`). `utils/site_access.js` decides per URL: `direct`, `jp_proxy` (only through `fetchPage` / `playwrightProxy`, never directly) or `denied`. `utils/no_contact.js` keeps meaning "may be requested DIRECTLY" and stays false for the proxy host. Every proxied request logs `via Japanese proxy (authorized <by> <date>)`. After a run, grep the module logs for the host: every request line must say that. A hand-saved capture in `data/brands/<slug>/manual_capture/<brand-id>.html` (and `.png`) is the fallback when the proxied load fails.
- **Apify spend cap:** about $15 per full run (`utils/apify_budget.js`, ledger `_apify_spend.json` keyed by `BI_RUN_ID`, which the phased run, Refresh All, each single-module refresh and each scheduled job set to a fresh id, so every run has its own cap; a module started by hand without one shares a per-slug, per-UTC-day pot; cap from `scrape.apifyCapUsd`, `BI_APIFY_CAP_USD` or 15). Every actor call reserves first, passes `callOptions` (a hard `maxTotalChargeUsd`) and records the real `usageTotalUsd`. A refused unit is marked `budgetSkipped` in its output.
- **360 layers (Japan):** players carry `tier` (marketplace, mass, specialty, niche) and `relationship` (competitor, partner; `utils/players.js`). Don Quijote is the partner and is never scored or ranked. Phases: collect (website, marketplace, `tech_stack.js`), analyse (demand, social, competitive, search, `par_matrix.js`), discover (`niche_discovery.js` only proposes brands; `POST /api/brands/:slug/niche-decision` approves or rejects, and only approved ones are scanned), personas, blueprint, strategy (`strategy_360.js`), plan, translate. Live profiles get tiers and the proxy authorization from the seed through `modules/profile_migrations.js` at boot (runs once per marker).
- A handle Claude guessed is saved to a profile only if the scrape returned real data. X, YouTube and LINE are scraped for Japan brands only.
- Any config/data that must always be available must have a hardcoded default in server code (not just a seed file).

---

## Fix → Test → Simulate loop

1. **Diagnose** root cause before writing code. Don't guess.
2. **Write the fix**.
3. **Test the API** with curl locally (see above).
4. **Rebuild dashboard** if UI changed. Confirm bundle contains the change.
5. **Simulate the Railway scenario**: rename data files, restart server, re-test - confirm fallbacks work.
6. **Push only when all tests pass locally.**
7. After Railway deploys: ask user to hard-refresh and confirm.

---

## Common failure patterns

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| UI tab shows blank | API returns `null` for data; UI guards `{data && ...}` | Add hardcoded default to server function |
| Content Strategy blank | `data/content_strategy.json` missing from Railway volume | `DEFAULT_CONTENT_STRATEGY` constant in server.js |
| Dashboard blank (no JS) | `dist` in dashboard/.gitignore blocks bundle from git | Remove `dist` from dashboard/.gitignore |
| Endpoint returns 401 | Basic auth required - use `-u admin:changeme` in curl | N/A (by design) |
| Image fallback fails | Handle suffix mismatch (variant colors appended by Claude) | `includes(catName.substring(0,28))` name match |
| `invalidateCache is not defined` | Function exported but missing from destructure import | Add to destructure on line 16 of server.js |
| Railway volume shadows seed | `cp -n` won't overwrite; SEED_VALIDATORS are the guard | Embed critical data as inline constants in code |
