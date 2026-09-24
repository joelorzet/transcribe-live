import WebSocket from 'ws';
import { basename } from 'node:path';
import { isYouTubeUrl, openPcmStream, resolveMediaUrl } from '@shared/media/media-source';

const API = process.env['API_URL'] ?? 'http://localhost:8787';
const WS_URL = API.replace(/^http/, 'ws');

interface Options {
  source: string;
  title: string;
  sourceLanguage: string;
  targetLanguages: string;
  glossaryId: string;
  id?: string;
  startSeconds?: number;
  durationSeconds?: number;
  realtime: boolean;
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, 'true');
      }
    } else {
      positional.push(arg);
    }
  }

  const source = positional[0];
  if (!source) {
    console.error(`Usage: npm run ingest -- <file|url|youtube-url> [options]

Options:
  --title <name>        Track name shown in the control room
  --lang <code>         Spoken language: es, en, pt or auto   (default auto)
  --targets <codes>     Subtitle languages, comma separated    (default en)
  --glossary <id>       Glossary id                            (default nerdearla)
  --id <id>             Explicit track id
  --start <seconds>     Skip ahead before streaming
  --duration <seconds>  Stop after this many seconds
  --fast                Ingest as fast as possible instead of real time

Examples:
  npm run ingest -- "https://www.youtube.com/watch?v=..." --title "Nerdearla 2025 Keynote" --lang es
  npm run ingest -- talk.mp4 --title "Track A" --duration 120`);
    process.exit(1);
  }

  const label = isYouTubeUrl(source) ? 'YouTube talk' : basename(source).replace(/\.[^.]+$/, '');

  return {
    source,
    title: flags.get('title') ?? label,
    sourceLanguage: flags.get('lang') ?? 'auto',
    targetLanguages: flags.get('targets') ?? 'en',
    glossaryId: flags.get('glossary') ?? 'nerdearla',
    id: flags.get('id'),
    startSeconds: flags.has('start') ? Number(flags.get('start')) : undefined,
    durationSeconds: flags.has('duration') ? Number(flags.get('duration')) : undefined,
    realtime: !flags.has('fast'),
  };
}

async function createTrack(options: Options): Promise<string> {
  const response = await fetch(`${API}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: options.id,
      title: options.title,
      sourceLanguage: options.sourceLanguage,
      targetLanguages: options.targetLanguages,
      glossaryId: options.glossaryId,
    }),
  });

  if (!response.ok) {
    throw new Error(`could not create track: ${response.status} ${await response.text()}`);
  }

  const track = (await response.json()) as { id: string };
  return track.id;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (isYouTubeUrl(options.source)) console.log('resolving audio stream with yt-dlp...');
  const mediaUrl = await resolveMediaUrl(options.source);

  const trackId = await createTrack(options);
  console.log(`track ${trackId} created: ${options.title}`);
  console.log(`captions: http://localhost:3000/session/${trackId}\n`);

  const media = openPcmStream({
    source: mediaUrl,
    realtime: options.realtime,
    startSeconds: options.startSeconds,
    durationSeconds: options.durationSeconds,
  });

  media.process.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim();
    if (text) console.error(`ffmpeg: ${text.slice(0, 200)}`);
  });

  const socket = new WebSocket(`${WS_URL}/ws/ingest?sessionId=${encodeURIComponent(trackId)}`);
  let bytes = 0;

  const finish = async (reason: string): Promise<void> => {
    media.stop();
    if (socket.readyState === WebSocket.OPEN) socket.close(1000);
    const seconds = (bytes / (16000 * 2)).toFixed(1);
    console.log(`\n${reason}. streamed ${seconds}s of audio.`);
    await new Promise((r) => setTimeout(r, 1500));
    process.exit(0);
  };

  socket.on('open', () => {
    console.log('streaming audio... press Ctrl+C to stop\n');
    let lastReport = 0;
    media.pcm.on('data', (chunk: Buffer) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(chunk, { binary: true });
      bytes += chunk.byteLength;
      const seconds = bytes / (16000 * 2);
      if (seconds - lastReport >= 5) {
        lastReport = seconds;
        process.stdout.write(`\r  ${seconds.toFixed(0)}s ingested`);
      }
    });
    media.pcm.on('end', () => void finish('media ended'));
  });

  socket.on('close', (code, reason) => {
    if (code >= 4000) {
      console.error(`\ningest rejected: ${code} ${reason.toString('utf8')}`);
      media.stop();
      process.exit(1);
    }
  });

  socket.on('error', (error: Error) => {
    console.error(`\nsocket error: ${error.message}`);
    media.stop();
    process.exit(1);
  });

  process.on('SIGINT', () => void finish('stopped'));
}

void main();
