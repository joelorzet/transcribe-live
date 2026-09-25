import WebSocket from 'ws';
import type { LanguageCode } from '@shared/language/language';
import { isLanguageCode } from '@shared/language/language';
import type { TranscriptionMode } from '@modules/transcription/application/ports/transcription-engine.port';
import type { LoggerPort } from '@shared/ports/system.port';

const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export interface LiveConnectionOptions {
  apiKey: string;
  model: string;
  languageCodes: string[];
  vocabulary: string[];
  mode: TranscriptionMode;
  silenceDurationMs: number;
  logger: LoggerPort;
  onInterim: (text: string, language?: LanguageCode) => void;
  onFinal: (text: string, language?: LanguageCode) => void;
  onGoAway: (msLeft: number) => void;
  onClosed: (code: number, reason: string) => void;
  onError: (error: Error) => void;
}

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

      let settled = false;
      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const failFast = (error: Error) => {
        if (settled) {
          this.#opts.onError(error);
          return;
        }
        settled = true;
        reject(error);
      };

      ws.on('open', () => ws.send(JSON.stringify({ setup: this.#buildSetup(model) })));

      ws.on('message', (data: WebSocket.RawData) => {
        let message: Record<string, any>;
        try {
          message = JSON.parse(decodeFrame(data));
        } catch {
          return;
        }
        if (message['setupComplete'] !== undefined) {
          this.#ready = true;
          logger.debug('live connection ready', { model });
          succeed();
          return;
        }
        this.#handle(message);
      });

      ws.on('error', (error: Error) => failFast(error));

      ws.on('close', (code: number, reason: Buffer) => {
        const wasReady = this.#ready;
        this.#ready = false;
        const text = reason.toString('utf8');
        // A connection we retired during a rotation closed because we asked it
        // to. Reporting that as an engine error marked healthy talks as broken.
        if (this.#closing) {
          succeed();
          return;
        }
        failFast(new Error(`closed before ready: ${code} ${text}`));
        if (!this.#closing && wasReady) this.#opts.onClosed(code, text);
      });
    });
  }

  #buildSetup(model: string): Record<string, unknown> {
    const { languageCodes, vocabulary, mode } = this.#opts;
    const inputAudioTranscription: Record<string, unknown> = { mode };
    if (languageCodes.length > 0) inputAudioTranscription['languageCodes'] = languageCodes;
    if (vocabulary.length > 0) inputAudioTranscription['customVocabulary'] = vocabulary;

    const setup: Record<string, unknown> = {
      model: model.startsWith('models/') ? model : `models/${model}`,
      generationConfig: { responseModalities: ['TEXT'] },
      inputAudioTranscription,
    };

    if (this.#opts.silenceDurationMs > 0) {
      setup['realtimeInputConfig'] = {
        automaticActivityDetection: { silenceDurationMs: this.#opts.silenceDurationMs },
      };
    }

    return setup;
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

    const parts = content['modelTurn']?.parts;
    if (Array.isArray(parts)) {
      const text = parts.map((p: any) => p?.text ?? '').join('').trim();
      if (text !== '') this.#opts.onFinal(text);
    }
  }

  write(pcm: Buffer): boolean {
    if (!this.ready || !this.#ws) return false;
    this.#ws.send(
      JSON.stringify({
        realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
      }),
    );
    return true;
  }

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

function decodeFrame(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

function normaliseLanguage(code: unknown): LanguageCode | undefined {
  if (typeof code !== 'string') return undefined;
  const short = code.slice(0, 2).toLowerCase();
  return isLanguageCode(short) ? short : undefined;
}
