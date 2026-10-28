"""Mercury performance planner: prompt, schema and safe normalization.

The planner decides *how* words are performed (emotion, intensity, gesture,
style, pauses). It never generates audio and never executes code.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from mercury import MercuryError, plan_once
from protocol import EMOTIONS, GESTURES, MAX_SEGMENTS, apply_style_hint

MAX_TEXT = 1800


class PlanError(ValueError):
    pass


EMOTION_SYNONYMS = {
    "excited": "ecstatic", "joyful": "happy", "cheerful": "happy", "glad": "happy",
    "upset": "sad", "unhappy": "sad", "down": "sad", "melancholy": "sad",
    "shocked": "surprised", "amazed": "surprised", "astonished": "surprised",
    "mad": "angry", "furious": "angry", "irritated": "angry", "annoyed": "angry",
    "anxious": "worried", "nervous": "worried", "concerned": "worried",
    "puzzled": "confused", "curious": "thinking", "thoughtful": "thinking",
    "tired": "sleepy", "sleepy": "sleepy", "bored": "bored",
    "proud": "proud", "embarrassed": "embarrassed", "ashamed": "embarrassed",
    "disgusted": "disgusted", "scared": "scared", "afraid": "scared",
    "crying": "crying", "laughing": "laughing", "amused": "laughing",
    "loving": "love", "affectionate": "love", "neutral": "neutral",
}

GESTURE_SYNONYMS = {
    "wave": "wave", "waving": "wave", "hello": "wave", "greeting": "wave",
    "nod": "nod", "nodding": "nod", "agree": "nod",
    "head nod": "head_nod", "head tilt": "head_tilt", "tilt": "head_tilt",
    "think": "thinkChin", "chin": "thinkChin", "pondering": "thinkChin",
    "shrug": "shrugOnce", "clap": "clapOnce", "applause": "clapOnce",
    "bow": "bow", "bowing": "bow",
    "victory": "victory", "cheer": "victory", "arms up": "victory",
    "facepalm": "facepalm", "cough": "cough", "phone": "phoneCall",
    "stretch": "stretchYawn", "yawn": "stretchYawn",
    "scratch": "scratchHead", "lean": "coolLean", "hop": "hopJoy", "jump": "hopJoy",
    "run": "run", "running": "run", "sprint": "run",
    "fight": "fight", "fighting": "fight", "punch": "fight", "boxing": "fight",
    "handshake": "handshake", "shake hands": "handshake", "greet hands": "handshake",
    "dance": "dance", "dancing": "dance", "groove": "dance",
    "beat": "beat", "drum": "beat", "rhythm": "beat", "bounce": "beat",
    "slap": "slap", "slaps": "slap", "smack": "slap",
    "kick": "kick", "kicks": "kick",
    "hug": "hug", "hugs": "hug", "embrace": "hug",
    "kiss": "kiss", "kisses": "kiss", "blow a kiss": "kiss",
}

SCHEMA_HINT = """{
  "version": 1,
  "mode": "single",
  "segments": [
    {
      "text": "Hey, that is wonderful!",
      "speaker_id": "companion",
      "emotion": "happy",
      "intensity": 0.75,
      "style": "warm and enthusiastic",
      "gesture": "wave",
      "pause_after_ms": 0
    }
  ]
}"""


def system_prompt(mode: str, speaker_count: int) -> str:
    return f"""You are the performance director for a stick-figure animation studio.
You receive text and decide HOW it should be performed: emotion, intensity,
gesture, vocal style and pauses. You never change the wording unless asked.

Allowed emotions (use exactly one of these ids):
{", ".join(EMOTIONS)}

Allowed gestures (use exactly one of these ids, or null):
{", ".join(GESTURES)}

Rules:
- Always write the spoken text in the SAME language as the user's input.
  Never translate. If the input mixes languages, mirror that mix.
- Preserve the user's words exactly, including punctuation and order.
- Split into natural sentence-sized segments ({1 if mode == "single" else 2}-{6 if mode == "single" else MAX_SEGMENTS} segments).
- Choose a gesture only when it clearly fits; most segments should have gesture null.
- intensity is 0.0-1.6; 1.0 is normal.
- style is a short delivery note such as "warm and enthusiastic",
  "calm and thoughtful", "whispered, tense" (optional).
