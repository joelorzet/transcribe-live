import WebSocket from 'ws';
import { basename } from 'node:path';
import { readWav, assertLiveApiFormat } from '@shared/audio/wav';

const API = process.env['API_URL'] ?? 'http://localhost:8787';
const WS = API.replace(/^http/, 'ws');
const CHUNK_MS = 100;
const CHUNK_BYTES = (16000 * 2 * CHUNK_MS) / 1000;

const COLORS = ['\x1b[36m', '\x1b[35m', '\x1b[33m', '\x1b[34m', '\x1b[32m'];
const RESET = '\x1b[0m';
const DIM = '\x1b[90m';

interface Track {
  file: string;
  title: string;
  sourceLanguage: string;
  targetLanguages: string;
}

function parseTracks(argv: string[]): Track[] {
  const files = argv.length > 0 ? argv : ['samples/talk-es.wav', 'samples/talk-es-ai.wav', 'samples/talk-en.wav'];
  return files.map((file) => {
    const name = basename(file, '.wav');
    const isEnglish = name.endsWith('-en') || name.includes('talk-en');
    return {
      file,
      title: name.replace(/^talk-/, '').replace(/-/g, ' '),
      sourceLanguage: isEnglish ? 'en' : 'es',
      targetLanguages: isEnglish ? 'es,pt' : 'en,pt',
    };
  });
}

async function createSession(track: Track, index: number): Promise<string> {
  const response = await fetch(`${API}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: `track-${index + 1}`,
      title: `Track ${index + 1} - ${track.title}`,
      sourceLanguage: track.sourceLanguage,
      targetLanguages: track.targetLanguages,
      glossaryId: 'nerdearla',
    }),
  });
  if (!response.ok) throw new Error(`create session failed: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { id: string };
  return body.id;
}

function streamAudio(sessionId: string, file: string): Promise<void> {
  const audio = readWav(file);
  assertLiveApiFormat(audio, file);

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS}/ws/ingest?sessionId=${encodeURIComponent(sessionId)}`);
    socket.on('error', reject);
    socket.on('close', (code, reason) => {
      if (code >= 4000) reject(new Error(`ingest rejected: ${code} ${reason.toString()}`));
    });
    socket.on('open', async () => {
      for (let offset = 0; offset < audio.pcm.byteLength; offset += CHUNK_BYTES) {
        if (socket.readyState !== WebSocket.OPEN) break;
        socket.send(audio.pcm.subarray(offset, offset + CHUNK_BYTES), { binary: true });
        await new Promise((r) => setTimeout(r, CHUNK_MS));
      }
      await new Promise((r) => setTimeout(r, 4000));
      socket.close(1000);
      resolve();
    });
  });
}

function watchControlRoom(labels: Map<string, string>, firstCaption: Map<string, number>): WebSocket {
  const socket = new WebSocket(`${WS}/ws/view`);
  const startedAt = Date.now();
  socket.on('message', (raw: Buffer) => {
    let event: any;
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    const id = event.sessionId ?? event.session?.id ?? '';
    const label = labels.get(id) ?? id;
    const color = COLORS[[...labels.keys()].indexOf(id) % COLORS.length] ?? '';

    if (event.type === 'segment.interim') {
      if (!firstCaption.has(id)) firstCaption.set(id, Date.now() - startedAt);
      console.log(`${color}[${label}]${RESET} ${DIM}~ ${String(event.text).slice(-70)}${RESET}`);
    } else if (event.type === 'segment.final') {
      if (!firstCaption.has(id)) firstCaption.set(id, Date.now() - startedAt);
      console.log(`${color}[${label}]${RESET} ${event.segment.text} ${DIM}(+${event.segment.latencyMs}ms)${RESET}`);
    } else if (event.type === 'segment.translated') {
      console.log(`${color}[${label}]${RESET} ${DIM}-> [${event.translation.language}]${RESET} ${event.translation.text}`);
    }
  });
  return socket;
}

async function main(): Promise<void> {
  const tracks = parseTracks(process.argv.slice(2));
  console.log(`\nreplaying ${tracks.length} tracks concurrently against ${API}\n`);

  const labels = new Map<string, string>();
  const ids: string[] = [];
  for (const [index, track] of tracks.entries()) {
    const id = await createSession(track, index);
    ids.push(id);
    labels.set(id, `${track.sourceLanguage}->${track.targetLanguages} ${track.title}`.slice(0, 28));
  }

  const firstCaption = new Map<string, number>();
  const viewer = watchControlRoom(labels, firstCaption);
  await new Promise((r) => setTimeout(r, 500));

  const started = Date.now();
  await Promise.all(tracks.map((track, index) => streamAudio(ids[index] as string, track.file)));
  const wall = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n${DIM}all tracks finished in ${wall}s${RESET}\n`);
  const summary = (await (await fetch(`${API}/api/sessions`)).json()) as any;
  const totalOutputs = summary.sessions.reduce((sum: number, s: any) => sum + s.outputs.length, 0);
  console.log(
    `  ${summary.sessions.length} inputs, ${totalOutputs} language outputs, ` +
      `engine ${summary.engine}, capacity ${summary.capacity}\n`,
  );
  for (const session of summary.sessions) {
    console.log(
      `  ${session.id.padEnd(9)} ${String(session.segments).padStart(3)} segs  ` +
        `${String(session.words).padStart(4)} words  p50 ${String(session.latency.p50).padStart(5)}ms  ` +
        `p95 ${String(session.latency.p95).padStart(5)}ms  first ${String(firstCaption.get(session.id) ?? 0).padStart(5)}ms  ` +
        `$${session.cost.usd.toFixed(4)}  rot ${session.rotations}`,
    );
    for (const output of session.outputs) {
      console.log(
        `    ${DIM}-> ${output.language}  ${String(output.words).padStart(4)} words  ` +
          `p50 ${String(output.latency.p50).padStart(5)}ms  $${output.costUsd.toFixed(4)}${RESET}`,
      );
    }
  }

  for (const id of ids) await fetch(`${API}/api/sessions/${id}/stop`, { method: 'POST' });
  viewer.close();
  process.exit(0);
}

void main();
