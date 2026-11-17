const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const bp = require('../analysis/site_blueprint');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
const quiet = () => {};

const site = (target) => ({ brands: [
  target,
  { role: 'competitor', name: 'Kiddy Land', featuredCategories: ['Characters', 'Gifts', 'Sanrio'], heroContent: { headline: 'New arrivals' }, promoBanners: ['Free wrapping'], schemaMarkup: ['Organization'] },
  { role: 'competitor', name: 'Blocked Co', botBlocked: true, navigation: [], featuredCategories: [] },
] });
const blockedTarget = { role: 'target', name: 'Toys R Us Japan', botBlocked: true, navigation: [], featuredCategories: [], skippedNoDirectRequest: true };
const liveTarget = { role: 'target', name: 'Toys R Us Japan', navigation: [{ text: 'Toys' }], featuredCategories: ['Toys', 'Baby'], heroContent: { headline: 'Summer sale' }, promoBanners: [] };

const goodReply = () => JSON.stringify({
  summary: 'Build age and character led navigation.',
  blueprint: {
    navigation: [{ item: 'Shop by age and stage', rationale: 'Parents shop by age. Em dash \u2014 here', evidence: ['Akachan Honpo', 'reviews'], priority: 'HIGH', effort: 'low', confidence: 'high' }, { item: 'Character hubs', rationale: 'r', evidence: ['Kiddy Land'] }],
    homepage: [{ item: 'Seasonal hero', rationale: 'r', evidence: ['demand'], priority: 'high' }],
    productAndCategoryPages: [], searchAndDiscovery: [], trustAndService: [], seoAndAiVisibility: [],
    seasonalCalendar: [{ moment: 'Christmas', timing: 'Dec 14 to 20', action: 'Gift hub', evidence: ['trends'] }],
  },
  bestPractices: [{ practice: 'Free gift wrapping', whoDoesIt: ['Kiddy Land'], whyItWorks: 'w', howToApply: 'h', priority: 'bogus', effort: 'low', confidence: 'medium' }, { practice: 'b' }, { practice: 'c' }],
  verifyFirst: [{ check: 'Is there an age filter?', how: 'Open any category', ifMissing: 'Add one', ifPresent: 'Check labels' }, { check: 'b' }, { check: 'c' }],
  roadmap: [{ phase: 'First 30 days', actions: ['a'] }],
});
const stub = (replies) => { let i = 0; const calls = []; return { calls, messages: { create: async req => { calls.push(req); const t = replies[Math.min(i++, replies.length - 1)]; if (t instanceof Error) throw t; return { stop_reason: 'end_turn', content: [{ type: 'text', text: t }] }; } } }; };
const sandbox = (target) => {
  const d = tmp(); const b = path.join(d, 'brands', 's'); fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, 'profile.json'), JSON.stringify({ name: 'Toys R Us Japan' }));
  fs.writeFileSync(path.join(b, 'site_intelligence.json'), JSON.stringify(site(target)));
  return { d, b };
};

test('targetObserved: blocked, stale, manual capture and live are told apart', () => {
  assert.strictEqual(bp.targetObserved(site(blockedTarget)).observed, false);
  assert.strictEqual(bp.targetObserved(site({ ...liveTarget, stale: true })).observed, false);
  assert.strictEqual(bp.targetObserved(site({ ...liveTarget, manualCapture: true })).manual, true);
  assert.strictEqual(bp.targetObserved(site(liveTarget)).observed, true);
  assert.strictEqual(bp.targetObserved({ brands: [] }).observed, false);
});

test('evidence: competitors observed and unobserved are counted, a blocked target is never described', () => {
  const ev = bp.buildEvidence({ profile: {}, site: site(blockedTarget) });
  assert.strictEqual(ev.basis.competitorsTotal, 2);
  assert.strictEqual(ev.basis.competitorsScraped, 1);
  assert.match(ev.text, /Kiddy Land[^\n]*Characters, Gifts, Sanrio/);
  assert.match(ev.text, /Blocked Co: could not be observed/);
  assert.match(ev.text, /TARGET SITE: NOT OBSERVED/);
  assert.doesNotMatch(ev.text, /TARGET SITE AS OBSERVED/);
});

