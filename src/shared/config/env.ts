import { readFileSync, existsSync } from 'node:fs';
import type { TranscriptionMode } from '@modules/transcription/application/ports/transcription-engine.port';
import type { LogLevel } from '@shared/ports/system.port';
import type { CostRates } from '@modules/sessions/application/cost-estimator.service';

export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(key: string, fallback: string): string {
  const raw = process.env[key]?.trim();
  return raw === undefined || raw === '' ? fallback : raw;
}

export interface AppConfig {
  logLevel: LogLevel;
  port: number;
  host: string;
  engine: 'gemini' | 'mock';
  apiKey: string;
  transcribeModel: string;
  translateModels: string[];
  transcriptionMode: TranscriptionMode;
  rotateSeconds: number;
  silenceDurationMs: number;
  maxConcurrentSessions: number;
  contextWindow: number;
  costRates: CostRates;
  glossaryDir: string;
}

export function loadConfig(): AppConfig {
  loadDotEnv();
  const apiKey = str('GEMINI_API_KEY', '');
  const requested = str('ENGINE', apiKey === '' ? 'mock' : 'gemini');
  const engine: 'gemini' | 'mock' = requested === 'gemini' && apiKey !== '' ? 'gemini' : 'mock';

  return {
    logLevel: (['debug', 'info', 'warn', 'error'].includes(str('LOG_LEVEL', 'info')) ? str('LOG_LEVEL', 'info') : 'info') as LogLevel,
    port: num('PORT', 8080),
    host: str('HOST', '0.0.0.0'),
    engine,
    apiKey,
    transcribeModel: str('TRANSCRIBE_MODEL', 'gemini-3.5-transcribe-live'),
    translateModels: str('TRANSLATE_MODEL', 'gemini-3.7-flash,gemini-3.5-flash-lite,gemini-3.8-flash')
      .split(',').map((m) => m.trim()).filter(Boolean),
    transcriptionMode: str('TRANSCRIPTION_MODE', 'VERBATIM') === 'SMART' ? 'SMART' : 'VERBATIM',
    rotateSeconds: num('SESSION_ROTATE_SECONDS', 480),
    silenceDurationMs: num('SILENCE_DURATION_MS', 400),
    maxConcurrentSessions: num('MAX_CONCURRENT_SESSIONS', 16),
    contextWindow: num('CONTEXT_WINDOW', 3),
    costRates: {
      audioInputPerMTok: num('COST_AUDIO_INPUT_PER_MTOK', 0.5),
      textInputPerMTok: num('COST_TEXT_INPUT_PER_MTOK', 0.1),
      textOutputPerMTok: num('COST_TEXT_OUTPUT_PER_MTOK', 0.4),
    },
    glossaryDir: str('GLOSSARY_DIR', 'config/glossaries'),
  };
}
