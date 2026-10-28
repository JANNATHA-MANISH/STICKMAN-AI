# voice — Gemini TTS + Mercury planner service

Stdlib HTTP service behind the studio. Two routes that matter:

```
POST /api/speak   text or plan → framed stream of JSON events + PCM
POST /api/plan    text → validated Mercury performance plan (no audio)
GET  /health      providers, models, voices, SDK
```

## Run

```powershell
voice\.venv\Scripts\python.exe voice\server.py           # live
voice\.venv\Scripts\python.exe voice\server.py --mock    # tone generator, no keys
```

`voice\.env` (git-ignored) holds `GEMINI_API_KEY` and `INCEPTION_API_KEY`;
`voice\.env.example` documents every option. The loader reads UTF-8-sig, so a
Windows BOM cannot mangle the first key.

## Engines

`GEMINI_TTS_ENGINE=generate` (default) uses
`client.models.generate_content_stream(..., response_modalities=["audio"])`
and yields inline PCM chunks — measured ~1.1–2.0 s to first audio.

`GEMINI_TTS_ENGINE=interactions` uses `interactions.create(stream=True)` with
`speech_metadata.style`, which supports sustained delivery notes but was
~3× slower in testing (~4.9 s first audio). It is used only when a segment has
a style and the engine is explicitly set.

Both produce headerless 16-bit LE PCM, 24 kHz, mono.

## Frames

```
[ 'J' | 'A' ][ uint32 big-endian length ][ payload ]
```

Events: `start`, `segment`, `notice`, `error`, `end`; every event has `seq`.
Audio frames follow the `segment` they belong to. The client schedules them on
the Web Audio clock and drops anything from a superseded generation.

## Planner

`POST /api/plan` accepts:

```json
{ "text": "That is fantastic! Let me think.",
  "mode": "single",
  "topic": false,
  "speakers": [{ "id": "a", "name": "Ava", "voice": "Fola" }] }
```

and returns `{ "ok": true, "plan": { "version": 1, "mode": "single", "segments": [...] } }`.
Validation clamps intensity (0–1.6), caps segments (6 single / 12 podcast),
maps emotion synonyms to the repo's 19 moods, maps free-text gestures
("hand on chin" → `thinkChin`), rejects unknown speaker ids, and retries once
on malformed JSON. Mercury is a reasoning model: the planner budgets 4000
tokens because reasoning tokens count against the cap.

## Voices

Documented prebuilt voices plus **Fola**, which the live API accepted on both
`gemini-3.8-flash-lite-tts` and `gemini-3.8-flash-tts`. An unsupported voice
triggers a single retry with `GEMINI_FALLBACK_VOICE` and a visible `notice`;
voices are never swapped silently.

## Tests

```powershell
voice\.venv\Scripts\python.exe -m unittest discover -s voice\tests -v
```

33 tests: tag parsing and canonicalization, pause timing, plan schema and
clamps, Mercury JSON extraction, speaker defaults, frame ordering, `seq`
monotonicity, 400/422/503 paths, cancellation followed by a clean request.

Live probes used during development (kept out of the repo): Gemini direct TTS
with `Fola`, and Mercury plans for single and podcast-topic prompts.