test('evidence includes marketplace, demand, personas and seo when present, and is size capped', () => {
  const big = 'x'.repeat(500);
  const ev = bp.buildEvidence({
    profile: {}, site: site(blockedTarget),
    marketplace: { categories: [{ topItems: [{ title: 'Tomica set' }] }], brandMix: [{ brand: 'Takara Tomy' }], reviews: [{ rating: 5, text: 'my 2 year old loves it' }] },
    demand: { trends: [{ term: 'おもちゃ', termEn: 'toys', topRelated: ['x'] }] },
    personas: { personas: [{ name: 'Mom', painPoints: [big], motivators: ['safe'], preferredChannels: ['LINE'] }] },
    seo: { geoSection: { combinedScore: 97 }, priorityActions: [{ action: 'Fix Cloudflare' }] },
  });
  assert.match(ev.text, /Tomica set/); assert.match(ev.text, /Takara Tomy/); assert.match(ev.text, /おもちゃ \(toys\)/); assert.match(ev.text, /Mom: pain points/); assert.match(ev.text, /97\/100/);
  assert.strictEqual(ev.basis.geoScore, 97);
  const huge = bp.buildEvidence({ profile: {}, site: { brands: Array.from({ length: 80 }, (_, i) => ({ role: 'competitor', name: 'C' + i, featuredCategories: Array.from({ length: 16 }, (_, j) => 'cat' + j) })) } });
  assert.ok(huge.text.length <= 16000);
});

test('prompt: a blocked target forbids claims about the current site; an observed one asks for a comparison', () => {
  const blocked = bp.buildPrompt('Toys R Us Japan', bp.buildEvidence({ site: site(blockedTarget) }));
  assert.match(blocked.system, /was NOT observed/);
  assert.match(blocked.system, /Never state or imply what the site currently contains or lacks/);
  assert.match(blocked.user, /verifyFirst/);
  const live = bp.buildPrompt('Toys R Us Japan', bp.buildEvidence({ site: site(liveTarget) }));
  assert.match(live.system, /WAS observed/);
  assert.doesNotMatch(live.system, /Never state or imply/);
});

test('normalizeBlueprint: coerces enums, strips em dashes, drops malformed items, never throws on junk', () => {
  const n = bp.normalizeBlueprint(JSON.parse(goodReply()));
  assert.strictEqual(n.blueprint.navigation[0].priority, 'high');
  assert.strictEqual(n.blueprint.navigation[1].confidence, 'low');
  assert.ok(!JSON.stringify(n).includes('\u2014'));
  assert.strictEqual(n.bestPractices[0].priority, 'medium');
  assert.ok(n.verifyFirst.length >= 3);
  for (const junk of [null, undefined, 5, 'x', [], { blueprint: 5, bestPractices: 'x' }]) assert.doesNotThrow(() => bp.normalizeBlueprint(junk));
  assert.strictEqual(bp.isUsable(bp.normalizeBlueprint({})), false);
});

test('run (benchmark mode): writes a labelled blueprint with the evidence basis', async () => {
  const { d, b } = sandbox(blockedTarget);
  const client = stub([goodReply()]);
  const { output } = await bp.run({ slug: 's', dataDir: d, client, log: quiet });
  const file = JSON.parse(fs.readFileSync(path.join(b, 'site_blueprint.json'), 'utf8'));
  assert.strictEqual(file.mode, 'benchmark'); assert.strictEqual(file.targetObserved, false);
  assert.match(file.targetNote, /not a finding about the current site/);
  assert.strictEqual(file.evidenceBasis.competitorsScraped, 1);
  assert.strictEqual(client.calls.length, 1);
  assert.strictEqual(output.mode, 'benchmark');
});

test('run (observed target) is audit-informed', async () => {
  const { d } = sandbox(liveTarget);
  const { output } = await bp.run({ slug: 's', dataDir: d, client: stub([goodReply()]), log: quiet });
  assert.strictEqual(output.mode, 'audit-informed'); assert.strictEqual(output.targetObserved, true);
});

