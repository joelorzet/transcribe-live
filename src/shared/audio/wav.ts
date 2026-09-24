import { readFileSync } from 'node:fs';

export interface WavAudio {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
}

export function readWav(path: string): WavAudio {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a RIFF/WAVE file`);
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let pcm: Buffer | undefined;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === 'data') {
      pcm = buffer.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }

  if (!pcm || sampleRate === 0) throw new Error(`${path} has no readable PCM data`);
  const bytesPerSample = (bitsPerSample / 8) * channels;
  return {
    pcm,
    sampleRate,
    channels,
    bitsPerSample,
    durationMs: (pcm.byteLength / bytesPerSample / sampleRate) * 1000,
  };
}

export function assertLiveApiFormat(audio: WavAudio, path: string): void {
  if (audio.sampleRate !== 16000 || audio.channels !== 1 || audio.bitsPerSample !== 16) {
    throw new Error(
      `${path} must be 16 kHz mono 16-bit PCM (got ${audio.sampleRate} Hz, ` +
        `${audio.channels}ch, ${audio.bitsPerSample}-bit). Convert with:\n` +
        `  ffmpeg -i "${path}" -ar 16000 -ac 1 -c:a pcm_s16le out.wav`,
    );
  }
}
