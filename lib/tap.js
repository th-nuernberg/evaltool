'use strict';

/**
 * The three canonical Teaching Analysis Poll (TAP) questions, in their
 * established German wording. These are methodologically fixed and are always
 * appended after a question set's configured questions (R4/R6). Each maps to a
 * dedicated, TAP-theory-grounded LLM prompt key (see config/prompts.yaml).
 */
const TAP_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'tap_lernfoerderlich',
    type: 'freeform',
    tap: true,
    promptKey: 'tap_lernfoerderlich',
    text: 'Was empfinden Sie in dieser Lehrveranstaltung als lernförderlich?',
  }),
  Object.freeze({
    id: 'tap_erschwert',
    type: 'freeform',
    tap: true,
    promptKey: 'tap_erschwert',
    text: 'Was erschwert Ihr Lernen in dieser Lehrveranstaltung?',
  }),
  Object.freeze({
    id: 'tap_verbesserung',
    type: 'freeform',
    tap: true,
    promptKey: 'tap_verbesserung',
    text: 'Welche konkreten Verbesserungsvorschläge haben Sie?',
  }),
]);

const TAP_IDS = TAP_QUESTIONS.map((q) => q.id);

module.exports = { TAP_QUESTIONS, TAP_IDS };