test('run: bad JSON is retried once; two failures keep the previous file, marked stale, and throw', async () => {
  const { d, b } = sandbox(blockedTarget);
  const ok = stub(['not json', goodReply()]);
  await bp.run({ slug: 's', dataDir: d, client: ok, log: quiet });
  assert.strictEqual(ok.calls.length, 2);
  const before = JSON.parse(fs.readFileSync(path.join(b, 'site_blueprint.json'), 'utf8'));
  await assert.rejects(bp.run({ slug: 's', dataDir: d, client: stub([new Error('overloaded')]), log: quiet }), /blueprint generation failed/);
  const after = JSON.parse(fs.readFileSync(path.join(b, 'site_blueprint.json'), 'utf8'));
  assert.strictEqual(after.stale, true); assert.strictEqual(after.lastError, 'overloaded');
  assert.deepStrictEqual(after.blueprint, before.blueprint, 'the good content is kept');
});

test('run: a reply missing the required sections is rejected, and dry run makes no call and writes nothing', async () => {
  const { d, b } = sandbox(blockedTarget);
  await assert.rejects(bp.run({ slug: 's', dataDir: d, client: stub([JSON.stringify({ summary: 'x', blueprint: {} })]), log: quiet }), /missing required sections/);
  assert.ok(!fs.existsSync(path.join(b, 'site_blueprint.json')));
  const c = stub([goodReply()]);
  const r = await bp.run({ slug: 's', dataDir: d, client: c, dryRun: true, log: quiet });
  assert.strictEqual(r.dryRun, true); assert.strictEqual(c.calls.length, 0);
  assert.ok(!fs.existsSync(path.join(b, 'site_blueprint.json')));
});

test('run keeps history of the previous blueprint', async () => {
  const { d, b } = sandbox(blockedTarget);
  await bp.run({ slug: 's', dataDir: d, client: stub([goodReply()]), log: quiet });
  await bp.run({ slug: 's', dataDir: d, client: stub([goodReply()]), log: quiet });
  assert.ok(fs.readdirSync(path.join(b, 'history')).some(f => f.startsWith('site_blueprint_')));
});

test('wiring: audit honesty, phase order, action plan input, report and translation sources', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const audit = read('analysis/website_audit.js');
  assert.match(audit, /was NOT observed in this run/);
  assert.match(audit, /Do NOT state or imply what the site has or lacks/);
  assert.match(audit, /auditBasis: targetUnobserved \? 'benchmark' : 'observed'/);
  const bd = read('analysis/brand_discovery.js');
  const order = ['name: \'personas\'', 'name: \'blueprint\'', 'name: \'plan\'', 'name: \'translate\''].map(s => bd.indexOf(s));
  assert.ok(order.every(i => i > 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'blueprint runs after personas and before plan and translate');
  assert.match(read('analysis/action_plan.js'), /site_blueprint\.json/);
  assert.match(read('analysis/translate_outputs.js'), /'site_blueprint\.json'/);
  assert.match(read('server.js'), /REPORT_MODULES = \[[^\]]*'site_blueprint'/);
  assert.match(read('server.js'), /name: 'site_blueprint'/);
});

test('internal field names the model echoes never reach the reader, in the prompt or the output', () => {
  const prompt = bp.buildPrompt('X', bp.buildEvidence({ site: site(blockedTarget) }));
  assert.doesNotMatch(prompt.system, /The "?verifyFirst"? checklist/);
  assert.match(prompt.system, /Never mention field or code names/);
  const n = bp.normalizeBlueprint({ summary: 'Run the verifyFirst checklist then the bestPractices.', blueprint: { navigation: [{ item: 'Do seoAndAiVisibility work', rationale: 'See verifyFirst' }] }, roadmap: [{ phase: 'p', actions: ['Run the verifyFirst checklist'] }] });
  // check string VALUES only: the object keys legitimately carry these names
  const values = []; (function walk(x) { if (typeof x === 'string') values.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); })(n);
  assert.doesNotMatch(values.join('\n'), /verifyFirst|bestPractices|seoAndAiVisibility/);
  assert.match(n.roadmap[0].actions[0], /Run the Verify first checklist/);
});

