# SKILLS.md — what every file does, and how to extend the studio

This is the map an AI agent (or a new developer) needs to work on **Inkwell Studio**
without re-reading the whole codebase. Read this before editing anything.

---

## 1. What the app is

A stick-figure performance studio. You type a concept or a script, press a button, and
a stick figure speaks it, moves, and stages a scene.

Three buttons, three different jobs:

| Button | What it does | Code path |
|---|---|---|
| **Speak** | Says the text. Lip-sync + small expressions only. Fastest. | `speakDirect()` → `playSegments()` |
| **Perform** | Says the text **with** per-line emotion + gesture from the planner | `speakWithActions()` → `/api/plan` → `playSegments()` |
| **Action** | Full direction: walk, props, board, scene changes, plus speech | `performActions()` → `/api/action` → `stager.schedule()` |

Two modes: **Single** (one performer) and **Room** (two performers who talk to each other).

---

## 2. File map

```
Stickman-Ink-gitupload/
├── run_app.py              ONE-COMMAND launcher (static site + voice service)
├── pyproject.toml          uv config: `uv run app`
├── index.html              the UPSTREAM engine demo page (not the studio)
├── PROMPT.md               upstream engine's JSON animation format
│
├── companion/              THE STUDIO UI (this is the app)
│   ├── index.html          markup: sidebar, stage, drawer, transport
│   ├── companion.css       all styling
│   ├── app.js              ★ the controller: modes, speech, timeline, scenes, history
│   ├── companion.js        ★ the rig: skeleton, emotions, gestures, idle, accessories
│   ├── tts-client.js       audio streaming, cue scheduling, replay cache
│   ├── action.js           ★ Action staging: props, boards, effects, beat timeline
│   ├── scenes.js           background scene renderers (11 extra scenes)
│   ├── demos.js            the demo catalogue (Speak / Perform / Action samples)
│   ├── recorder.js         exports the stage to WebM
│   └── test-rig.js         rig test suite (`node companion/test-rig.js`)
│
├── voice/                  THE SERVICE (Python, stdlib HTTP server)
│   ├── server.py           HTTP routes: /health /api/speak /api/plan /api/action
│   │                       /api/scene /api/voices /api/config
│   ├── protocol.py         ★ EMOTIONS, GESTURES, aliases, tag parsing
│   ├── planner.py          Perform: text → per-line emotion/gesture plan (Mercury)
│   ├── director.py         Action: text → beat sheet of physical scenes (Mercury)
│   ├── tts.py              ★ speech providers: Gemini ladder → OpenRouter fallback
│   ├── scene.py            AI background generation (Mercury → drawing primitives)
│   ├── mercury.py          LLM client (OpenAI-compatible)
│   ├── config.py           .env loading, VOICE_META (voice gender/tone)
│   ├── .env                ★ real keys (kept on purpose in this build)
│   └── tests/              33 unit tests
│
└── js/                     upstream stick engine — DO NOT EDIT
    ├── engine.js figure.js styles.js scene.js props.js board.js commands.js
    ├── presets.js examples.js app.js auth.js studio.js
```

`★` = the four files that matter most.

---

## 3. Where things live

### Scenes (backgrounds)

Two registries, both keyed by name:

1. **`companion/app.js` → `const SCENES = { ... }`**
   Built-in scenes: `paper, dawn, meadow, loft, dusk, night, snow, cabin,
   aquarium, daylight, garden, ghost, space, standup, moonwalkglow, daydream,
   gallery, confetti, juggler, heads, news, naptime, flowchart, balloons,
   beards, flowers, tour, pitchdeck, sunsetglow`.

   Each entry looks like:
   ```js
   meadow: { theme: 'light', sky: ['#e2efe2', '#b9d8b8'], floor: '#7fa37c',
             ink: '#1e3020', trees: true }
   // keys used by the drawing code: theme, sky[2], floor, ink,
   // plus flags: sun moon stars trees window snow cabin tank garden ghost
   //             space garden + lib:<rendererName>
   ```

2. **`companion/scenes.js` → `window.StickScenes.renderers`**
   For scenes too complex for a flag, `SCENES` entry uses `lib: '<name>'` and the
   renderer draws into the background group:
   ```js
   gallery: { theme: 'light', sky: [...], floor: '#cbbb9f', ink: '#221b12',
              lib: 'galleryTour' }
   ```

**To add a scene:**
- simple (gradient + a few flags) → add one entry to `SCENES` in `app.js`
- complex → write `renderer(container, el, opts)` in `scenes.js`, add it to the
  exported `renderers` object, then add a `SCENES` entry with `lib: '<name>'`
- add the trigger words to `pickScene(text)` in `app.js`
- saved customs live in `localStorage` under **`stick.scenes.v1`**

### Actions (what the character physically does)

Three layers, in order:

1. **Gestures** — `companion/companion.js` → `const GESTURES = { ... }`
   Each gesture is keyframe tracks per joint channel:
   ```js
   GESTURES.wave = { dur: 1.9, ch: { shR: [[0,0],[0.4,110],[1.5,105],[1.9,0]], ... } }
   ```
   Channels: `smile eyeOpen browTilt browRaise browSkew mouthOpen tears blush
   bend lean headTilt tilt stanceW shL shR elL elR hipL hipR kneeL kneeR
   handL handR x y facing`
   Locomotion gestures also carry `locomote: <stage units>` and set `facing`.

