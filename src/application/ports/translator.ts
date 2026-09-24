import type { LanguageCode } from '../../domain/language.ts';
import type { Glossary } from '../../domain/glossary.ts';

export interface TranslationRequest {
  text: string;
  from: LanguageCode;
  to: LanguageCode;
  glossary: Glossary;
  /** Preceding transcript, so pronouns and topic carry across segments. */
  context?: string;
}

export interface TranslationResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface TranslatorPort {
  readonly name: string;
  translate(request: TranslationRequest): Promise<TranslationResult>;
}
