/**
 * Central model configuration.
 *
 * Every Claude call in this repo imports its model from here so a future model
 * migration is a one-file change instead of hunting ~20 scattered literals.
 *
 * MODEL_DEEP — judgment-heavy synthesis: strategy, personas, action plans,
 *              competitive positioning, vision analysis of screenshots.
 * MODEL_FAST — structured extraction, classification, and summarisation where
 *              the shape of the answer is already known.
 *
 * IMPORTANT — max_tokens budgeting:
 * These models think by default (adaptive thinking), and max_tokens caps
 * thinking + visible text together. A budget that was generous on Opus 4.6
 * can now be consumed entirely by thinking, returning zero text and a
 * stop_reason of "max_tokens" — which silently breaks JSON parsing.
 * Leave real headroom: MIN_TOKENS_JSON is the floor for any call whose
 * response gets JSON.parse()d.
 */

const MODEL_DEEP = 'claude-opus-5';
const MODEL_FAST = 'claude-sonnet-5';

// Floor for calls whose output is parsed as JSON. Below roughly this,
// thinking can eat the whole budget and leave no text behind.
const MIN_TOKENS_JSON = 2000;

// Caps thinking depth on cheap extraction calls that don't need deliberation.
const EFFORT_LOW = { effort: 'low' };

/**
 * Pull the assistant's visible text out of a Messages API response.
 *
 * Do NOT read msg.content[0].text directly. With thinking on, content[0] is a
 * thinking block and .text is undefined — every JSON.parse downstream then
 * fails on "undefined". Thinking blocks also arrive with empty text by
 * default, so they are useless to us; this joins the real text blocks.
 */
function extractText(msg) {
  if (!msg || !Array.isArray(msg.content)) return '';
  return msg.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('');
}

module.exports = { MODEL_DEEP, MODEL_FAST, MIN_TOKENS_JSON, EFFORT_LOW, extractText };
