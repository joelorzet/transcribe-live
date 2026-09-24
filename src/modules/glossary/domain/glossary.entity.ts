export interface GlossaryTerm {
  term: string;
  translations?: Record<string, string>;
  keepVerbatim?: boolean;
}

export interface Glossary {
  id: string;
  name: string;
  description?: string;
  terms: GlossaryTerm[];
}

export const EMPTY_GLOSSARY: Glossary = { id: 'none', name: 'None', terms: [] };

export const MAX_VOCABULARY_TERMS = 100;

export function toCustomVocabulary(glossary: Glossary): string[] {
  return [...new Set(glossary.terms.map((t) => t.term.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_VOCABULARY_TERMS);
}

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
