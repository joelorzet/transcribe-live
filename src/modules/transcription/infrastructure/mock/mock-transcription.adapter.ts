import { pcmBytesToMs } from '@modules/sessions/domain/session.entity';
import type {
  TranscriptionEnginePort,
  TranscriptionStream,
  TranscriptionStreamOptions,
} from '@modules/transcription/application/ports/transcription-engine.port';

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

const MS_PER_SENTENCE = 3500;
const INTERIM_EVERY_MS = 600;

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
