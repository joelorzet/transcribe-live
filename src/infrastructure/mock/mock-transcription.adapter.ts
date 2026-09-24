import { pcmBytesToMs } from '../../domain/session.ts';
import type {
  TranscriptionEnginePort,
  TranscriptionStream,
  TranscriptionStreamOptions,
} from '../../application/ports/transcription-engine.ts';

/** A plausible slice of a Spanish-language platform-engineering talk. */
const SCRIPT = [
  'Buenos días a todos y bienvenidos a Nerdearla.',
  'Hoy vamos a hablar de observabilidad en Kubernetes a escala.',
  'El problema no es recolectar métricas, el problema es el costo de almacenarlas.',
  'Migramos de Prometheus a un backend de larga duración con OpenTelemetry.',
  'La latencia de las consultas bajó de ocho segundos a menos de doscientos milisegundos.',
  'Usamos gRPC para el transporte y comprimimos con zstd.',
  'El resultado fue una reducción del sesenta por ciento en la factura mensual.',
  'Todo el código está disponible con licencia Apache dos punto cero.',
  'Muchas gracias, y si tienen preguntas estoy en el pasillo.',
];

/** Audio consumed before the mock commits a sentence. */
const MS_PER_SENTENCE = 3500;
const INTERIM_EVERY_MS = 600;

/**
 * Deterministic stand-in for the speech API.
 *
 * It exists so the full pipeline — ingest, fan-out, translation, export, the
 * whole UI — can be run and tested with no API key, no network and no cost.
 * It consumes audio at the real wall-clock rate, so latency figures and the
 * two-concurrent-session requirement can be demonstrated honestly.
 */
export class MockTranscriptionEngine implements TranscriptionEnginePort {
  readonly name = 'mock';

  async open(options: TranscriptionStreamOptions): Promise<TranscriptionStream> {
    return new MockStream(options);
  }
}

class MockStream implements TranscriptionStream {
  readonly #options: TranscriptionStreamOptions;
  #audioMs = 0;
  #consumedMs = 0;
  #index = 0;
  #lastInterimAt = 0;
  #closed = false;

  constructor(options: TranscriptionStreamOptions) {
    this.#options = options;
  }

  get closed(): boolean {
    return this.#closed;
  }

  write(pcm: Buffer): void {
    if (this.#closed) return;
    this.#audioMs += pcmBytesToMs(pcm.byteLength);

    const sentence = SCRIPT[this.#index % SCRIPT.length] ?? '';
    const elapsed = this.#audioMs - this.#consumedMs;

    if (elapsed >= MS_PER_SENTENCE) {
      this.#consumedMs = this.#audioMs;
      this.#index += 1;
      this.#lastInterimAt = 0;
      this.#options.onFinal({ text: sentence, language: 'es' });
      return;
    }

    if (this.#audioMs - this.#lastInterimAt >= INTERIM_EVERY_MS) {
      this.#lastInterimAt = this.#audioMs;
      const words = sentence.split(' ');
      const take = Math.max(1, Math.round((elapsed / MS_PER_SENTENCE) * words.length));
      this.#options.onInterim({ text: words.slice(0, take).join(' '), language: 'es' });
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}
