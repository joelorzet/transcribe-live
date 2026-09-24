import { toTranslationRules } from '@modules/glossary/domain/glossary.entity';
import type { TranslationRequest, TranslationResult, TranslatorPort } from '@modules/translation/application/ports/translator.port';

const DICTIONARY: Record<string, string> = {
  'Buenos días a todos y bienvenidos a Nerdearla.': 'Good morning everyone and welcome to Nerdearla.',
  'Hoy vamos a hablar de observabilidad en Kubernetes a escala.':
    'Today we are going to talk about observability in Kubernetes at scale.',
  'El problema no es recolectar métricas, el problema es el costo de almacenarlas.':
    'The problem is not collecting metrics, the problem is the cost of storing them.',
  'Migramos de Prometheus a un backend de larga duración con OpenTelemetry.':
    'We migrated from Prometheus to a long-term backend with OpenTelemetry.',
  'La latencia de las consultas bajó de ocho segundos a menos de doscientos milisegundos.':
    'Query latency dropped from eight seconds to under two hundred milliseconds.',
  'Usamos gRPC para el transporte y comprimimos con zstd.':
    'We use gRPC for transport and compress with zstd.',
  'El resultado fue una reducción del sesenta por ciento en la factura mensual.':
    'The result was a sixty percent reduction in the monthly bill.',
  'Todo el código está disponible con licencia Apache dos punto cero.':
    'All the code is available under the Apache 2.0 license.',
  'Muchas gracias, y si tienen preguntas estoy en el pasillo.':
    'Thank you very much, and if you have questions I am out in the hallway.',
};

export class MockTranslator implements TranslatorPort {
  readonly name = 'mock';
  readonly #delayMs: number;

  constructor(delayMs = 120) {
    this.#delayMs = delayMs;
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    await new Promise((resolve) => setTimeout(resolve, this.#delayMs));

    const known = DICTIONARY[request.text.trim()];
    let text = known ?? `[${request.to}] ${request.text}`;

    for (const rule of toTranslationRules(request.glossary, request.to)) {
      const match = /^"(.+)" -> "(.+)"$/.exec(rule);
      if (match?.[1] && match[2]) text = text.split(match[1]).join(match[2]);
    }

    return {
      text,
      inputTokens: Math.ceil(request.text.length / 4),
      outputTokens: Math.ceil(text.length / 4),
    };
  }
}
