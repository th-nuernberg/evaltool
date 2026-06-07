'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { TAP_QUESTIONS, TAP_IDS } = require('./tap');

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const QUESTIONSETS_DIR = path.join(CONFIG_DIR, 'questionsets');
const PROMPTS_FILE = path.join(CONFIG_DIR, 'prompts.yaml');

/** The eight prompt keys the application expects to exist (R6). */
const REQUIRED_PROMPT_KEYS = [
  'freeform_summary',
  'tap_lernfoerderlich',
  'tap_erschwert',
  'tap_verbesserung',
  'conclusion_lehrinhalte',
  'conclusion_strukturierung',
  'conclusion_darbietung',
  'conclusion_workload',
];

/**
 * Validate and normalise a single question. For likert questions a `labels`
 * array is always produced (generated from `scale` when only a count is given)
 * so the client and the submission validator can rely on it.
 */
function normaliseQuestion(q, where, seenIds) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) {
    throw new Error(`${where}: each question must be a mapping`);
  }
  if (!q.id || typeof q.id !== 'string') {
    throw new Error(`${where}: question is missing a string "id"`);
  }
  if (TAP_IDS.includes(q.id)) {
    throw new Error(`${where}: id "${q.id}" is reserved for a built-in TAP question`);
  }
  if (seenIds.has(q.id)) {
    throw new Error(`${where}: duplicate question id "${q.id}"`);
  }
  seenIds.add(q.id);
  if (!q.text || typeof q.text !== 'string') {
    throw new Error(`${where}: question "${q.id}" is missing "text"`);
  }

  if (q.type === 'likert') {
    let labels;
    if (Array.isArray(q.labels)) {
      if (q.labels.length < 2) {
        throw new Error(`${where}: likert "${q.id}" needs at least 2 labels`);
      }
      labels = q.labels.map((l) => String(l));
    } else if (Number.isInteger(q.scale) && q.scale >= 2) {
      labels = Array.from({ length: q.scale }, (_, i) => String(i + 1));
    } else {
      throw new Error(`${where}: likert "${q.id}" needs "labels" (array) or "scale" (int >= 2)`);
    }
    return { id: q.id, type: 'likert', text: q.text, labels };
  }

  if (q.type === 'freeform') {
    return { id: q.id, type: 'freeform', text: q.text };
  }

  throw new Error(`${where}: question "${q.id}" has unknown type "${q.type}" (expected likert|freeform)`);
}

/** Load, validate and normalise one question-set YAML file. */
function loadQuestionSetFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const doc = yaml.load(raw);
  const name = path.basename(file);
  if (!doc || typeof doc !== 'object') {
    throw new Error(`${name}: file is empty or not a mapping`);
  }
  const id = String(doc.id || path.basename(file, path.extname(file)));
  if (!Array.isArray(doc.questions) || doc.questions.length === 0) {
    throw new Error(`${name}: "questions" must be a non-empty list`);
  }

  const seenIds = new Set();
  const questions = doc.questions.map((q, i) => normaliseQuestion(q, `${name}[#${i}]`, seenIds));

  // Always append the fixed TAP questions after the configured block.
  const allQuestions = [...questions, ...TAP_QUESTIONS.map((q) => ({ ...q }))];

  return {
    id,
    title: doc.title ? String(doc.title) : id,
    description: doc.description ? String(doc.description) : '',
    questions: allQuestions,
  };
}

/**
 * Load every question set under config/questionsets/. Throws on the first
 * invalid file so misconfiguration surfaces at startup rather than mid-poll.
 * @returns {Map<string, object>} id -> question set
 */
function loadQuestionSets() {
  if (!fs.existsSync(QUESTIONSETS_DIR)) {
    throw new Error(`Question set directory not found: ${QUESTIONSETS_DIR}`);
  }
  const files = fs
    .readdirSync(QUESTIONSETS_DIR)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort();
  if (files.length === 0) {
    throw new Error(`No question sets (*.yaml) found in ${QUESTIONSETS_DIR}`);
  }

  const sets = new Map();
  for (const f of files) {
    const set = loadQuestionSetFile(path.join(QUESTIONSETS_DIR, f));
    if (sets.has(set.id)) {
      throw new Error(`Duplicate question set id "${set.id}" (in ${f})`);
    }
    sets.set(set.id, set);
  }
  return sets;
}

/**
 * Load the configurable LLM system prompts. Missing keys are a hard error so
 * the operator notices, but the app itself still degrades gracefully if the LLM
 * endpoint is unreachable (see lib/llm.js).
 * @returns {Map<string, {system: string}>}
 */
function loadPrompts() {
  if (!fs.existsSync(PROMPTS_FILE)) {
    throw new Error(`Prompts file not found: ${PROMPTS_FILE}`);
  }
  const doc = yaml.load(fs.readFileSync(PROMPTS_FILE, 'utf8'));
  if (!doc || typeof doc !== 'object') {
    throw new Error('prompts.yaml is empty or not a mapping');
  }
  const prompts = new Map();
  for (const key of REQUIRED_PROMPT_KEYS) {
    const entry = doc[key];
    const system = typeof entry === 'string' ? entry : entry && entry.system;
    if (!system || typeof system !== 'string') {
      throw new Error(`prompts.yaml: missing system prompt for "${key}"`);
    }
    prompts.set(key, { system: system.trim() });
  }
  return prompts;
}

module.exports = {
  CONFIG_DIR,
  QUESTIONSETS_DIR,
  PROMPTS_FILE,
  REQUIRED_PROMPT_KEYS,
  loadQuestionSets,
  loadPrompts,
  loadQuestionSetFile,
  normaliseQuestion,
};
