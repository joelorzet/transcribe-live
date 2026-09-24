# Transcribe Live

**Open-source real-time transcription and ES↔EN translation at scale for conferences.**

Built for the [Nerdearla Vibeathon 2026](https://nerdearla26.devpost.com/). Licensed Apache-2.0.

Live audio in → real-time transcript in the original language → real-time translation →
subtitles on the web, in an OBS overlay, or in your terminal. Many tracks at once, on one process.

---

## Why this design

The challenge asks for transcription *at scale*, judged on accuracy with technical
terminology, latency, multi-session scalability, operational simplicity and innovation.
Four decisions follow directly from that:

| Judging criterion | What we built |
|---|---|
| **Accuracy on technical terms** | Per-track **glossaries** pushed to the speech model as `customVocabulary` *and* used as a forced-translation table. "Kubernetes", "gRPC", "Nerdearla" stop coming back as "cuberpuntos". |
| **Latency** | Interim captions render as the speaker talks; only *final* segments are translated, so we never pay to translate text that is about to be revised. p50/p95 latency is measured and displayed live. |
| **Scale without prohibitive cost** | One Node process fans out to N concurrent tracks. A live **cost meter** and an event-cost projector make the bill visible *during* the event, not after it. |
| **Deployment simplicity** | Node 24 runs the TypeScript directly — **no build step**, two dependencies, one `docker compose up`. |

## Quick start

```bash
cp .env.example .env     # add your GEMINI_API_KEY
npm install
npm start                # http://localhost:8080
```

No API key yet? Everything runs against a deterministic mock engine:

```bash
ENGINE=mock npm start
```

## Status

Work in progress — built live during the Vibeathon window (24–25 Sep 2026).
