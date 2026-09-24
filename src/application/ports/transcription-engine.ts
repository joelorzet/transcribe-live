import type { SourceLanguage, LanguageCode } from '../../domain/language.ts';

/** Verbatim keeps every word; smart removes fillers and punctuates. */
export type TranscriptionMode = 'VERBATIM' | 'SMART';

export interface TranscriptionResult {
  text: string;
  /** Language the model actually detected, when it reports one. */
  language?: LanguageCode;
}

export interface TranscriptionStreamOptions {
  sessionId: string;
  sourceLanguage: SourceLanguage;
  /** Terms to bias recognition toward (from the session's glossary). */
  vocabulary: string[];
  mode: TranscriptionMode;
  /** Fast, speculative text. Replaces the previous interim. */
  onInterim: (result: TranscriptionResult) => void;
  /** Authoritative text for a finished chunk of speech. */
  onFinal: (result: TranscriptionResult) => void;
  /** Fired when the adapter transparently reconnected an upstream stream. */
  onRotate?: () => void;
  onError: (error: Error) => void;
}

/** A live, write-only audio sink that emits transcripts through callbacks. */
export interface TranscriptionStream {
  /** Push 16-bit mono little-endian PCM at 16 kHz. */
  write(pcm: Buffer): void;
  close(): Promise<void>;
  readonly closed: boolean;
}

/**
 * A speech-to-text backend. Implemented by the Gemini Live adapter and by a
 * deterministic mock used for tests and for demoing without an API key.
 */
export interface TranscriptionEnginePort {
  readonly name: string;
  open(options: TranscriptionStreamOptions): Promise<TranscriptionStream>;
}
