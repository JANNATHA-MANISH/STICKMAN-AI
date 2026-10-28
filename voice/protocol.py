"""Parse text/plans into validated speech segments + animation metadata.

Two inputs are supported:

* free text with inline cues — `<laughs>`, `[whispers]`, `<short pause>` …
* structured `segments` produced by the Mercury planner

Only `text` is ever spoken. Sonic cues the model understands stay inline;
animation-only or unknown cues are stripped and reported.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

MAX_TEXT = 4000
MAX_SEGMENTS = 12

EMOTIONS = [
    "neutral", "happy", "ecstatic", "laughing", "love", "proud",
    "surprised", "scared", "worried", "concerned", "confused", "thinking",
    "sad", "crying", "bored", "sleepy", "angry", "disgusted", "embarrassed",
]

GESTURES = [
    "wave", "nod", "cough", "clapOnce", "shrugOnce", "scratchHead", "bow",
    "hopJoy", "facepalm", "stretchYawn", "thinkChin", "victory", "phoneCall",
    "coolLean", "head_tilt", "head_nod",
    "run", "fight", "handshake", "dance", "beat",
    "slap", "kick", "hug", "kiss",
]


def _alias_key(value: Any) -> str:
    """Normalise a model-chosen word for alias lookup.

    ``"Wave_Hand"`` / ``"wave-hand"`` / ``"wave hand"`` all become
    ``"wave hand"`` so the alias tables below match every spelling.
    """
    return re.sub(r"\s+", " ", str(value or "").strip().lower()
                  .replace("_", " ").replace("-", " "))


# Model-chosen words that are close to a canonical emotion but are not in
# EMOTIONS. These are resolved before the unknown-emotion warning, so a
# segment keeps its intended expression instead of silently becoming neutral.
# Keys are normalised by `_alias_key`; values MUST be members of EMOTIONS.
EMOTION_ALIASES: Dict[str, str] = {
    "confident": "proud",
    "assertive": "proud",
    "enthusiastic": "ecstatic",
    "curious": "thinking",
    "thoughtful": "thinking",
    "calm": "neutral",
    "serious": "neutral",
    "friendly": "happy",
    "excited": "ecstatic",
    "nervous": "worried",
    "unsure": "confused",
    "amazed": "surprised",
    "delighted": "happy",
    "thrilled": "ecstatic",
    "annoyed": "angry",
    "frustrated": "angry",
    "saddened": "sad",
    "afraid": "scared",
    "tired": "sleepy",
    "singing": "happy",
}

# Same idea for gestures. Canonical names are checked first, so entries whose
# key is already a GESTURE (e.g. "head_nod") are only a safety net.
# Values MUST be members of GESTURES; "point" is intentionally absent because
# it is not a canonical gesture.
GESTURE_ALIASES: Dict[str, str] = {
    "wave_hand": "wave",
    "waving": "wave",
    "head_nod": "nod",
    "nodding": "nod",
    "shrug": "shrugOnce",
    "clap": "clapOnce",
    "think": "thinkChin",
    "thinking": "thinkChin",
    "scratch_head": "scratchHead",
    "stretch": "stretchYawn",
    "yawn": "stretchYawn",
    "hand_shake": "handshake",
}

_EMOTION_ALIAS_LOOKUP = {_alias_key(k): v for k, v in EMOTION_ALIASES.items()}
_GESTURE_ALIAS_LOOKUP = {_alias_key(k): v for k, v in GESTURE_ALIASES.items()}

# Inline cues Gemini TTS understands (kept in the spoken text so the model
# performs them) -> animation side effect.
SONIC_TAGS = {
    "laughs": ("laugh", "laughing", None),
    "laugh": ("laugh", "laughing", None),
    "soft laugh": ("laugh", "laughing", None),
    "sighs": ("sigh", "sad", None),
    "sigh": ("sigh", "sad", None),
    "coughs": ("cough", None, "cough"),
    "cough": ("cough", None, "cough"),
    "gasp": ("gasp", "surprised", None),
    "whisper": ("whisper", None, None),
    "whispers": ("whisper", None, None),
    "whispering": ("whisper", None, None),
    "breath": ("breath", None, None),
    "short pause": ("pause", None, None),
    "long pause": ("pause", None, None),
    "slow": ("rate", None, None),
    "very slow": ("rate", None, None),
    "fast": ("rate", None, None),
    "sing": ("sing", None, None),
    "singing": ("sing", None, None),
    "sings": ("sing", None, None),
}

# Textual aliases that are *not* spoken and only affect animation.
ANIMATION_ALIASES = {
    "smiles": ("happy", None),
    "grins": ("happy", None),
    "frowns": ("sad", None),
    "excited": ("ecstatic", None),
    "joyful": ("happy", None),
    "angry": ("angry", None),
    "sad": ("sad", None),
    "happy": ("happy", None),
    "surprised": ("surprised", None),
    "thinking": ("thinking", None),
    "confused": ("confused", None),
    "worried": ("worried", None),
    "wave": (None, "wave"),
    "waves": (None, "wave"),
    "nod": (None, "nod"),
    "nods": (None, "nod"),
    "bow": (None, "bow"),
    "shrug": (None, "shrugOnce"),
    "clap": (None, "clapOnce"),
    "point": (None, None),
}

PAUSE_MS = {"short pause": 450, "long pause": 1400}

# Canonical spelling passed to the speech model (the form its docs use).
SONIC_CANON = {
    "laugh": "[laughs]", "laughs": "[laughs]", "soft laugh": "[laughs]",
    "sigh": "[sighs]", "sighs": "[sighs]",
    "cough": "[coughs]", "coughs": "[coughs]",
    "gasp": "[gasp]",
    "whisper": "[whispers]", "whispers": "[whispers]", "whispering": "[whispers]",
    "breath": "[breath]",
}

TAG_RE = re.compile(r"[\[<]([A-Za-z_][A-Za-z_ .,'-]{0,32})[\]>]")

STYLE_HINTS = {
    "cheerful": "cheerful and friendly",
    "warm": "warm and enthusiastic",
    "calm": "calm and relaxed",
    "whisper": "whispering, tense",
    "sarcastic": "dry and sarcastic",
    "energetic": "fast-paced and energetic",
    "slow": "slow, measured, and deliberate",
    "sad": "soft and downcast",
    "angry": "tense and clipped",
}


@dataclass
class Segment:
    text: str
    emotion: str = "neutral"
    intensity: float = 1.0
    gesture: Optional[str] = None
    style: Optional[str] = None
    speaker_id: Optional[str] = None
    voice: Optional[str] = None
    model: Optional[str] = None
    pause_after_ms: int = 0
    vocal_events: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Plan:
    segments: List[Segment] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {"segments": [s.to_dict() for s in self.segments], "warnings": self.warnings}


def _clamp(v: Any, lo: float, hi: float, default: float) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, f))


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _norm_tag(tag: str) -> str:
    return _clean(tag).lower().replace("_", " ")


def _resolve_emotion(value: Any) -> Optional[str]:
    """Return a canonical emotion for *value*, or ``None`` if unresolvable.

    Canonical names win; otherwise EMOTION_ALIASES is consulted. Callers warn
    only when this returns ``None``, so an aliased word never warns.
    """
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s in EMOTIONS:
        return s
    mapped = _EMOTION_ALIAS_LOOKUP.get(_alias_key(s))
    if mapped in EMOTIONS:
        return mapped
    return None


def _resolve_gesture(value: Any) -> Optional[str]:
    """Return a canonical gesture for *value*, or ``None`` if unresolvable."""
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s in GESTURES:
        return s
    mapped = _GESTURE_ALIAS_LOOKUP.get(_alias_key(s))
    if mapped in GESTURES:
        return mapped
    return None


def apply_style_hint(style: Optional[str]) -> Optional[str]:
    if not style:
        return None
    s = str(style).strip()
    for key, mapped in STYLE_HINTS.items():
        if key in s.lower():
            return mapped
    return s[:60]


def parse_text(text: str, *, emotion: str = "neutral", intensity: float = 1.0,
               gesture: Optional[str] = None, style: Optional[str] = None,
               speaker_id: Optional[str] = None, voice: Optional[str] = None,
               model: Optional[str] = None) -> Plan:
    """Split tagged text into segments.

    Only emotion/gesture changes and pauses start a new segment; sonic cues
    such as `[laughs]` stay inside the sentence so the model performs them.
    """
    plan = Plan()
    raw = (text or "")[:MAX_TEXT]
    if not raw.strip():
        plan.warnings.append("empty text")
        return plan

    cur_emotion = _resolve_emotion(emotion) or "neutral"
    cur_gesture = _resolve_gesture(gesture)
    cur_style = apply_style_hint(style)
    cur_intensity = _clamp(intensity, 0.0, 1.6, 1.0)
    buf: List[str] = []
    pending_pause = 0
    pending_events: List[str] = []

    def flush() -> None:
        nonlocal buf, pending_pause, pending_events
        chunk = _clean("".join(buf))
        buf = []
        if not chunk:
            return
        if plan.segments and pending_pause:
            plan.segments[-1].pause_after_ms = pending_pause
        pending_pause = 0
        seg = Segment(
            text=chunk, emotion=cur_emotion, intensity=cur_intensity,
            gesture=cur_gesture, style=cur_style, speaker_id=speaker_id,
            voice=voice, model=model, pause_after_ms=0,
        )
        if pending_events:
            seg.vocal_events = pending_events[:]
            pending_events = []
        plan.segments.append(seg)

    cursor = 0
    for m in TAG_RE.finditer(raw):
        buf.append(raw[cursor:m.start()])
        cursor = m.end()
        tag = _norm_tag(m.group(1))
        original = m.group(0)

        if tag in EMOTIONS:
            flush()
            cur_emotion = tag
            continue
        if tag in GESTURES:
            flush()
            cur_gesture = tag
            continue
        if tag in SONIC_TAGS:
            kind, emo, gest = SONIC_TAGS[tag]
            if kind == "pause":
                flush()
                if plan.segments:
                    plan.segments[-1].pause_after_ms = PAUSE_MS.get(tag, 450)
                else:
                    pending_pause = PAUSE_MS.get(tag, 450)
                continue
            if kind == "rate":
                continue
            if kind == "sing":
                cur_style = "sung, melodic"
                continue
            buf.append(" " + SONIC_CANON.get(tag, original) + " ")   # keep for the model
            if emo:
                cur_emotion = emo
            if gest:
                cur_gesture = gest
            if plan.segments:
                plan.segments[-1].vocal_events.append(kind)
            else:
                pending_events.append(kind)
            continue
        if tag in ANIMATION_ALIASES:
            flush()
            emo, gest = ANIMATION_ALIASES[tag]
            if emo:
                cur_emotion = emo
            if gest:
                cur_gesture = gest
            continue
        resolved_emotion = _resolve_emotion(tag)
        if resolved_emotion:
            flush()
            cur_emotion = resolved_emotion
            continue
        resolved_gesture = _resolve_gesture(tag)
        if resolved_gesture:
            flush()
            cur_gesture = resolved_gesture
            continue
        plan.warnings.append(f'unknown cue "{original}" ignored')

    buf.append(raw[cursor:])
    flush()

    if plan.segments:
        plan.segments[-1].pause_after_ms = pending_pause
    if not plan.segments:
        plan.warnings.append("text contained only cues")
    return plan


def parse_segments(segments: List[Dict[str, Any]], *, emotion: str = "neutral",
                   intensity: float = 1.0, style: Optional[str] = None,
                   speaker_ids: Optional[List[str]] = None) -> Plan:
    plan = Plan()
    allowed = set(speaker_ids or [])
    for i, rawseg in enumerate(segments[:MAX_SEGMENTS]):
        if not isinstance(rawseg, dict):
            plan.warnings.append(f"segment {i} is not an object — skipped")
            continue
        text = _clean(str(rawseg.get("text", "")))
        if not text:
            continue
        emo = rawseg.get("emotion") or emotion
        resolved_emo = _resolve_emotion(emo)
        if resolved_emo is None:
            plan.warnings.append(f'segment {i}: unknown emotion "{emo}" → neutral')
            emo = "neutral"
        else:
            emo = resolved_emo
        gest = rawseg.get("gesture")
        if gest:
            resolved_gest = _resolve_gesture(gest)
            if resolved_gest is None:
                plan.warnings.append(f'segment {i}: unknown gesture "{gest}" ignored')
            gest = resolved_gest
        sid = rawseg.get("speaker_id")
        if allowed and sid and sid not in allowed:
            plan.warnings.append(f'segment {i}: unknown speaker "{sid}" — using default')
            sid = None
        plan.segments.append(Segment(
            text=text,
            emotion=emo,
            intensity=_clamp(rawseg.get("intensity", intensity), 0.0, 1.6, 1.0),
            gesture=gest,
            style=apply_style_hint(rawseg.get("style") or style),
            speaker_id=sid or (speaker_ids[0] if speaker_ids else None),
            voice=rawseg.get("voice"),
            model=rawseg.get("model"),
            pause_after_ms=int(_clamp(rawseg.get("pause_after_ms", 0), 0, 3000, 0)),
            vocal_events=[v for v in (rawseg.get("vocal_events") or [])
                          if isinstance(v, str)][:6],
        ))
    if not plan.segments:
        plan.warnings.append("no speakable text in segments")
    return plan


def parse_response(text: str = "", segments: Optional[List[Dict[str, Any]]] = None,
                   emotion: str = "neutral", intensity: float = 1.0,
                   gesture: Optional[str] = None, style: Optional[str] = None,
                   speaker_id: Optional[str] = None, voice: Optional[str] = None,
                   model: Optional[str] = None,
                   speaker_ids: Optional[List[str]] = None) -> Plan:
    if segments:
        return parse_segments(segments, emotion=emotion, intensity=intensity,
                              style=style, speaker_ids=speaker_ids)
    return parse_text(text, emotion=emotion, intensity=intensity, gesture=gesture,
                      style=style, speaker_id=speaker_id, voice=voice, model=model)
