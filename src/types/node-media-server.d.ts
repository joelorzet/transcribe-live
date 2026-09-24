declare module 'node-media-server' {
  interface NmsSession {
    id: string;
    ip: string;
    streamApp: string;
    streamName: string;
    streamPath: string;
    close(): void;
  }

  interface NmsConfig {
    rtmp?: { port?: number };
    http?: { port?: number };
    logger?: { level?: string };
    store?: { path?: string };
  }

  class NodeMediaServer {
    constructor(config: NmsConfig, configPath?: string);
    run(): void;
    stop(): void;
    on(event: 'prePublish' | 'postPublish' | 'donePublish', listener: (session: NmsSession) => void): void;
  }

  export = NodeMediaServer;
}
