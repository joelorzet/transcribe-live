import { loadConfig } from '@shared/config/env';
import { ConsoleLogger } from '@shared/logging/console-logger';
import { GeminiTranscriptionEngine } from '@modules/transcription/infrastructure/gemini/gemini-transcription.adapter';
import { readWav, assertLiveApiFormat } from '@shared/audio/wav';

async function main(): Promise<void> {
  const path = process.argv[2] ?? 'samples/talk-es.wav';
  const config = loadConfig();
  if (config.apiKey === '') throw new Error('GEMINI_API_KEY is not set');

  const audio = readWav(path);
  assertLiveApiFormat(audio, path);
  console.log(`streaming ${path}: ${(audio.durationMs / 1000).toFixed(1)}s @ ${config.transcribeModel}\n`);

  const logger = new ConsoleLogger('debug');
  const engine = new GeminiTranscriptionEngine({
    apiKey: config.apiKey,
    model: config.transcribeModel,
    rotateSeconds: config.rotateSeconds,
    silenceDurationMs: config.silenceDurationMs,
    logger,
  });

  let lastAudioAt = Date.now();
  const latencies: number[] = [];

  const stream = await engine.open({
    sessionId: 'smoke',
    sourceLanguage: 'es',
    vocabulary: ['Nerdearla', 'Kubernetes', 'OpenTelemetry', 'gRPC', 'Prometheus', 'observabilidad'],
    mode: config.transcriptionMode,
    onInterim: ({ text }) => process.stdout.write(`\x1b[90m  ~ ${text}\x1b[0m\n`),
    onFinal: ({ text, language }) => {
      const ms = Date.now() - lastAudioAt;
      latencies.push(ms);
      console.log(`\x1b[32m  = [${language ?? '??'}] ${text}\x1b[0m \x1b[90m(+${ms}ms)\x1b[0m`);
    },
    onError: (error) => console.error('ENGINE ERROR:', error.message),
  });

  const CHUNK = 3200;
  for (let offset = 0; offset < audio.pcm.byteLength; offset += CHUNK) {
    stream.write(audio.pcm.subarray(offset, offset + CHUNK));
    lastAudioAt = Date.now();
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log('\naudio sent; waiting for final transcripts...');
  await new Promise((r) => setTimeout(r, 6000));
  await stream.close();

  const avg = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  console.log(`\nfinals: ${latencies.length}  avg latency: ${avg}ms`);
  process.exit(0);
}

void main();