2. **Staging scenarios** — `companion/action.js` → `const SCENARIOS = { ... }`
   A directed beat names one scenario. Currently:
   `walk run dance handshake jump fight clash classroom lecture table family
   think present approach faceoff moonwalk sillywalk`
   Each entry declares `{ label, prop, fx, gesture, duo }`, e.g.
   ```js
   lecture: { label:'Lecture', prop:'board', fx:'chalk', gesture:'point' }
   ```

3. **Director vocabulary** — `voice/director.py` → `SCENARIOS` set + `SYSTEM` prompt.
   The LLM may only emit scenario ids from this set, so it can never produce a beat
   the renderer cannot stage.

**To add an action:**
1. add the gesture to `GESTURES` in `companion.js` (joint keyframes), and register a
   label in `GESTURE_LABELS`
2. add a scenario to `SCENARIOS` in `action.js` referencing that gesture (and a
   `prop`/`fx` if it needs one)
3. add the same id to the `SCENARIOS` set **and** the `SYSTEM` prompt's allowed list
   in `voice/director.py`
4. add a prop/effect helper in `action.js` (`PROPS`, `effectSpray`, …) if needed
5. restart the voice service so the director prompt reloads

### Demos (the sample buttons)

`companion/demos.js` → `window.StickDemos` with three groups (Speak / Perform /
Action). Each item:

```js
{ id:'the-pitch', label:'The pitch', kind:'action',
  prompt:'delivers a pitch to investors at the board',
  scene:'pitchdeck', supported:true }
// kind: 'speak' | 'perform' | 'action'
// speak/perform use: text (+ optional emotion, gesture)
// action uses: prompt, optional scene
// supported:false + note when the rig genuinely cannot do it
```

**To add a demo:** append an object to the right group in `demos.js`. Ids must be
unique. If it needs a background, set `scene` to a key from `SCENES` or a renderer
name (aliases exist in `app.js` → `DEMO_SCENE_ALIAS`). The panel is rebuilt from this
file on load (`buildDemoPanel()`), so no HTML edit is needed.

### Voices

- `voice/config.py` → `VOICE_META` maps every voice to `(gender, tone)`.
  Gender drives provider mapping: female → HeyGen *Tabitha*, male/neutral → *alloy*.
- `GET /api/voices` returns the merged catalogue (Gemini + OpenRouter, with gender
  and a `verified` flag). The UI groups by gender and hides mismatches.
- Aliases for model-chosen names live in `voice/protocol.py` → `EMOTION_ALIASES`
  and `GESTURE_ALIASES`. Add entries there when a model invents a word.

### Speech providers

`voice/tts.py`:
- `GeminiProvider` tries a ladder of Gemini models (`config.TTS_MODELS`), then
- `ChainProvider` falls back to `OpenRouterProvider`
  (`heygen/heygen-voice-1-turbo:free` → `fish-audio/s2.1-pro-free:free`)
- OpenRouter returns PCM at **44.1 kHz**; the provider resamples to 24 kHz mono.

### HTTP API (voice/server.py)

| Route | Purpose |
|---|---|
| `GET /health` | provider, models, voices, openrouter status |
| `GET /api/voices` | voice catalogue with gender |
| `POST /api/speak` | text or segments → framed stream (JSON events + PCM) |
| `POST /api/plan` | Perform: per-line emotion/gesture plan |
| `POST /api/action` | Action: beat sheet |
| `POST /api/scene` | AI-generated background spec |
| `POST /api/config` | save keys to `.env` and reload |

Stream framing: `[kind:1][len:uint32be][payload]`, kind `J` = JSON, `A` = PCM
s16le 24 kHz mono.

---

## 4. Timing model (read this before touching playback)

- The **audio clock is the only clock**. `tts-client.js` schedules buffers on the
  Web Audio timeline and pushes a **cue** per segment at that exact start time.
- `pump()` fires cues when the audio clock reaches them; `app.js`
  `applySegment()` → `setCurrentSegment()` is the **single place** that decides the
  current line, so the caption bubble and the highlighted timeline row cannot
  disagree.
- Playback is only declared finished when the **stream has ended**
  (`_streamEnded`) *and* the buffer drained. Synthesising a segment takes ~3 s, so
  the buffer legitimately drains between lines — treating that gap as "finished"
  was the bug that made only the first line animate.
- Action staging runs on its own beat timeline via `stager.schedule(beats)`.

Known limitation: because each segment is synthesised sequentially there is a
several-second silence between lines. Fixing it means prefetching segment *N+1*
while segment *N* plays.

---

## 5. Testing

```bash
uv run python -m unittest discover -s voice/tests   # 33 service tests
node companion/test-rig.js                          # rig: gestures, idle, emotes
```

`test-rig.js` encodes invariants that are easy to break from the idle system:
a neutral figure keeps the neutral smile, and idle motion must not teleport.

---

## 6. Gotchas learned the hard way

- **Never rewrite these files with PowerShell `Set-Content`.** It has corrupted the
  UTF-8 glyph table (`♪`, `★`) more than once. Use Python with `encoding="utf-8"`.
- `voice/.env` is read at **process start** — editing keys or `protocol.py`
  requires a service restart.
- Gemini voice names passed to OpenRouter must be mapped by gender, or a male
  character gets a female voice.
- The upstream `js/` folder is the rendering engine; the studio only reads from it.
  Editing it will change the engine demo page too.
