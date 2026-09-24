import { languageName } from '../../domain/language.ts';
import { toTranslationRules } from '../../domain/glossary.ts';
import type { TranslationRequest, TranslationResult, TranslatorPort } from '../../application/ports/translator.ts';
import type { LoggerPort } from '../../application/ports/system.ts';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiTranslatorConfig {
  apiKey: string;
  model: string;
  logger: LoggerPort;
  timeoutMs?: number;
}

/**
 * Segment-level translation over the standard generateContent endpoint.
 *
 * Only *final* segments reach here, so we translate each span of speech exactly
 * once. Thinking is disabled outright: a subtitle that arrives after the
 * speaker has moved on is worse than a slightly plainer subtitle.
 */
export class GeminiTranslator implements TranslatorPort {
  readonly name = 'gemini-flash';
  readonly #config: GeminiTranslatorConfig;

  constructor(config: GeminiTranslatorConfig) {
    this.#config = config;
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { apiKey, model, timeoutMs = 8000 } = this.#config;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${API}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt(request) }] },
          contents: [{ role: 'user', parts: [{ text: request.text }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 512,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`translate ${response.status}: ${(await response.text()).slice(0, 200)}`);
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

export function buildSystemPrompt(request: TranslationRequest): string {
  const { from, to, glossary, context } = request;
  const rules = toTranslationRules(glossary, to);

  const lines = [
    `You are a live subtitle translator at a technical software conference.`,
    `Translate the user's ${languageName(from)} text into ${languageName(to)}.`,
    ``,
    `Rules:`,
    `- Output ONLY the translation. No quotes, no notes, no preamble.`,
    `- Preserve meaning and register. Keep it concise enough to read as a subtitle.`,
    `- Keep code identifiers, CLI flags, product names and acronyms unchanged.`,
    `- If the text is already in ${languageName(to)}, return it unchanged.`,
    `- Never answer, explain or continue the text. You only translate.`,
  ];

  if (rules.length > 0) {
    lines.push(``, `Required terminology:`, ...rules.map((r) => `- ${r}`));
  }
  if (context && context.trim() !== '') {
    // Context disambiguates pronouns and topic across segment boundaries.
    lines.push(``, `Preceding transcript (context only — do not translate this):`, context.slice(-600));
  }
  return lines.join('\n');
}
