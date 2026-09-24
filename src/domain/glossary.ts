/**
 * A per-track list of technical terms, speaker names, product names and
 * acronyms. It is used twice:
 *   1. as `customVocabulary` biasing on the speech model, and
 *   2. as a do-not-translate / translate-exactly table for the translator.
 *
 * This is the single highest-leverage feature for the "accuracy with technical
 * terminology" judging criterion: without it, models reliably mangle things
 * like "Kubernetes", "gRPC", "Nerdearla" or "Ceibo".
 */
export interface GlossaryTerm {
  /** The term as it should appear in the transcript. */
  term: string;
  /** Optional forced translations, keyed by language code. */
  translations?: Record<string, string>;
  /** If true, the term is kept verbatim in every language. */
  keepVerbatim?: boolean;
}

export interface Glossary {
  id: string;
  name: string;
  description?: string;
  terms: GlossaryTerm[];
}

export const EMPTY_GLOSSARY: Glossary = { id: 'none', name: 'None', terms: [] };

/**
 * The speech API accepts up to 1000 terms but degrades past ~100, so we cap.
 * Longer, rarer terms benefit most from biasing, so they win ties.
 */
export const MAX_VOCABULARY_TERMS = 100;

export function toCustomVocabulary(glossary: Glossary): string[] {
  return [...new Set(glossary.terms.map((t) => t.term.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_VOCABULARY_TERMS);
}

/** Renders the glossary as instructions for the translation model. */
export function toTranslationRules(glossary: Glossary, target: string): string[] {
  const rules: string[] = [];
  for (const term of glossary.terms) {
    const forced = term.translations?.[target];
    if (forced) {
      rules.push(`"${term.term}" -> "${forced}"`);
    } else if (term.keepVerbatim) {
      rules.push(`"${term.term}" -> keep exactly as "${term.term}"`);
    }
  }
  return rules;
}
