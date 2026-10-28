"""Action director: turn a plain-language scene into a beat sheet.

Separate from the performance planner on purpose. The planner answers "how do
I say this line"; the director answers "what happens on stage, where, and in
what order". Each beat names a scenario the browser can stage with props,
particles and sound, so the model never has to describe drawing commands.

Only scenario ids the renderer knows are accepted, so a bad completion can
never produce an unstaged beat.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

from mercury import MercuryError, chat, extract_json

# Mirrors companion/action.js SCENARIOS.
SCENARIOS = {
    "walk", "run", "dance", "handshake", "jump", "fight", "clash",
    "classroom", "lecture", "table", "family", "think", "present",
    "approach", "faceoff", "moonwalk", "sillywalk",
}

MAX_BEATS = 8

SYSTEM = """You are a stage director for an animated stick figure. Turn the user's
scene into a beat sheet. Reply with compact JSON only, no prose:

{"title":"short title","beats":[
  {"scenario":"one of: walk,run,dance,handshake,jump,fight,clash,classroom,lecture,table,family,think,present,approach,faceoff,moonwalk,sillywalk",
   "speaker":"name of the character doing this beat (only if the scene names people)",
   "text":"what that character says out loud",
   "hold":1.5}
]}

Rules:
- Always write the spoken text in the SAME language as the user's input.
  Never translate. If the input mixes languages, mirror that mix.
- Produce 4 to 8 beats. A short scene is not useful: the performance should run
  for at least 20 seconds of speech in total.
- Each beat is ONE physical action.
- "approach" = two people walk toward each other. "faceoff" = two square up.
- When two people are present, alternate the "speaker" between them so they have
  a back-and-forth conversation; never let one person say both sides.
- Use "classroom"/"lecture" ONLY when the scene is about teaching or explaining
  something at a board, and put the key facts in "text".
- Use "table"/"family" when people sit or stand around a table.
- Use "clash" only when the scene explicitly involves violence.
- Each "text" should be a full sentence of 60-160 characters, not a fragment.
- Never describe scenery; only actions and speech.
- Total reply may be up to 1800 characters."""


def _clamp_hold(v: Any) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 1.6
    return max(0.8, min(6.0, f))


def normalize(raw: Dict[str, Any], prompt: str) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("action plan must be an object")
    beats_in = raw.get("beats")
    if not isinstance(beats_in, list) or not beats_in:
        raise ValueError("action plan has no beats")

    beats: List[Dict[str, Any]] = []
    for b in beats_in[:MAX_BEATS]:
        if not isinstance(b, dict):
            continue
        sc = str(b.get("scenario", "")).strip().lower()
        if sc not in SCENARIOS:
            continue
        text = str(b.get("text") or "").strip()
        beat = {
            "scenario": sc,
            "text": text[:200],
            "hold": _clamp_hold(b.get("hold")),
        }
        spk = str(b.get("speaker") or "").strip()
        if spk:
            beat["speaker"] = spk[:40]
        beats.append(beat)
    if not beats:
        raise ValueError("no usable beats")

    title = str(raw.get("title") or prompt)[:48]
    return {"title": title, "beats": beats}


def plan_action(cfg, prompt: str) -> Dict[str, Any]:
    if not cfg.has_llm:
        raise MercuryError("INCEPTION_API_KEY is not configured")

    msgs = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": prompt[:600]},
    ]
    last: Exception | None = None
    for attempt, budget in enumerate((5000, 7000)):
        try:
            return normalize(extract_json(chat(cfg, msgs, max_tokens=budget, temperature=0.5)), prompt)
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt == 1:
                break
    raise MercuryError(f"could not direct this scene: {str(last)[:200]}")