test('verify-first items get a stable id from the English text; stale competitors are not counted as observed', () => {
  const n1 = bp.normalizeBlueprint(JSON.parse(goodReply()));
  const n2 = bp.normalizeBlueprint(JSON.parse(goodReply()));
  assert.match(n1.verifyFirst[0].id, /^[0-9a-f]{8}$/);
  assert.strictEqual(n1.verifyFirst[0].id, n2.verifyFirst[0].id);
  assert.notStrictEqual(n1.verifyFirst[0].id, n1.verifyFirst[1].id);
  const ev = bp.buildEvidence({ site: { brands: [blockedTarget, { role: 'competitor', name: 'Old Co', stale: true, featuredCategories: ['a', 'b'] }, { role: 'competitor', name: 'New Co', featuredCategories: ['a'] }] } });
  assert.strictEqual(ev.basis.competitorsScraped, 1);
  assert.match(ev.text, /Old Co \[STALE data\]/);
});

test('parseModelJson takes the first balanced object, ignoring trailing prose with braces and braces inside strings', () => {
  assert.deepStrictEqual(bp.parseModelJson('{"a":"x } y","b":[1]}\nNote: see {above} and {below}'), { a: 'x } y', b: [1] });
  assert.deepStrictEqual(bp.parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.strictEqual(bp.parseModelJson('{"a":'), null);
  assert.strictEqual(bp.parseModelJson('no json'), null);
});

test('scraped evidence is fenced as untrusted data and the retry after max_tokens gets a bigger budget and low effort', async () => {
  const p = bp.buildPrompt('X', bp.buildEvidence({ site: site(blockedTarget) }));
  assert.match(p.system, /untrusted DATA/);
  assert.match(p.user, /^<evidence>/);
  assert.match(p.user, /<\/evidence>/);
  const { d } = sandbox(blockedTarget);
  const reqs = [];
  const client = { messages: { create: async req => { reqs.push(req); if (reqs.length === 1) return { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] }; return { stop_reason: 'end_turn', content: [{ type: 'text', text: goodReply() }] }; } } };
  await bp.run({ slug: 's', dataDir: d, client, log: quiet });
  assert.strictEqual(reqs[0].max_tokens, 18000);
  assert.strictEqual(reqs[1].max_tokens, 20000);
  assert.deepStrictEqual(reqs[1].output_config, { effort: 'low' });
  assert.strictEqual(reqs[0].output_config, undefined);
});

test('one shared observed rule: a manual capture with no readable navigation is NOT observed, a stale scrape is not, a skipped target is not', () => {
  const { targetObservation } = require('../utils/observed');
  assert.strictEqual(targetObservation({ manualCapture: true, navigation: [], featuredCategories: [] }).observed, false);
  assert.strictEqual(targetObservation({ manualCapture: true, navigation: [{ text: 'a' }], featuredCategories: ['a'] }).observed, true);
  assert.strictEqual(targetObservation({ stale: true, navigation: [{ text: 'a' }] }).observed, false);
  assert.strictEqual(targetObservation({ skippedNoDirectRequest: true, navigation: [{ text: 'a' }] }).observed, false);
  assert.strictEqual(targetObservation(null).observed, false);
});

test('personas and the action plan do not state the unobserved site contents as fact (and stay unchanged without the flag)', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const personas = read('analysis/personas.js');
  assert.match(personas, /siteIntel\.auditBasis === 'benchmark'/);
  assert.match(personas, /so do not assume what it lacks/);
  assert.match(personas, /'NAVIGATION GAPS VS COMPETITORS'/, 'original wording kept for brands without the flag');
  const plan = read('analysis/action_plan.js');
  assert.match(plan, /siteIntel\.auditBasis === 'benchmark'/);
  assert.match(plan, /these are not findings about it/);
  assert.match(plan, /'WEBSITE AUDIT TOP OPPORTUNITIES'/);
  assert.match(plan, /blueprint\.stale/);
});

