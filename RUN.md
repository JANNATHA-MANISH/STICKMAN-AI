# RUN.md — how to run Inkwell Studio

## Requirements

- [uv](https://docs.astral.sh/uv/) — install with
  `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"` (Windows) or
  `curl -LsSf https://astral.sh/uv/install.sh | sh` (macOS/Linux).
  Python 3.10+ is installed automatically by uv.
- A modern browser (Chrome, Edge or Firefox).

Nothing else. No Node, no npm, no manual `pip install`.

## One command

```bash
cd Stickman-Ink-gitupload
uv run app
```

That is the whole procedure.

### What it does

`run_app.py` starts **two things** and opens the browser:

| Service | URL | Purpose |
|---|---|---|
| Static app | <http://127.0.0.1:8010/companion/> | the studio UI |
| Voice service | <http://127.0.0.1:8765/health> | speech + planner |

The first run creates a virtualenv and downloads dependencies (about 20 seconds,
once). Later runs start in a couple of seconds.

Expected console output:

```
[voice] starting with python.exe on 127.0.0.1:8765
  probe  : ready: openrouter | skipped: gemini
stick studio service on http://127.0.0.1:8765
  speech : gemini · gemini-3.8-flash-lite-tts · voice Fola
  planner: mercury:mercury-3
[voice] ready    http://127.0.0.1:8765/health
[app]   static   http://127.0.0.1:8010/companion/
```

### What opens

Your browser opens **http://127.0.0.1:8010/companion/** automatically.

You will see:

- **left sidebar** — mode (Single / Room), Concept or Script box, the three
  buttons (Speak / Perform / Action), Length, voice panel, Demo and Design
  panels, History
- **centre** — the stage with the stick figure on the *standup* scene
- **bottom-right gear** — the whole transport: zoom, size, play/pause, seek,
  scrubber, speed, fullscreen and Record

If the browser does not open by itself, visit the URL above manually.

## Options

```bash
uv run app                      # default ports 8010 / 8765
uv run app --port 8020          # move the app
uv run app --voice-port 8770    # move the service
uv run app --no-open            # do not launch a browser
uv run app --host 0.0.0.0       # expose on the LAN
```

If you change `--voice-port`, the UI still expects `8765` — update
`const API = 'http://127.0.0.1:8765'` at the top of `companion/app.js`, or just
keep the default port.

## First run checklist

1. `uv run app`
2. Browser opens on the studio
3. The voice chip (bottom-left) should read something like `Gemini · flash-lite`
   or `OR · heygen-voice-1-turbo`
4. Type a line, press **Speak** → the figure talks
5. Switch to **Room**, press **Perform** → two characters converse
6. Press **Action** → it walks, gestures and stages a scene

## Keys

`voice/.env` **is included in this build with working keys**:

```
GEMINI_API_KEY=...
INCEPTION_API_KEY=...      # Mercury — required for Perform and Action
OPENROUTER_API_KEY=...     # optional speech fallback
```

- `GEMINI_API_KEY` → speech (primary)
- `INCEPTION_API_KEY` → the planner that makes Perform and Action work
- `OPENROUTER_API_KEY` → automatic fallback when Gemini is out of quota

After editing `.env`, **restart** `uv run app` — keys are read at startup.

> These keys are live and were shared in plain text during development.
> Rotate them before publishing this folder anywhere.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `uv: command not found` | install uv (see Requirements) |
| Voice chip says `service offline` | the service did not start; check the console for a Python error, and that port 8765 is free |
| `no voice key` | `voice/.env` missing a key, or the service was started before you added it — restart |
| Speech works but Perform/Action do nothing | `INCEPTION_API_KEY` missing or out of credit |
| Only the first line animates | restart the service; this was a known playback bug, fixed in `tts-client.js` (`_streamEnded` guard) |
| Port already in use | `uv run app --port 8020 --voice-port 8770` (and update `API` in `app.js`) |

## Running the pieces separately (optional)

```bash
# terminal 1 — static site
uv run python -m http.server 8010

# terminal 2 — voice service
cd voice && uv run python server.py
```

## Tests

```bash
uv run python -m unittest discover -s voice/tests   # expect: 33 tests OK
node companion/test-rig.js                          # expect: all rig checks passed
```
