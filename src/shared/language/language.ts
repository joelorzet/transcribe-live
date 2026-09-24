export const SUPPORTED_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'nl', 'ja', 'zh'] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  es: 'Spanish',
  en: 'English',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  ja: 'Japanese',
  zh: 'Chinese (Simplified)',
};

const BCP47: Record<LanguageCode, string> = {
  es: 'es-AR',
  en: 'en-US',
  pt: 'pt-BR',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  nl: 'nl-NL',
  ja: 'ja-JP',
  zh: 'cmn-Hans-CN',
};

export function isLanguageCode(value: string): value is LanguageCode {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function parseLanguage(value: string): LanguageCode {
  const normalised = value.trim().toLowerCase().slice(0, 2);
  if (!isLanguageCode(normalised)) {
    throw new Error(`Unsupported language: "${value}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}`);
  }
  return normalised;
}

export function languageName(code: LanguageCode): string {
  return LANGUAGE_NAMES[code];
}

export function toBcp47(code: LanguageCode): string {
  return BCP47[code];
}

export type SourceLanguage = LanguageCode | 'auto';

export function parseSourceLanguage(value: string): SourceLanguage {
  return value === 'auto' ? 'auto' : parseLanguage(value);
}

export function parseLanguageList(raw: string): LanguageCode[] {
  const parsed = raw
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)
    .map(parseLanguage);
  return [...new Set(parsed)];
}
