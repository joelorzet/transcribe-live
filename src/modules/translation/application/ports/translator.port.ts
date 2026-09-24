import type { LanguageCode } from '@shared/language/language';
import type { Glossary } from '@modules/glossary/domain/glossary.entity';

export interface TranslationRequest {
  text: string;
  from: LanguageCode;
  to: LanguageCode;
  glossary: Glossary;
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