test('neutralizeUnobservedAudit removes every claim about the current site and keeps the competitor-based recommendations', () => {
  const { neutralizeUnobservedAudit } = require('../analysis/website_audit');
  const model = {
    navGaps: [{ category: 'Gifts' }], messagingGaps: [{ gap: 'g' }], topOpportunities: [{ title: 't' }],
    ctaEffectiveness: { rating: 'needs improvement', observations: 'The CTAs are weak' },
    crawlerVisibility: { heroTextIsLive: false, contentInImagesLevel: 'high', aiReadabilityNote: 'Hero text is image-embedded' },
    heroMessagingAnalysis: { targetStrengths: ['clear hero'], targetGaps: ['no promo'], competitorBestPractices: ['Kiddy Land shows ranking'] },
    navigationAnalysis: { topCategories: ['Toys'], missingCategories: ['Gifts'], depth: 'deep', notes: 'deep nav' },
    productContentReview: { brandsCovered: ['Lego'], ageGroupCoverage: ['3+'], priceVisibility: 'hidden', contentGaps: ['product schema not detected'] },
  };
  const out = neutralizeUnobservedAudit(model);
  const s = JSON.stringify(out);
  for (const bad of ['clear hero', 'no promo', 'CTAs are weak', 'image-embedded', 'not detected', 'deep nav', 'Lego', 'hidden', 'high']) assert.ok(!s.includes(bad), bad);
  assert.strictEqual(out.ctaEffectiveness, null);
  assert.strictEqual(out.crawlerVisibility.heroTextIsLive, null);
  assert.deepStrictEqual(out.heroMessagingAnalysis.competitorBestPractices, ['Kiddy Land shows ranking']);
  assert.deepStrictEqual(out.navigationAnalysis.missingCategories, ['Gifts']);
  assert.deepStrictEqual(out.navGaps, model.navGaps);
  assert.doesNotThrow(() => neutralizeUnobservedAudit(null));
  assert.deepStrictEqual(model.ctaEffectiveness.rating, 'needs improvement', 'input not mutated');
  const src = fs.readFileSync(path.join(__dirname, '../analysis/website_audit.js'), 'utf8');
  assert.match(src, /if \(targetUnobserved\) analysis = neutralizeUnobservedAudit\(analysis\)/);
  assert.match(src, /Nav categories: not observed/);
});

test('blueprint items need their own title; a finished run summary from before a phase existed shows it as skipped, not pending', () => {
  const n = bp.normalizeBlueprint({ blueprint: { seoAndAiVisibility: [{ practice: 'x' }, { item: 'Real title' }] } });
  assert.strictEqual(n.blueprint.seoAndAiVisibility.length, 1);
  const ri = require('../modules/run_info');
  const lock = require('../utils/run_lock');
  const d = tmp(); fs.mkdirSync(path.join(d, 'brands/s'), { recursive: true });
  fs.writeFileSync(path.join(d, 'brands/s/_run_summary.json'), JSON.stringify({ phases: [{ name: 'collect', exit: { a: 0 } }, { name: 'analyse', exit: { a: 0 } }, { name: 'personas', exit: { a: 0 } }, { name: 'plan', exit: { a: 0 } }, { name: 'translate', exit: { a: 0 } }], finishedAt: 'x' }));
  const r = ri.getRunInfo('s', d);
  assert.strictEqual(r.phases.find(p => p.name === 'blueprint').state, 'skipped');
  assert.ok(lock);
});

test('truncation never cuts a word in half, and the summary keeps up to 1400 characters', () => {
  const long = 'Build the site around three demand engines and structured data. '.repeat(40);
  const n = bp.normalizeBlueprint({ summary: long });
  assert.ok(n.summary.length <= 1400 && n.summary.endsWith('…'));
  assert.match(n.summary, /(structured data\.|and|engines|around|the|site|three|demand|Build) ?…$|\.…$/);
  assert.doesNotMatch(n.summary, /\bstructu…$/);
  const cut = bp.normalizeBlueprint({ summary: 'word '.repeat(400) });
  assert.doesNotMatch(cut.summary, /\bwor…$/);
});
