import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable } from 'node:stream';

export const PCM_SAMPLE_RATE = 16000;
export const PCM_CHANNELS = 1;

export interface MediaStreamOptions {
  source: string;
  realtime?: boolean;
  startSeconds?: number;
  durationSeconds?: number;
  ffmpegPath?: string;
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

export function openPcmStream(options: MediaStreamOptions): PcmStream {
  const { source, realtime = true, startSeconds, durationSeconds, ffmpegPath = 'ffmpeg' } = options;

  const args: string[] = ['-hide_banner', '-loglevel', 'error'];
  if (startSeconds !== undefined) args.push('-ss', String(startSeconds));
  if (realtime) args.push('-re');
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
