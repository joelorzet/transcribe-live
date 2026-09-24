import WebSocket from 'ws';
import type { LanguageCode } from '../../domain/language.ts';
import { isLanguageCode } from '../../domain/language.ts';
import type { TranscriptionMode } from '../../application/ports/transcription-engine.ts';
import type { LoggerPort } from '../../application/ports/system.ts';

const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export interface LiveConnectionOptions {
  apiKey: string;
  model: string;
  /** BCP-47 hints; empty array means "detect automatically". */
  languageCodes: string[];
  vocabulary: string[];
  mode: TranscriptionMode;
  logger: LoggerPort;
  onInterim: (text: string, language?: LanguageCode) => void;
  onFinal: (text: string, language?: LanguageCode) => void;
  /** The server is about to close this connection; rotate now. */
  onGoAway: (msLeft: number) => void;
  onClosed: (code: number, reason: string) => void;
  onError: (error: Error) => void;
}

/**
 * One upstream WebSocket to the Gemini Live API.
 *
 * We speak the wire protocol directly rather than through @google/genai: on the
 * Gemini API path the SDK's converter discards the entire
 * `inputAudioTranscription` config (and throws on `languageCodes`), which would
 * cost us `customVocabulary` — the single biggest lever on technical-term
 * accuracy. Raw frames also drop a dependency from the deploy.
 */
export class LiveConnection {
  readonly #opts: LiveConnectionOptions;
  #ws: WebSocket | undefined;
  #ready = false;
  #closing = false;

  constructor(options: LiveConnectionOptions) {
    this.#opts = options;
  }

  get ready(): boolean {
    return this.#ready && this.#ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    const { apiKey, model, logger } = this.#opts;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`);
      this.#ws = ws;
      ws.binaryType = 'arraybuffer';

      const failFast = (error: Error) => {
        if (!this.#ready) reject(error);
        else this.#opts.onError(error);
      };

      ws.on('open', () => ws.send(JSON.stringify({ setup: this.#buildSetup(model) })));

      ws.on('message', (data: WebSocket.RawData) => {
        let message: Record<string, any>;
        try {
          message = JSON.parse(data.toString('utf8'));
        } catch {
          return;
        }
        if (message['setupComplete'] !== undefined) {
          this.#ready = true;
          logger.debug('live connection ready', { model });
          resolve();
          return;
        }
        this.#handle(message);
      });

      ws.on('error', (error: Error) => failFast(error));

      ws.on('close', (code: number, reason: Buffer) => {
        this.#ready = false;
        const text = reason.toString('utf8');
        if (!this.#closing) this.#opts.onClosed(code, text);
        if (!this.#ready) failFast(new Error(`closed before ready: ${code} ${text}`));
      });
    });
  }

  #buildSetup(model: string): Record<string, unknown> {
    const { languageCodes, vocabulary, mode } = this.#opts;
    const inputAudioTranscription: Record<string, unknown> = { mode };
    // An empty array means auto-detect; sending the key at all pins the model.
    if (languageCodes.length > 0) inputAudioTranscription['languageCodes'] = languageCodes;
    if (vocabulary.length > 0) inputAudioTranscription['customVocabulary'] = vocabulary;

    return {
      model: model.startsWith('models/') ? model : `models/${model}`,
      generationConfig: { responseModalities: ['TEXT'] },
      inputAudioTranscription,
    };
  }

  #handle(message: Record<string, any>): void {
    if (message['goAway']) {
      const raw = String(message['goAway']?.timeLeft ?? '0s');
      const seconds = Number.parseFloat(raw.replace('s', '')) || 0;
      this.#opts.onGoAway(seconds * 1000);
      return;
    }

    const content = message['serverContent'];
    if (!content) return;

    const interim = content['interimInputTranscription'];
    if (interim?.text) {
      this.#opts.onInterim(interim.text, normaliseLanguage(interim.languageCode));
      return;
    }

    const final = content['inputTranscription'];
    if (final?.text) {
      this.#opts.onFinal(final.text, normaliseLanguage(final.languageCode));
      return;
    }

    // Fallback: some model variants return transcripts as plain model output.
    const parts = content['modelTurn']?.parts;
    if (Array.isArray(parts)) {
      const text = parts.map((p: any) => p?.text ?? '').join('').trim();
      if (text !== '') this.#opts.onFinal(text);
    }
  }

  /** Send 16 kHz mono little-endian PCM. */
  write(pcm: Buffer): boolean {
    if (!this.ready || !this.#ws) return false;
    this.#ws.send(
      JSON.stringify({
        realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
      }),
    );
    return true;
  }

  /** Tell the server no more audio is coming so it flushes a last transcript. */
  endAudioStream(): void {
    if (!this.ready || !this.#ws) return;
    this.#ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
  }

  async close(drainMs = 0): Promise<void> {
    this.#closing = true;
    if (!this.#ws) return;
    if (this.#ws.readyState === WebSocket.OPEN) {
      this.endAudioStream();
      if (drainMs > 0) await new Promise((r) => setTimeout(r, drainMs));
      this.#ws.close(1000, 'client closing');
    }
    this.#ws = undefined;
    this.#ready = false;
  }
}

function normaliseLanguage(code: unknown): LanguageCode | undefined {
  if (typeof code !== 'string') return undefined;
  const short = code.slice(0, 2).toLowerCase();
  return isLanguageCode(short) ? short : undefined;
}