- pause_after_ms is 0-1200, for dramatic beats only.
- Return ONLY a JSON object matching this shape (no markdown, no comments):
{SCHEMA_HINT}
- mode is "{mode}". There are {speaker_count} speaker(s)."""


def user_prompt(text: str, mode: str, speakers: List[Dict[str, Any]], topic: bool) -> str:
    roster = "\n".join(
        f'- id "{s["id"]}" name "{s.get("name", s["id"])}" voice {s.get("voice", "?")}'
        for s in speakers
    )
    if topic and mode == "podcast":
        return (f"Speakers:\n{roster}\n\nWrite a short natural podcast conversation about:\n{text}\n\n"
                f"Use only these speaker ids. 4-6 turns, 1-2 sentences each, alternating speakers. "
                f"Keep it conversational, with small reactions between hosts.")
    if topic:
        return (f"Write a short spoken monologue (3-5 segments, 1-2 sentences each) about:\n{text}\n\n"
                "Keep the given speaker id. Preserve any wording the user supplied.")
    if mode == "podcast":
        return (f"Speakers:\n{roster}\n\nHere is a script. Annotate every line, keeping the words "
                f"exactly as written, and set speaker_id from the roster:\n\n{text}")
    return f"Speak this text, preserving the words exactly:\n\n{text}"


def _pick_emotion(value: Any) -> str:
    if not value:
        return "neutral"
    v = str(value).strip().lower().replace(" ", "_")
    if v in EMOTIONS:
        return v
    if v in EMOTION_SYNONYMS:
        return EMOTION_SYNONYMS[v]
    for key, mapped in EMOTION_SYNONYMS.items():
        if key in v:
            return mapped
    return "neutral"


def _pick_gesture(value: Any) -> Optional[str]:
    if not value or not isinstance(value, str):
        return None
    v = value.strip()
    if v in GESTURES:
        return v
    low = v.lower()
    for key, mapped in GESTURE_SYNONYMS.items():
        if key in low:
            return mapped
    return None


def _clamp(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, f))


def normalize(data: Any, mode: str, speakers: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Validate and clamp a planner result into the stable schema."""
    if not isinstance(data, dict):
        raise PlanError("plan must be a JSON object")
    raw_segments = data.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise PlanError("plan has no segments")

    allowed_ids = [s["id"] for s in speakers]
    out: List[Dict[str, Any]] = []
    cap = 6 if mode == "single" else MAX_SEGMENTS
    for i, seg in enumerate(raw_segments[:cap]):
        if not isinstance(seg, dict):
            continue
        text = re.sub(r"\s+", " ", str(seg.get("text", ""))).strip()
        if not text:
            continue
        sid = seg.get("speaker_id") or allowed_ids[0]
        if sid not in allowed_ids:
            sid = allowed_ids[0]
        out.append({
            "id": f"s{i + 1}",
            "speaker_id": sid,
            "text": text[:400],
            "emotion": _pick_emotion(seg.get("emotion")),
            "intensity": round(_clamp(seg.get("intensity", 1.0), 0.0, 1.6, 1.0), 2),
            "style": apply_style_hint(seg.get("style")),
            "gesture": _pick_gesture(seg.get("gesture")),
            "pause_after_ms": int(_clamp(seg.get("pause_after_ms", 0), 0, 1500, 0)),
        })
    if not out:
        raise PlanError("plan contained no usable segments")
    return {"version": 1, "mode": mode, "segments": out}


def plan_performance(cfg, text: str, *, mode: str, speakers: List[Dict[str, Any]],
                     topic: bool = False, actions: bool = False) -> Dict[str, Any]:
    if not cfg.has_llm:
        raise MercuryError("INCEPTION_API_KEY is not configured")
    text = (text or "").strip()[:MAX_TEXT]
    if not text:
        raise PlanError("nothing to plan")

    system = system_prompt(mode, len(speakers))
    user = user_prompt(text, mode, speakers, topic)
    if actions:
        user = ("Assign ONE physical action (gesture) to every line, keeping the words exactly. "
                "Prefer body actions over talking: " + ", ".join(GESTURES) + ".\n\n" + user)
    last_error: Optional[Exception] = None
    for attempt in range(2):
        data = plan_once(cfg, system, user)
        try:
            plan = normalize(data, mode, speakers)
            plan["attempts"] = attempt + 1
            return plan
        except PlanError as exc:
            last_error = exc
            user = (user + f"\n\nYour previous reply was rejected: {exc}. "
                    "Reply again with only valid JSON, using the allowed ids.")
    raise PlanError(f"planner did not produce a valid plan: {last_error}")
