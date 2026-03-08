/**
 * Module 6b — Competitor Email Intelligence Analysis
 * Reads email_inbox.json and uses Claude to generate structured competitive intel:
 * - Welcome offer benchmarking
 * - Subject line tactics
 * - Brand voice analysis
 * - AK email strategy recommendations
 * Saves to /data/email_analysis.json
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/email_analysis.log');
const INPUT_FILE = path.join(__dirname, '../data/email_inbox.json');
const OUTPUT_FILE = path.join(__dirname, '../data/email_analysis.json');

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function ensureDirs() {
  [path.join(__dirname, '../data'), path.join(__dirname, '../logs')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function buildEmailSummary(inboxData) {
  const lines = [];
  for (const brand of inboxData.brands) {
    if (brand.emails.length === 0) {
      lines.push(`${brand.name}: No emails received yet`);
      continue;
    }
    for (const email of brand.emails) {
      const snippet = email.snippet.replace(/\s*͏\s*/g, ' ').replace(/&#39;/g, "'").trim().substring(0, 300);
      lines.push(`
Brand: ${brand.name}
Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Preview text (snippet): ${snippet}
Offer detected: ${email.offer || 'none'}
---`);
    }
  }
  return lines.join('\n');
}

async function run() {
  ensureDirs();
  log('=== Email Analysis Started ===');

  if (!fs.existsSync(INPUT_FILE)) {
    log('FATAL: email_inbox.json not found. Run npm run check:inbox first.');
    process.exit(1);
  }

  const inboxData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const totalEmails = inboxData.totalEmailsFound || 0;

  if (totalEmails === 0) {
    log('No emails to analyze yet.');
    const empty = { generatedAt: new Date().toISOString(), status: 'no_data', message: 'No competitor emails received yet. Run check:inbox after signing up for newsletters.' };
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(empty, null, 2));
    process.exit(0);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const emailSummary = buildEmailSummary(inboxData);

  const systemPrompt = `You are a senior email marketing strategist and competitive intelligence analyst for Anne Klein, a women's workwear brand (price range $50–$300, target: women 38–55, polished professional).

Your job is to extract strategic intelligence from competitor emails to help Anne Klein improve its entire email program — across all email types, not just welcome emails.`;

  const prompt = `Here are the competitor marketing emails received after signing up for their newsletters:

${emailSummary}

Analyze these emails across all email types and return a JSON object with the following structure. Be specific and cite actual subject lines, offers, and copy from the emails above. Welcome emails are just one category — analyze all types present.

{
  "emailProgramOverview": {
    "summary": "2-3 sentence overview of the competitive email landscape observed",
    "brandsAnalyzed": ["brand names with data"],
    "emailTypesMix": [
      {
        "brand": "",
        "typesObserved": ["Welcome", "Promotion", "Rewards", "Product Launch", etc],
        "totalEmails": 0,
        "programStrength": "A/B/C — overall assessment of their email program sophistication"
      }
    ]
  },
  "emailTypeAnalysis": {
    "welcome": {
      "present": true,
      "benchmark": [
        {
          "brand": "",
          "subjectLine": "",
          "offer": "discount amount or none",
          "tactic": "1 sentence on strategy",
          "loyaltyPush": "yes/no",
          "grade": "A/B/C/D"
        }
      ],
      "akRecommendation": "specific recommendation for AK's welcome email"
    },
    "rewards": {
      "present": true,
      "observations": [
        { "brand": "", "tactic": "", "example": "" }
      ],
      "akRecommendation": "does AK have/need a rewards email program?"
    },
    "promotions": {
      "present": true,
      "tactics": [
        { "brand": "", "offerType": "", "subjectLine": "", "urgencyTechnique": "" }
      ],
      "akRecommendation": "how AK should approach promotional emails"
    },
    "productLaunch": {
      "present": true,
      "observations": [
        { "brand": "", "approach": "", "subjectLine": "" }
      ],
      "akRecommendation": "how AK should announce new products via email"
    },
    "other": [
      {
        "type": "category name e.g. Editorial, Seasonal, Urgency",
        "brand": "",
        "observation": "",
        "akOpportunity": ""
      }
    ]
  },
  "subjectLineTactics": [
    {
      "tactic": "e.g. Offer-forward, Emotion-first, Personalized entitlement, Urgency",
      "example": "exact subject line",
      "brand": "",
      "emailType": "Welcome/Promotion/etc",
      "useForAK": "yes/no and why"
    }
  ],
  "brandVoiceNotes": [
    {
      "brand": "",
      "tone": "e.g. warm/friendly, aspirational, transactional",
      "observation": "what stands out",
      "vsAK": "how this compares to AK's brand voice opportunity"
    }
  ],
  "akEmailStrategy": {
    "programGaps": ["specific gaps in AK's email program vs competitors"],
    "priorityActions": [
      "specific, actionable recommendation grounded in competitor data"
    ],
    "emailCalendarSuggestion": "suggested email cadence and mix for AK (types + frequency)"
  }
}`;

  log('Sending to Claude for analysis...');
  let analysis;
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0].text;
    // Find outermost balanced braces to avoid trailing-text parse errors
    const start = raw.indexOf('{');
    if (start !== -1) {
      let depth = 0, end = -1;
      for (let i = start; i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        analysis = JSON.parse(raw.slice(start, end + 1));
        log('Claude analysis complete.');
      } else {
        log('ERROR: Unbalanced JSON braces');
        analysis = { error: 'Unbalanced JSON in response' };
      }
    } else {
      log('ERROR: No JSON found in response');
      analysis = { error: 'No JSON in response' };
    }
  } catch (err) {
    log(`ERROR: ${err.message}`);
    analysis = { error: err.message };
  }

  const output = {
    generatedAt: new Date().toISOString(),
    emailCount: totalEmails,
    brandsWithData: inboxData.brands.filter(b => b.emails.length > 0).map(b => b.name),
    analysis,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  log(`=== Done. Saved to ${OUTPUT_FILE} ===`);

  if (analysis && !analysis.error) {
    console.log('\n========================================');
    console.log('EMAIL INTELLIGENCE ANALYSIS COMPLETE');
    console.log('========================================');
    console.log(`Brands analyzed: ${output.brandsWithData.join(', ')}`);
    if (analysis.emailProgramOverview?.summary) {
      console.log(`\nOverview: ${analysis.emailProgramOverview.summary}`);
    }
    if (analysis.akEmailStrategy?.priorityActions?.length) {
      console.log(`\nAK Priority Actions:`);
      analysis.akEmailStrategy.priorityActions.forEach((a, i) => console.log(`  ${i + 1}. ${a}`));
    }
    if (analysis.akEmailStrategy?.emailCalendarSuggestion) {
      console.log(`\nEmail Calendar: ${analysis.akEmailStrategy.emailCalendarSuggestion}`);
    }
  }
}

run().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
