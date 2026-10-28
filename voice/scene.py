"""Ask Mercury for a background spec, then validate it hard.

The model returns a small drawing program (palette + primitive elements) that
the browser renders as SVG. No image model, no free-form code execution.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

from mercury import MercuryError, chat, extract_json

TYPES = {
    "sun", "moon", "star", "cloud", "hill", "tree", "house", "window",
    "animal", "fish", "bubble", "weed", "snow", "rain", "grass", "water",
}

SYSTEM = """You are a scene designer for a stick-figure animation. Return ONLY compact JSON, no prose:
{"name":"short title","theme":"light"|"dark","sky":["#top","#bottom"],"floor":"#hex","ink":"#hex",
"elements":[{"type":"sun|moon|star|cloud|hill|tree|house|window|animal|fish|bubble|weed|snow|rain|grass|water","x":0-100,"y":0-100,"size":1-30,"color":"#hex","opacity":0-1}]}
Rules: 3-8 elements max; every value short; colours must fit the mood; keep the whole reply under 900 characters."""


def _hex(v: Any, fallback: str) -> str:
    if isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{3,8}", v.strip()):
        return v.strip()
    return fallback


def _num(v: Any, lo: float, hi: float, fallback: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return fallback
    return max(lo, min(hi, f))


def normalize(raw: Dict[str, Any], prompt: str) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("scene must be an object")
    theme = "dark" if str(raw.get("theme", "")).lower() == "dark" else "light"
    sky = raw.get("sky") if isinstance(raw.get("sky"), list) else []
    sky = [_hex(sky[0], "#f4f1ea") if sky else "#f4f1ea",
           _hex(sky[1], "#e6dfd2") if len(sky) > 1 else "#e6dfd2"]
    els: List[Dict[str, Any]] = []
    for e in (raw.get("elements") or [])[:10]:
        if not isinstance(e, dict):
            continue
        t = str(e.get("type", "")).lower().strip()
        if t not in TYPES:
            continue
        els.append({
            "type": t,
            "x": _num(e.get("x"), -10, 110, 50),
            "y": _num(e.get("y"), -10, 110, 60),
            "size": _num(e.get("size"), 1, 30, 6),
            "color": _hex(e.get("color"), "#888888"),
            "opacity": _num(e.get("opacity"), 0.15, 1, 0.85),
        })
    if not els:
        raise ValueError("scene has no valid elements")
    return {
        "name": str(raw.get("name") or prompt)[:32],
        "theme": theme,
        "sky": sky,
        "floor": _hex(raw.get("floor"), "#d9cfbf"),
        "ink": _hex(raw.get("ink"), "#1a1915" if theme == "light" else "#f2f5f8"),
        "elements": els,
    }


def make_scene(cfg, prompt: str) -> Dict[str, Any]:
    if not cfg.has_llm:
        raise MercuryError("INCEPTION_API_KEY is not configured")

    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": prompt[:600]},
    ]
    # Mercury counts reasoning tokens against the cap, so a tight budget
    # truncates the JSON mid-object ("finish=length"). Give it room, then
    # retry once with an even larger budget plus a terser instruction.
    last: Exception | None = None
    for attempt, (budget, tail) in enumerate(((4000, ""), (6000, " Return compact JSON."))):
        try:
            text = chat(cfg, messages if not tail else
                        [messages[0], {"role": "user", "content": messages[1]["content"] + tail}],
                        max_tokens=budget, temperature=0.4)
            return normalize(extract_json(text), prompt)
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt == 1:
                break
    raise MercuryError(f"could not generate a scene: {str(last)[:200]}")
