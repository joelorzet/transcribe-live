import type { SourceLanguage, LanguageCode } from '@shared/language/language';

export type TranscriptionMode = 'VERBATIM' | 'SMART';

export interface TranscriptionResult {
  text: string;
  language?: LanguageCode;
}

export interface TranscriptionStreamOptions {
  sessionId: string;
  sourceLanguage: SourceLanguage;
  vocabulary: string[];
  mode: TranscriptionMode;
  silenceDurationMs?: number;
  autoDetectLanguages?: LanguageCode[];
  onInterim: (result: TranscriptionResult) => void;
  onFinal: (result: TranscriptionResult) => void;
  onRotate?: () => void;
  onError: (error: Error) => void;
}

export interface TranscriptionReconfigure {
  sourceLanguage?: SourceLanguage;
  vocabulary?: string[];
}

export interface TranscriptionStream {
  reconfigure(patch: TranscriptionReconfigure): Promise<void>;
  write(pcm: Buffer): void;
  close(): Promise<void>;
  readonly closed: boolean;
}

export interface TranscriptionEnginePort {
  readonly name: string;
  open(options: TranscriptionStreamOptions): Promise<TranscriptionStream>;
}
