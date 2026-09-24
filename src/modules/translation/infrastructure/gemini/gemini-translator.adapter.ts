import { languageName } from '@shared/language/language';
import { toTranslationRules } from '@modules/glossary/domain/glossary.entity';
import type { TranslationRequest, TranslationResult, TranslatorPort } from '@modules/translation/application/ports/translator.port';
import type { LoggerPort } from '@shared/ports/system.port';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface GeminiTranslatorConfig {
  apiKey: string;
  models: string[];
  logger: LoggerPort;
  timeoutMs?: number;
}

export class GeminiTranslator implements TranslatorPort {
  readonly name = 'gemini';
  readonly #config: GeminiTranslatorConfig;
  readonly #thinkingSupport = new Map<string, boolean>();
  #preferred = 0;

  constructor(config: GeminiTranslatorConfig) {
    this.#config = config;
    if (config.models.length === 0) throw new Error('GeminiTranslator needs at least one model');
  }

  get activeModel(): string {
    return this.#config.models[this.#preferred] as string;
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { models, logger } = this.#config;
    const order = [...models.slice(this.#preferred), ...models.slice(0, this.#preferred)];
    let lastError: Error | undefined;

    for (const model of order) {
      try {
        const result = await this.#callModel(model, request);
        const index = models.indexOf(model);
        if (index !== this.#preferred) {
          logger.warn('translation failed over to a healthy model', { from: this.activeModel, to: model });
          this.#preferred = index;
        }
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!isRetryable(lastError)) throw lastError;
      }
    }

    throw lastError ?? new Error('translation failed with no models available');
  }

  async #callModel(model: string, request: TranslationRequest): Promise<TranslationResult> {
    const useThinking = this.#thinkingSupport.get(model) ?? true;
    try {
      return await this.#request(model, request, useThinking);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (useThinking && message.includes('400')) {
        this.#thinkingSupport.set(model, false);
        return this.#request(model, request, false);
      }
      throw error;
    }
  }

  async #request(model: string, request: TranslationRequest, disableThinking: boolean): Promise<TranslationResult> {
    const { apiKey, timeoutMs = 8000 } = this.#config;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const generationConfig: Record<string, unknown> = { temperature: 0, maxOutputTokens: 512 };
    if (disableThinking) generationConfig['thinkingConfig'] = { thinkingBudget: 0 };

    try {
      const response = await fetch(`${API}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt(request) }] },
          contents: [{ role: 'user', parts: [{ text: request.text }] }],
          generationConfig,
        }),
      });

      if (!response.ok) {
        throw new Error(`translate ${response.status} on ${model}: ${(await response.text()).slice(0, 160)}`);
      }

      const body = (await response.json()) as any;
      const text = (body?.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => p?.text ?? '')
        .join('')
        .trim();

      return {
        text: text === '' ? request.text : text,
        inputTokens: body?.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body?.usageMetadata?.candidatesTokenCount ?? 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function isRetryable(error: Error): boolean {
  if (error.name === 'AbortError') return true;
  const match = /translate (\d{3})/.exec(error.message);
  return match ? RETRYABLE.has(Number(match[1])) : false;
}

export function buildSystemPrompt(request: TranslationRequest): string {
  const { from, to, glossary, context } = request;
  const rules = toTranslationRules(glossary, to);

  const lines = [
    'You are a live subtitle translator at a technical software conference.',
    `Translate the user's ${languageName(from)} text into ${languageName(to)}.`,
    '',
    'Rules:',
    '- Output ONLY the translation. No quotes, no notes, no preamble.',
    '- Preserve meaning and register. Keep it concise enough to read as a subtitle.',
    '- Keep code identifiers, CLI flags, product names and acronyms unchanged.',
    `- If the text is already in ${languageName(to)}, return it unchanged.`,
    '- Never answer, explain or continue the text. You only translate.',
  ];

  if (rules.length > 0) {
    lines.push('', 'Required terminology:', ...rules.map((r) => `- ${r}`));
  }
  if (context && context.trim() !== '') {
    lines.push('', 'Preceding transcript (context only, do not translate):', context.slice(-600));
  }
  return lines.join('\n');
}
