
# Inkwell Studio

A stick-figure performance studio. Type a line and a character says it; describe a
scene and they walk, point at a board, act it out.

---

<img width="1105" height="632" alt="stickman" src="https://github.com/user-attachments/assets/faa181ba-46f1-46e6-97fd-a0914b3d1edc" />

## Step 1: Run it
# Run

```bash
cd Stickman-Ink-gitupload
uv run run_app.py
```

That starts both servers and opens the browser. See **[RUN.md](RUN.md)** for
options and troubleshooting.

- Studio → <http://127.0.0.1:8010/companion/>
- Service → <http://127.0.0.1:8765/health>

Restart the voice service after editing `.env`, then start the
app as shown in **[Run](#run)** below.

> A working key already ships in this build so it runs out of the box — but
> **replace it with your own and rotate it** before this folder goes anywhere public.

---

## ⚠️ Before you run  add your API keys

> **You need three keys.** Voices, the AI planner and the director all call these
> services. Without at least the **Gemini** key, the character will not speak.

| Key | Where to get it | What it does |
|---|---|---|
| `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> | **The main voice** — Gemini TTS, lip-sync |
| `OPENROUTER_API_KEY` | <https://openrouter.ai/keys> | **Automatic speech fallback** when Gemini is out of quota |
| `INCEPTION_API_KEY` | <https://platform.inceptionlabs.ai> | **Mercury** — the planner and director behind *Perform* and *Action* |

**Step 2  paste them.** Open `voice/.env` (create the file if it is not there) and
fill in the three lines:

```env
# Paste your real keys here, then restart the voice service.

# Get the Gemini key from https://aistudio.google.com/apikey
GEMINI_API_KEY=AQ.................

# Get the OpenRouter key from https://openrouter.ai/keys
OPENROUTER_API_KEY=sk_q...............

# Get the Mercury (Inception) key from https://platform.inceptionlabs.ai
INCEPTION_API_KEY=sk_.................
```



## The three buttons

| Button | What happens |
|---|---|
| **Speak** | Says exactly what you typed. Lip-sync and small expressions. The fast path. |
| **Perform** | The same text, but an AI planner gives every line its own emotion and gesture. |
| **Action** | Full direction: backgrounds, props, a chalkboard, walking, fighting — plus speech. |

**Single** mode is one performer. **Room** mode is two performers who talk to each
other, each with their own voice; they face you until they speak, then turn to the
other person.

---

## What else is in here

- **Voices* -> Gemini TTS with automatic fallback to OpenRouter when Gemini is out
  of quota. Voices are grouped by gender, so a male character is never given a
  female voice.
- **23 backgrounds** -> from paper and dawn to a haunted house, a rocket launch, an
  aquarium with swimming fish, a guided museum tour, and a glowing street lamp.
- **Demos** -> 50+ ready-made samples in the sidebar, grouped by the button they use.
- **History** -> every performance is cached; replay it with exact timing or export
  it as a video.
- **Designer** -> crown, cape, dress, hat... plus mustache, glasses, ears and a
  handheld mic, applied per character.
- **Two UI styles** -> Minimal (default) and a brutalist Neomorphism theme.

---

## Documentation

| File | Contents |
|---|---|
| **[RUN.md](RUN.md)** | how to run it, what opens, troubleshooting |
| **[SKILLS.md](SKILLS.md)** | every file and its job, where scenes/actions/demos live, **how to add new ones** |
| `PROMPT.md` | the upstream engine's JSON animation format |

If you (or an AI agent) want to extend the app, read `SKILLS.md` first — it has the
exact registries to edit for a new scene, a new action, or a new demo.

---

## Requirements

- [uv](https://docs.astral.sh/uv/) (it installs Python for you)
- a modern browser

No Node, no npm, no manual dependency install.

---

## Layout

```
companion/     the studio: UI, rig, speech client, staging, scenes, demos
voice/         Python service: speech, planner, director, scene generator
js/            upstream stick engine (unchanged)
run_app.py     one-command launcher
```

---

## Tests

```bash
uv run python -m unittest discover -s voice/tests   # 33 tests
node companion/test-rig.js                          # rig behaviour
```

---

## A note on the keys

`voice/.env` **ships with working API keys** in this build, deliberately, so it runs
out of the box. They have been shared in plain text during development —
**rotate them** before this folder goes anywhere public.

---

Built on [`hmelberg/stick`](https://github.com/hmelberg/stick)  a JSON animation
language for stick figures. This project adds a live rig, real speech, an AI
director, and a studio UI on top of that engine.
```
