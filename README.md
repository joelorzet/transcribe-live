# Transcribe Live — core-api

Real-time transcription and translation at scale for conferences.
Built for the [Nerdearla Vibeathon 2026](https://nerdearla26.devpost.com/), 24–25 September 2026.

One audio input becomes many live subtitle streams. A talk in Spanish is captioned in
Spanish and translated into English and Portuguese at the same time, each translation its
own stream that OBS, a phone browser or your own software can subscribe to.

The control room UI lives in a separate repository:
**[transcribe-live-ui](https://github.com/joelorzet/transcribe-live-ui)**.

---

## Quick start

### Docker, both services

```bash
export GEMINI_API_KEY=your-key-here
docker compose up --build
```

Control room on http://localhost:3000, API on http://localhost:8787, RTMP ingest for OBS on
`rtmp://localhost:1935/live`. The UI image is built straight from its repository, so this is
the only clone you need. Serving a room from another machine? Set `RTMP_HOST` and
`PUBLIC_API_URL` to its LAN address so encoders and phones can reach it.

### From source

Requires **Node 20+**, **ffmpeg**, and a **Gemini API key**.

```bash
# macOS
brew install ffmpeg yt-dlp

git clone https://github.com/joelorzet/transcribe-live
cd transcribe-live
npm install
cp .env.example .env        # then add your GEMINI_API_KEY
npm run build
npm start                   # http://localhost:8787
```

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The free tier
works for a demo; see [Scaling](#scaling-and-cost) before running a real event.

Check it came up:

```bash
curl localhost:8787/api/health
```

### Credentials and models

| Variable | Default | What it is |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Google AI Studio key. Without it the server starts on a mock engine and warns loudly. |
| `TRANSCRIBE_MODEL` | `gemini-3.5-transcribe-live,gemini-3.8-live` | Speech models, tried in order. |
| `TRANSLATE_MODEL` | `gemini-3.7-flash,gemini-3.5-flash-lite,gemini-3.8-flash` | Translation models, tried in order. |

Both accept a comma separated chain. If a model is busy or quota limited the next one is
used automatically, and the working model becomes preferred for subsequent requests. During
development we watched `gemini-3.8-flash` return 429 for an hour while the chain kept
captions flowing on `gemini-3.5-flash-lite`.

---

## Try it in one command

Test audio ships in [`samples/`](samples/): two Spanish talks and one English talk,
16 kHz mono PCM, generated for this project.

```bash
npm start                   # terminal 1
npm run replay              # terminal 2
```

`replay` streams all three samples **at once, at wall clock speed**, fanning each into two
languages, and prints captions as they arrive:

```
replaying 3 tracks concurrently against http://localhost:8787

[es to en,pt es]     ~ Buenos días a todos y bienvenidos a Nerdearla. Hoy vamos a hablar de
[es to en,pt es]     Buenos días a todos y bienvenidos a Nerdearla. Hoy vamos a hablar de
                     observabilidad en Kubernetes a escala. (+12ms)
[es to en,pt es]     -> [en] Good morning everyone and welcome to Nerdearla. Today we are
                     going to talk about observability in Kubernetes.
[en to es,pt en]     -> [es] Bienvenidos a todos a esta sesión sobre ingeniería de plataformas.

  3 inputs, 6 language outputs, engine gemini, capacity 16

  track-3     3 segs    28 words  p50   770ms  p95  2679ms  first  1470ms  $0.0005
    -> es    34 words  p50   804ms  $0.0001
    -> pt    33 words  p50   843ms  $0.0001
  track-2     3 segs    32 words  p50  1738ms  p95  6630ms  first  1381ms  $0.0005
  track-1     3 segs    35 words  p50  1291ms  p95  5942ms  first  1319ms  $0.0006
```

Point it at your own files, or repeat them to push concurrency higher:

```bash
npm run replay -- samples/talk-es.wav samples/talk-en.wav
npm run replay -- samples/talk-es.wav samples/talk-es.wav samples/talk-es.wav
```

### Against a real talk

```bash
npm run ingest -- "https://www.youtube.com/watch?v=VIDEO_ID" \
  --title "Track A" --lang es --targets en,pt --start 300 --duration 120
```

yt-dlp resolves the audio, ffmpeg decodes it, and `-re` paces it at native rate so latency
figures are honest rather than simulated. Any file or URL ffmpeg can read works the same way.

No API key? `ENGINE=mock npm start` runs the whole pipeline — ingest, fan out, translation,
export, the UI — against a deterministic stand-in.

---

## Getting captions out

Every output is its own stream. Replace `:id` with the source id and `lang` with an output
language; drop `lang` for the original transcript.

| Endpoint | For |
|---|---|
| `GET /api/sessions/:id/events?lang=en` | **Server sent events.** One `curl -N`, no handshake, reconnects on its own, crosses proxies that block WebSocket. Captions arrive pre-split into subtitle sized lines. |
| `ws://host/ws/view?sessionId=:id&lang=en` | **WebSocket.** Same events for players and encoders that already speak it. |
| `GET /api/sessions/:id/live.txt?lang=en` | **Last two caption lines as plain text.** For a vMix title or CasparCG template that polls a URL. |
| `GET /api/sessions/:id/transcript?format=srt&lang=en` | **Subtitle file.** `srt`, `vtt`, `txt` or `json`. |

```bash
curl -N "http://localhost:8787/api/sessions/track-1/events?lang=en"

event: caption
data: {"text":"Good morning everyone and welcome to Nerdearla.",
       "lines":["Good morning everyone and welcome to Nerdearla."],
       "language":"en","seq":1,"latencyMs":480}
```

### Audio in

| Method | How |
|---|---|
| **Pull a URL** | `POST /api/sessions/:id/ingest` with `{ "source": "https://..." }`. YouTube, HLS, or any media file. |
| **OBS or vMix** | `POST /api/sessions/:id/ingest/rtmp` returns a `server` and a `streamKey`. In OBS: Settings, Stream, Custom. |
| **Raw PCM** | `ws://host/ws/ingest?sessionId=:id`, binary frames of 16 kHz mono 16 bit PCM. |

One RTMP listener serves the whole event on port 1935. Keys are registered per source and
routed on publish; an unregistered key is closed immediately, so a talk cannot be hijacked
by guessing a name.

---

## Scaling and cost

**Measured on one laptop**, streaming the bundled samples at wall clock speed:

| Inputs | Outputs | Tier | Result |
|---|---|---|---|
| 3 | 6 | free | All captioned. First caption 1.3–1.5s, p50 0.6–1.7s. Node at 70 MB RSS, under 1% CPU. |
| 5 | 5 | free | All five opened. One retry, one automatic fallback to the secondary speech model. |
| 6 | 12 | free | **Degraded.** One input silent, three slow to start. `RESOURCE_EXHAUSTED` from the free tier. |
| 6 | 12 | paid | 5 of 6 captioned, p50 0.8–3.6s, total spend $0.0021 for the run. Two streams went silent and were recovered automatically. |

The honest summary: **the process is not the limit.** One Node instance fanned six inputs into
twelve language outputs at 70 MB and negligible CPU, because it is mostly moving bytes. The
limits that actually bite are upstream: free tier quota first, then occasional silent or
refused connections from the speech API, all of which are handled rather than hidden.

The remaining gap at six inputs is one source that produced no captions before its clip
ended. The bundled samples are 17 to 21 seconds, which is shorter than the silence detector
needs; a real talk gives it room to work.

### What happens when the upstream misbehaves

Every one of these was observed during development, not anticipated on paper.

| Failure | Response |
|---|---|
| Session hits the Live API's ~10 minute cap | Rotate: dial a replacement, swap the write path, drain the old one. Audio is never written to two connections, so nothing is transcribed twice. |
| A model is quota limited or overloaded | Both model chains fail over and remember which model worked. We watched `gemini-3.8-flash` return 429 for an hour while captions kept flowing on `gemini-3.5-flash-lite`. |
| Connection refused on open | Five attempts with jittered backoff, rotating through the model chain. Before this, 2 of 5 concurrent creates failed; after, 5 of 5 succeeded. |
| A transient error mid-talk | Recorded and shown, while the stream recovers itself. Only a genuinely closed stream marks a source failed. |
| **Audio flowing but no captions** | A watchdog reconnects the speech stream after 20 silent seconds, up to three times, then surfaces the problem. This is the dangerous one: the connection looks healthy and the room just stops getting subtitles. |
| A source did fail | `POST /api/sessions/:id/restart` reattaches it, keeping transcript, outputs and glossary. |

`MAX_CONCURRENT_SESSIONS` (default 16) is a deliberate guard: past it the API returns
`503 capacity_exceeded` rather than accepting a talk it cannot serve.

Cost is tracked live and split between audio (per input) and translation (per output), so you
can see what each language actually costs while the event runs rather than on next month's
invoice. Roughly, one hour of one talk costs about **$0.05 in audio** plus about **$0.01 per
translated language**, at the rates in `.env.example`.

### Staying up

- **Session rotation.** The Live API caps a session at about ten minutes; talks run 30 to 60.
  A replacement connection is dialled, the write path swaps to it, and the old one drains, so
  audio is never written to two connections and nothing is transcribed twice. Rotation also
  fires on the server's own `goAway` warning.
- **Model failover.** Both model chains fail over and remember which model worked.
- **Transient errors.** An upstream blip is recorded and surfaced while the stream recovers
  itself. Only a stream that is genuinely closed marks a source failed, and
  `POST /api/sessions/:id/restart` reattaches it keeping transcript, outputs and glossary.
- **Reconfigure without dropping.** Spoken language and glossary can change mid-talk. The Live
  API has no reconfigure frame, so the same rotation is reused.

---

## Accuracy: the glossary

The single biggest lever on technical vocabulary. Terms are sent to the speech model as
`customVocabulary` and used as a do-not-translate table.

Same audio, same models:

| | Result |
|---|---|
| Without glossary | "Migremos de **Promiscuous** a OpenTelemetry" |
| With glossary | "Migramos de **Prometheus** a OpenTelemetry" |

[`config/glossaries/nerdearla.json`](config/glossaries/nerdearla.json) ships 40 terms. Edit
them from the UI or through `/api/glossaries`; changes are written back to disk and can be
applied to a running talk.

---

## API

| | |
|---|---|
| `GET /api/health` | Engine, models, capacity, uptime |
| `POST /api/sessions` | Create a source |
| `GET /api/sessions` | List sources with live stats |
| `PATCH /api/sessions/:id` | Change spoken language or glossary, live |
| `POST /api/sessions/:id/stop` | Stop, keep the transcript |
| `POST /api/sessions/:id/restart` | Reattach a stream after a failure |
| `DELETE /api/sessions/:id` | Stop and remove |
| `POST /api/sessions/:id/outputs` | Add a language, mid-stream |
| `DELETE /api/sessions/:id/outputs/:language` | Remove a language |
| `GET/POST/PUT/DELETE /api/glossaries` | Manage glossaries |

---

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | HTTP listener |
| `ENGINE` | `gemini` | `mock` runs with no key or network |
| `TRANSCRIPTION_MODE` | `VERBATIM` | `SMART` formats but buffers finals |
| `SILENCE_DURATION_MS` | `400` | Lower commits captions sooner |
| `AUTO_DETECT_LANGUAGES` | `es,en,pt` | Candidates when a source is set to auto |
| `SESSION_ROTATE_SECONDS` | `480` | Rotate before the upstream cap |
| `MAX_CONCURRENT_SESSIONS` | `16` | Guard against quota and cost |
| `RTMP_PORT` / `RTMP_HOST` | `1935` / auto | OBS ingest |
| `GLOSSARY_DIR` | `config/glossaries` | Where glossaries live |

Why those latency defaults, measured on the same audio:

| Config | First caption | Finals during playback |
|---|---|---|
| `SMART` | 2061ms | none, buffered to the end |
| `VERBATIM` | 1741ms | one, at 7.8s |
| **`VERBATIM` + 400ms silence** | 2172ms | **three**, at 6.0s / 11.0s / 14.2s |

Finals matter because only finished segments are translated. Buffering them starves every
output language.

---

## Architecture

Feature modules, each owning its own domain, application, infrastructure and interface slice.
Decorators appear only in `*.module.ts` and controllers, so entities, ports and adapters are
plain TypeScript and testable without Nest.

```
src/
  modules/
    sessions/       source lifecycle, outputs, cost, orchestration
    transcription/  speech ports, Gemini Live adapter, caption splitting
    translation/    translator port, Gemini adapter with failover
    glossary/       terms, persistence
    ingest/         media pull, RTMP relay
    stream/         SSE and plain text consumption
    export/         SRT, VTT, text, JSON
    events/         in process event bus
    realtime/       WebSocket gateway
  shared/           config, language, logging, audio, input registry
```

We speak the Live API wire protocol directly rather than through `@google/genai`: on the
Gemini API path the SDK discards the whole `inputAudioTranscription` config, which would cost
us `customVocabulary`, the main lever on technical term accuracy.

```bash
npm test         # domain tests
npm run typecheck
```

---

## License

Apache-2.0. See [LICENSE](LICENSE).
