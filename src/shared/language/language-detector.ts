import type { LanguageCode } from '@shared/language/language';

const MARKERS: Partial<Record<LanguageCode, string[]>> = {
  es: ['que', 'de', 'la', 'el', 'en', 'los', 'las', 'una', 'por', 'para', 'con', 'pero', 'esto', 'nosotros', 'está', 'más', 'cómo', 'porque'],
  en: ['the', 'and', 'of', 'to', 'is', 'that', 'we', 'you', 'this', 'with', 'for', 'are', 'have', 'about', 'what', 'our'],
  pt: ['que', 'de', 'uma', 'para', 'com', 'não', 'você', 'nós', 'isso', 'mais', 'como', 'porque', 'então', 'muito', 'está'],
  fr: ['le', 'la', 'les', 'des', 'une', 'est', 'que', 'pour', 'avec', 'nous', 'vous', 'dans', 'pas', 'plus'],
  it: ['il', 'lo', 'la', 'che', 'di', 'per', 'con', 'una', 'sono', 'questo', 'noi', 'più', 'come'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'wir', 'sie', 'mit', 'für', 'auf', 'eine', 'auch'],
};

const EXCLUSIVE: Partial<Record<LanguageCode, RegExp>> = {
  es: /[¿¡ñ]|ción\b/i,
  pt: /[ãõç]|ção\b/i,
  fr: /[àèùâêîôûëïü]|c'est|qu'/i,
  de: /[äöüß]/i,
};

export function detectLanguage(
  text: string,
  candidates: readonly LanguageCode[],
): LanguageCode | undefined {
  const words = text.toLowerCase().match(/[\p{L}']+/gu);
  if (!words || words.length === 0) return undefined;

  const pool = candidates.filter((code) => MARKERS[code]);
  if (pool.length === 0) return undefined;
  if (pool.length === 1) return pool[0];

  const scores = new Map<LanguageCode, number>();
  for (const code of pool) {
    const markers = MARKERS[code] as string[];
    const hits = words.filter((word) => markers.includes(word)).length;
    let score = hits / words.length;
    const exclusive = EXCLUSIVE[code];
    if (exclusive?.test(text)) score += 0.15;
    scores.set(code, score);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0];
  if (!best || best[1] === 0) return undefined;

  const runnerUp = ranked[1];
  if (runnerUp && best[1] - runnerUp[1] < 0.01) return undefined;

  return best[0];
}
