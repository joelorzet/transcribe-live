import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable } from 'node:stream';

export const PCM_SAMPLE_RATE = 16000;
export const PCM_CHANNELS = 1;
/** How much of a talk to pull when no duration is given: three hours. */
const DEFAULT_SECTION_SECONDS = 3 * 60 * 60;

export interface MediaStreamOptions {
  source: string;
  realtime?: boolean;
  startSeconds?: number;
  durationSeconds?: number;
  ffmpegPath?: string;
  listen?: boolean;
  listenTimeoutSeconds?: number;
}

export const STREAM_PROTOCOLS = ['rtmp:', 'rtmps:', 'udp:', 'tcp:'] as const;

export function isStreamUrl(source: string): boolean {
  try {
    return (STREAM_PROTOCOLS as readonly string[]).includes(new URL(source).protocol);
  } catch {
    return false;
  }
}

export function buildRtmpListenUrl(port: number, trackId: string): string {
  return `rtmp://0.0.0.0:${port}/live/${trackId}`;
}

export function buildRtmpPushUrl(host: string, port: number, trackId: string): string {
  return `rtmp://${host}:${port}/live/${trackId}`;
}

export function isYouTubeUrl(source: string): boolean {
  return /(^|\.)(youtube\.com|youtu\.be)/i.test(safeHost(source));
}

function safeHost(source: string): string {
  try {
    return new URL(source).hostname;
  } catch {
    return '';
  }
}

export async function resolveMediaUrl(source: string, ytDlpPath = 'yt-dlp'): Promise<string> {
  if (!isYouTubeUrl(source)) return source;

  return new Promise((resolve, reject) => {
    const child = spawn(ytDlpPath, ['-f', 'bestaudio', '--no-playlist', '-g', source]);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    child.on('error', (error) =>
      reject(new Error(`yt-dlp is not installed or failed to run: ${error.message}`)),
    );
    child.on('close', (code) => {
      const url = out.trim().split('\n')[0];
      if (code === 0 && url) resolve(url);
      else reject(new Error(`yt-dlp failed (${code}): ${err.trim().slice(0, 300)}`));
    });
  });
}

export interface PcmStream {
  pcm: Readable;
  process: ChildProcessWithoutNullStreams;
  stop: () => void;
}

/**
 * Streams a YouTube talk by letting yt-dlp fetch it and piping the bytes into
 * ffmpeg. Handing ffmpeg the resolved media URL instead gets a 403: those URLs
 * are signed for the client that asked for them.
 */
export function openYouTubePcmStream(options: MediaStreamOptions & { ytDlpPath?: string }): PcmStream {
  const { source, startSeconds, durationSeconds, ffmpegPath = 'ffmpeg', ytDlpPath = 'yt-dlp' } = options;

  const ytArgs = ['-f', 'bestaudio', '--no-playlist', '--quiet', '--no-warnings'];
  if (startSeconds !== undefined || durationSeconds !== undefined) {
    const from = Math.max(0, Math.floor(startSeconds ?? 0));
    // The range has to be bounded. An open ended section is not streamable, so
    // ffmpeg reading it from a pipe reports invalid data and gives up.
    const to = from + Math.ceil(durationSeconds ?? DEFAULT_SECTION_SECONDS);
    ytArgs.push('--download-sections', `*${from}-${to}`);
  }
  ytArgs.push('-o', '-', source);

  const fetcher = spawn(ytDlpPath, ytArgs);
  const child = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-re',
    '-i', 'pipe:0',
    '-vn',
    '-ac', String(PCM_CHANNELS),
    '-ar', String(PCM_SAMPLE_RATE),
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    'pipe:1',
  ]);

  fetcher.stdout.pipe(child.stdin);
  fetcher.stdin.end();
  fetcher.on('error', () => child.kill('SIGKILL'));
  child.stdin.on('error', () => undefined);

  return {
    pcm: child.stdout,
    process: child,
    stop: () => {
      fetcher.kill('SIGKILL');
      child.kill('SIGKILL');
    },
  };
}

export function openPcmStream(options: MediaStreamOptions): PcmStream {
  const { source, realtime = true, startSeconds, durationSeconds, ffmpegPath = 'ffmpeg' } = options;

  const args: string[] = ['-hide_banner', '-loglevel', 'error'];
  if (options.listen) {
    args.push('-listen', '1', '-timeout', String(options.listenTimeoutSeconds ?? 600));
  }
  if (startSeconds !== undefined) args.push('-ss', String(startSeconds));
  // A live push already arrives in real time; -re would double-pace it.
  if (realtime && !options.listen) args.push('-re');
  args.push('-i', source);
  if (durationSeconds !== undefined) args.push('-t', String(durationSeconds));
  args.push(
    '-vn',
    '-ac', String(PCM_CHANNELS),
    '-ar', String(PCM_SAMPLE_RATE),
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    'pipe:1',
  );

  const child = spawn(ffmpegPath, args);
  return {
    pcm: child.stdout,
    process: child,
    stop: () => {
      child.kill('SIGKILL');
    },
  };
}
