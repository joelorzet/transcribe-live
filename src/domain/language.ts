/**
 * Languages the pipeline can transcribe and translate.
 * The Vibeathon requires ES<->EN; PT is an optional bonus we support for free.
 */
export const SUPPORTED_LANGUAGES = ['es', 'en', 'pt'] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  es: 'Spanish',
  en: 'English',
  pt: 'Portuguese',
};

/** BCP-47 hints handed to the speech model. */
const BCP47: Record<LanguageCode, string> = {
  es: 'es-AR',
  en: 'en-US',
  pt: 'pt-BR',
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

/**
 * "auto" means: let the model detect the spoken language.
 * Conference speakers code-switch mid-talk, so this is the safe default.
 */
export type SourceLanguage = LanguageCode | 'auto';

export function parseSourceLanguage(value: string): SourceLanguage {
  return value === 'auto' ? 'auto' : parseLanguage(value);
}
