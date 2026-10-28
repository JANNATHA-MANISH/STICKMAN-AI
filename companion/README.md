# Stickman Companion Studio

A live stick-figure studio built on [`hmelberg/stick`](https://github.com/hmelberg/stick):

- **Single Companion** (default) or **Podcast Room** with 2–4 characters
- **Speak** — direct Gemini TTS, low latency, no LLM
- **Speak with actions** — Mercury plans emotion/gesture/style per segment, then Gemini speaks it
- 18 moods, 16 repo clips as live gestures, emotes, gaze, blinking, talking hands
- One stage, one render loop, characters never reset when an expression changes

## Run

Three terminals, from `stick/`:

```powershell
python -m http.server 8010                                  # the app
voice\.venv\Scripts\python.exe voice\server.py               # speech + planner
# open http://127.0.0.1:8010/companion/
```

First time only:

```powershell
python -m venv voice\.venv
voice\.venv\Scripts\pip install -r voice\requirements.txt
copy voice\.env.example voice\.env    # then add GEMINI_API_KEY and INCEPTION_API_KEY
```

No keys? The studio still runs: expressions, gestures and the planner-less
animation work, and **Speak** falls back to a synthetic jaw labelled
*preview*. `--mock` forces the local tone generator for pipeline testing.

## The two speech paths

| | Speak | Speak with actions |
|---|---|---|
| planner | none | Mercury (`mercury-3`) |
| text | used verbatim (tags parsed deterministically) | planned into segments, words preserved |
| latency | one TTS round-trip | planner call, then TTS |
| works without Mercury key | yes | no (falls back to Speak) |

**Speak** sends the text (with any `[happy]`, `[laughs]`, `<short pause>` cues)
straight to Gemini. **Speak with actions** asks Mercury for a performance plan:
segments with `speaker_id`, `emotion`, `intensity`, `style`, `gesture` and
`pause_after_ms`. The plan is validated against the repo's vocabulary, then
each segment is synthesized with the right character's voice.

### Podcast Room

- **Script mode**: `Ava: text` lines route to that speaker's voice with no LLM.
- **Topic mode**: "Speak with actions" lets Mercury write and perform a 4–6
  turn conversation between the cast; "Speak" still speaks the typed text with
  the selected speaker.
- Each character has an independent rig: mood, gesture, emote, gaze and mouth.
  Listeners keep idling; only the active speaker's jaw is driven by audio.
- Up to 4 speakers. Presentation (feminine/masculine/neutral → hair + build)
  and voice are independent settings.

## Speech pipeline

```
text ──► /api/speak ──► Gemini (generate_content_stream) ──► PCM frames
                                                              │
                            Web Audio clock ◄─────────────────┘
                                     │
                        analyser RMS → jaw of the speaker
```

- Frames: `[kind:1][len:uint32be][payload]`, `J` JSON / `A` PCM (s16le 24 kHz mono).
- Every JSON event carries `seq`; a new request bumps a generation counter and
  late frames are dropped.
- Audio is scheduled on `AudioContext.currentTime`, never on arrival time.
- `segment` events switch emotion + gesture and set the active speaker.
- `pause_after_ms` inserts real silence in the playback queue.

## Cues and tags

Recognized and kept inline for the model: `[laughs]`, `[sighs]`, `[coughs]`,
`[gasp]`, `[whispers]`, `[breath]` (angle brackets work too, and `[soft laugh]`
/ `[whispering]` are normalized to the canonical spelling).

Handled by the app instead: `<short pause>` (450 ms), `<long pause>` (1400 ms),
emotion words (`[happy]`, `[thinking]`, …) and gesture words (`[wave]`,
`[bow]`, …). Unknown cues are stripped from the speech and reported.

Delivery style from the planner is used when `GEMINI_TTS_ENGINE=interactions`
(`speech_metadata.style`); the default `generate` engine is the fast path and
ignores style on the wire, keeping it for the inspector.

## Event API

```js
Companion.send({ type: 'emotion', value: 'happy', intensity: 0.9 });
Companion.send({ type: 'gesture', value: 'victory' });
Companion.send({ type: 'emote', value: 'idea' });
Companion.send({ type: 'speak', text: 'hi', emotion: 'happy' });
Companion.stop();
```

## Voices and models

`GET /health` returns the live lists. Voices include the 30 documented prebuilt
voices plus **Fola**, verified working here on both TTS models. Models:
`gemini-3.8-flash-lite-tts` (default, ~1.1–2.0 s to first audio measured) and
`gemini-3.8-flash-tts`.

## Tests

```powershell
node companion/test-rig.js
voice\.venv\Scripts\python.exe -m unittest discover -s voice\tests
node tools\studio-check.mjs shots-studio
```

- rig: 18 moods, 16 gestures, smooth cross-fades, layers, audio-driven mouth,
  emotes, idle, fuzz (no NaN).
- python (33): tag parsing, canonical cues, pauses, plan schema, Mercury JSON
  extraction, frame ordering, seq, cancellation, health.
- studio-check (browser, live providers): single default, both buttons, direct
  Speak makes no planner call, Mercury plan → audio, podcast script + topic,
  speaker routing, emote switching (`live:1 nodes:1`), mobile overflow, and a
  clean console.

## Measured latency (this machine, live)

| path | result |
|---|---|
| direct Speak → first audio | 1.1–2.0 s (Gemini, 1 segment) |
| plan (Mercury) | ~1.9–3.5 s for 3–10 segments |
| first audio after planned request | ≈1.2–1.6 s (first segment) |
| podcast turn (2nd speaker) | ≈0.9–1.4 s to first audio |

These are real provider measurements, not mocked. The mock generator is faster
(~20–120 ms) and is labelled as such.

## Limitations

- **Segment-level sync, not word-level.** Expressions switch when a segment's
  audio starts; lip motion is amplitude-driven, not viseme-accurate.
- **Style is only transmitted on the `interactions` engine.** On the default
  fast path a planned style is shown in the inspector but not sent to Gemini.
- **Sequential per-speaker synthesis.** Turns are synthesized one after another
  (single-speaker calls), not Gemini's multi-speaker mode — this keeps
  turn→voice mapping exact but adds a small gap between turns.
- **Mercury can be talkative.** Reasoning tokens are billed against
  `max_tokens`; the planner uses 4000 and retries once on an invalid plan.
- No LLM conversation memory, no speech recognition, no barge-in beyond the
  Stop button.
- Podcast cast is capped at 4; emote drawing is glyph-based (as upstream).

## Studio v3 notes

- **Default companion is male** (`Ben`, voice `Charon`); presentation and voice
  stay independent, and the voice picker groups voices by the supplied
  gender/tone metadata (Male / Female / Other).
- **Speaker alignment** is driven by the audio clock: a segment's emotion,
  gesture and speaking character are applied when *its audio starts playing*,
  not when the chunk arrives. (This was the cause of Ava's line animating Ben.)
- **Playback history**: every finished take is cached in memory; the Perform tab
  lists it with a Replay button that replays the cached PCM — no provider call.
- **Actions added**: run, fight, handshake, dance, beat (plus the 16 repo clips).
  Emotions also trigger a fitting gesture when the caller doesn't specify one.
- **Touch reactions**: tap the head for a shy response, an arm to wave, the
  torso to laugh, a leg to hop.
- **Backgrounds**: paper / stage / night / sunset / forest / room / snow, plus a
  free-text prompt mapped to the closest scene; ink colours adapt for contrast.
- **Model fallback**: if a TTS model fails (quota, 5xx), the provider retries
  once on the other Gemini TTS model and reports it as a notice.
- The composer now lives in the right-hand column with the stage on the left.
