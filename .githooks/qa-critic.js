#!/usr/bin/env node
/**
 * WHP adversarial QA critic. Part of whp-standards; installed into each repo's .githooks/.
 *
 * Reads the commits being pushed and asks Claude, adversarially, whether each one's QA line is
 * real or theater, and whether the change touched anything the WHP standards forbid without
 * saying so. Blocks the push on a FAIL.
 *
 * Self-contained: no repo-specific paths, no dependency on the repo having the Anthropic SDK
 * installed (it calls the HTTP API directly with fetch, Node 18+). The API key comes from the
 * environment or the repo's .env.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const LOG_PATH = path.join(ROOT, '.githooks', 'qa-critic.log');

// Find ANTHROPIC_API_KEY, in order: the environment, the repo's own .env, then the shared
// scoped file ~/.config/whp/anthropic-key. The scoped file is why a local push works in a repo
// that has no key of its own: one file outside every repo, owner-only, never committed.
function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  } catch {}
  try {
    const shared = fs.readFileSync(path.join(require('os').homedir(), '.config', 'whp', 'anthropic-key'), 'utf8').trim();
    if (shared) return shared;
  } catch {}
  return '';
}
const KEY = loadKey();
if (!KEY) {
  console.error('⚠ ANTHROPIC_API_KEY not set (env or repo .env); cannot run the QA critic.');
  console.error('  Set it, or QA_OVERRIDE="reason" git push to bypass with a logged reason.');
  process.exit(1);
}

function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.error(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

const SYSTEM = `You are an adversarial QA critic reviewing one commit before it may be pushed, against the WHP engineering standards.

TWO jobs:

1. Is the "QA:" line supported by evidence of a check that was actually RUN against THIS change, or is it theater?
   Real: "curled X, got Y", "ran the suite, N passed", "clicked X, saw Y", "traced input X through fn Y at line Z to W".
   Theater: "syntax OK", "the build compiled", "the deploy landed", "traced the happy path", "matches the pattern used by another tool", or ANY claim that could have been written WITHOUT running the change.

2. Does the diff break a WHP standard without the message acknowledging it? Flag if so:
   - a committed secret (key, token, password, signing key) added to a tracked file
   - an auth fallback that fails OPEN (|| 'changeme', || '', "if no users configured allow all")
   - blanking stored data on a failed fetch, or auto-granting new access to everyone
   - an em dash anywhere in the diff or message
   - a Python import added with no evidence the server was started locally (see standards section 6)
   - browser code that merges request headers with object spread ({ ...init.headers }) or reads them by index (init.headers?.['X-Thing']): a Headers instance spreads to {} and indexes to undefined, so this silently drops the Authorization the auth client sets (see standards section 3). Merging via new Headers() + .has()/.set() is the correct form and is NOT a violation.

Be strict but fair. A genuinely trivial, verifiable change (a doc typo, a comment) with an honest QA line passes. When the QA line is empty theater, FAIL.

Return JSON only:
{ "verdict": "PASS" | "FAIL",
  "reason": "one short sentence: what supports or undermines it",
  "missing_checks": ["specific checks that should have been run before push"] }`;

async function askClaude(diff, message) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: 'user',
        content: `Commit message:\n\`\`\`\n${message}\n\`\`\`\n\nDiff (first 8000 chars):\n\`\`\`\n${diff.slice(0, 8000)}\n\`\`\`` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';
  // Prefer a fenced ```json block, else the first balanced object. Tolerant of surrounding prose.
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const bare = text.match(/\{[\s\S]*?"verdict"[\s\S]*?\}/);
  const raw = (fenced && fenced[1]) || (bare && bare[0]) || (text.match(/\{[\s\S]*\}/) || [])[0];
  if (!raw) throw new Error('critic returned non-JSON: ' + text.slice(0, 200));
  return JSON.parse(raw);
}

async function reviewCommit(sha) {
  const message = execSync(`git log -1 --format=%B ${sha}`, { encoding: 'utf8' }).trim();
  if (/^Merge (branch|remote-tracking|tag|pull request) /.test(message) || /^Revert "/.test(message)) {
    log(`SKIP ${sha.slice(0, 7)}: merge/revert`); return { verdict: 'PASS', skipped: true };
  }
  const diff = execSync(`git show ${sha} --format= --no-color`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // The model occasionally wraps the JSON in prose or returns two blocks. That is a transient
  // formatting hiccup, not a real verdict, so retry once before letting it block the push.
  let v, lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { v = await askClaude(diff, message); break; }
    catch (e) { lastErr = e; log(`retry ${sha.slice(0,7)}: ${e.message}`); }
  }
  if (!v) throw lastErr;
  log(`${v.verdict}  ${sha.slice(0, 7)}  ${message.split('\n')[0].slice(0, 60)}  — ${v.reason}`);
  return v;
}

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }

async function main() {
  const lines = readStdin().split('\n').filter(Boolean);
  if (!lines.length) { log('SKIP: no ref updates on stdin'); process.exit(0); }
  const commits = new Set();
  for (const line of lines) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (/^0+$/.test(localSha)) continue;                              // branch deletion
    const range = /^0+$/.test(remoteSha) ? localSha : `${remoteSha}..${localSha}`;
    try {
      execSync(`git rev-list ${range}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
        .forEach(s => commits.add(s));
    } catch (e) { log(`WARN could not enumerate ${range}: ${e.message}`); }
  }
  if (!commits.size) { log('SKIP: no commits to review'); process.exit(0); }
  log(`reviewing ${commits.size} commit(s)…`);
  let failed = 0;
  for (const sha of commits) {
    let v;
    try { v = await reviewCommit(sha); }
    catch (e) { log(`ERR ${sha.slice(0, 7)}: ${e.message}`); failed++; continue; }
    if (v.skipped) continue;
    if (v.verdict === 'FAIL') {
      failed++;
      console.error(`\n❌ QA CRITIC BLOCKED ${sha.slice(0, 7)}`);
      console.error(`   ${v.reason}`);
      (v.missing_checks || []).forEach(c => console.error(`     - ${c}`));
      console.error(`\n   Fix by running the missing checks and amending the QA line with real evidence,`);
      console.error(`   or QA_OVERRIDE="<reason>" git push if you genuinely cannot verify locally.\n`);
    }
  }
  if (failed) { console.error(`${failed} commit(s) blocked. Push aborted.`); process.exit(1); }
  log(`✅ all ${commits.size} commit(s) passed`);
  process.exit(0);
}

main().catch(e => { log(`FATAL ${e.message}`); process.exit(1); });
