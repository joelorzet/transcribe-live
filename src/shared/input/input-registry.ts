export type InputKind = 'pull' | 'rtmp';

export interface InputDescriptor {
  kind: InputKind;
  source: string;
  secondsIngested: number;
  startedAt: number;
  waitingForPublisher: boolean;
  server?: string;
  streamKey?: string;
}

export class InputRegistry {
  readonly #inputs = new Map<string, InputDescriptor>();

  set(trackId: string, descriptor: InputDescriptor): void {
    this.#inputs.set(trackId, descriptor);
  }

  patch(trackId: string, patch: Partial<InputDescriptor>): void {
    const current = this.#inputs.get(trackId);
    if (current) this.#inputs.set(trackId, { ...current, ...patch });
  }

  get(trackId: string): InputDescriptor | undefined {
    return this.#inputs.get(trackId);
  }

  clear(trackId: string): void {
    this.#inputs.delete(trackId);
  }
}
