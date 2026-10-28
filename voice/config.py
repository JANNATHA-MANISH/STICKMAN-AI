"""Configuration for the local voice service.

Secrets come from the environment or `voice/.env` (git-ignored). The file is
read with utf-8-sig so a Windows BOM cannot corrupt the first key.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

BASE_DIR = Path(__file__).resolve().parent

# The 30 prebuilt voices listed in the docs, plus Fola which the live API
# accepted when tested with gemini-3.8-flash-lite-tts (see README).
PREBUILT_VOICES = [
    "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
    "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
    "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
    "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
    "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
]
VERIFIED_EXTRA_VOICES = {"Fola"}  # accepted by the live API in this project
ALL_VOICES = PREBUILT_VOICES + sorted(VERIFIED_EXTRA_VOICES)

# Ordered, bounded fallback ladder for speech synthesis. The first model that
# accepts the request wins; a 429 / RESOURCE_EXHAUSTED on one model walks the
# rest of this list (at most 4 attempts, see tts.MAX_MODEL_ATTEMPTS).
# Override with GEMINI_TTS_MODELS="a,b,c" (comma separated, order preserved).
TTS_MODELS = [
    "gemini-3.8-flash-tts",
    "gemini-3.8-flash-lite-tts",
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-pro-preview-tts",
]

# OpenRouter fallback ladder, tried only when Gemini TTS is unavailable
# (quota exhausted, every Gemini model failed, or no Gemini key at all).
# Override with OPENROUTER_TTS_MODELS="a,b" (comma separated).
OPENROUTER_TTS_MODELS = [
    "heygen/heygen-voice-1-turbo:free",
    "fish-audio/s2.1-pro-free:free",
]


def parse_model_list(value: Optional[str], default: Optional[List[str]] = None) -> List[str]:
    """Split a comma-separated env value into a de-duplicated model list."""
    models: List[str] = []
    for raw in (value or "").split(","):
        name = raw.strip().strip('"').strip("'")
        if name and name not in models:
            models.append(name)
    return models or list(default if default is not None else TTS_MODELS)


# Gender/tone metadata supplied by the product spec (used for grouping in the
# voice picker; the API itself does not classify voices).
VOICE_META = {
    "Achernar": ("female", "soft and warm"),
    "Achird": ("male", "friendly, lower-middle"),
    "Algenib": ("male", "gravelly, lower"),
    "Algieba": ("male", "smooth, lower"),
    "Alnilam": ("male", "firm, lower-middle"),
    "Aoede": ("female", "breezy, middle"),
    "Autonoe": ("female", "bright, middle"),
    "Callirrhoe": ("female", "easy-going, middle"),
    "Charon": ("male", "informative, lower"),
    "Despina": ("female", "smooth, middle"),
    "Enceladus": ("male", "breathy, lower"),
    "Erinome": ("female", "clear, middle"),
    "Fenrir": ("male", "excitable, lower-middle"),
    "Gacrux": ("female", "mature, middle"),
    "Iapetus": ("male", "clear, lower-middle"),
    "Kore": ("female", "firm, middle"),
    "Laomedeia": ("female", "upbeat, higher"),
    "Leda": ("female", "youthful, higher"),
    "Orus": ("male", "firm, lower-middle"),
    "Pulcherrima": ("male", "forward, middle"),
    "Puck": ("male", "upbeat, middle"),
    "Rasalgethi": ("male", "informative, middle"),
    "Sadachbia": ("male", "lively, lower"),
    "Sadaltager": ("male", "knowledgeable, middle"),
    "Schedar": ("male", "even, lower-middle"),
    "Sulafat": ("female", "warm, middle"),
    "Umbriel": ("male", "easy-going, lower-middle"),
    "Vindemiatrix": ("female", "gentle, middle"),
    "Zephyr": ("female", "bright, higher"),
    "Zubenelgenubi": ("male", "casual, lower-middle"),
    "Fola": ("female", "warm, mid — verified working"),
}


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


@dataclass
class Config:
    api_key: Optional[str]
    model: str
    voice: str
    fallback_voice: str
    port: int
    host: str
    mock: bool
    chunk_seconds: float
    inception_key: Optional[str] = None
    mercury_base: str = "https://api.inceptionlabs.ai/v1"
    mercury_model: str = "mercury-3"
    engine: str = "generate"          # generate | interactions
    mode: str = "single"
    # Ordered fallback ladder of TTS models (GEMINI_TTS_MODELS or TTS_MODELS).
    tts_models: List[str] = field(default_factory=lambda: list(TTS_MODELS))
    # OpenRouter TTS — used as a fallback when Gemini is unavailable.
    openrouter_key: Optional[str] = None
    openrouter_base: str = "https://openrouter.ai/api/v1"
    openrouter_tts_models: List[str] = field(
        default_factory=lambda: list(OPENROUTER_TTS_MODELS))

    @property
    def has_key(self) -> bool:
        return bool(self.api_key)

    @property
    def has_openrouter(self) -> bool:
        return bool(self.openrouter_key)

    @property
    def has_llm(self) -> bool:
        return bool(self.inception_key)

    @property
    def voice_known(self) -> bool:
        return self.voice in ALL_VOICES

    @property
    def provider(self) -> str:
        if self.mock:
            return "mock"
        return "gemini" if self.has_key else "unconfigured"

    def health(self) -> Dict[str, object]:
        return {
            "ok": True,
            "provider": self.provider,
            "model": self.model,
            "voice": self.voice,
            "voiceKnown": self.voice_known,
            "fallbackVoice": self.fallback_voice,
            "sampleRate": 24000,
            "mock": self.mock,
            "engine": self.engine,
            "models": list(self.tts_models or TTS_MODELS),
            "voices": ALL_VOICES,
            "voiceMeta": {v: {"gender": g, "tone": t} for v, (g, t) in VOICE_META.items()},
            "llm": {
                "configured": self.has_llm,
                "model": self.mercury_model,
                "base": self.mercury_base,
            },
            "openrouter": {
                "configured": self.has_openrouter,
                "models": list(self.openrouter_tts_models or OPENROUTER_TTS_MODELS),
            },
            "mode": self.mode,
            "note": self.voice_note(),
        }

    def voice_note(self) -> str:
        if self.mock:
            return "mock tone generator — no speech model is used"
        if not self.has_key:
            if self.has_openrouter:
                return ("GEMINI_API_KEY is not configured — speech falls back to "
                        "OpenRouter TTS (expressions still work)")
            return "GEMINI_API_KEY is not configured — speech is disabled (expressions still work)"
        if not self.voice_known:
            return (f'"{self.voice}" is not in the voice list; if the API rejects it the service '
                    f'falls back to "{self.fallback_voice}" and tells the client')
        return ""


def load_config(argv_mock: bool = False) -> Config:
    load_dotenv(BASE_DIR / ".env")
    load_dotenv(BASE_DIR.parent / ".env")
    mock = argv_mock or os.environ.get("STICK_TTS_MOCK", "").lower() in {"1", "true", "yes"}
    primary = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts")
    return Config(
        api_key=os.environ.get("GEMINI_API_KEY") or None,
        model=primary,
        voice=os.environ.get("GEMINI_TTS_VOICE", "Kore"),
        fallback_voice=os.environ.get("GEMINI_FALLBACK_VOICE", "Kore"),
        port=int(os.environ.get("VOICE_PORT", "8765")),
        host=os.environ.get("VOICE_HOST", "127.0.0.1"),
        mock=mock,
        chunk_seconds=float(os.environ.get("STICK_TTS_CHUNK", "0.09")),
        inception_key=os.environ.get("INCEPTION_API_KEY") or None,
        mercury_base=os.environ.get("MERCURY_BASE_URL", "https://api.inceptionlabs.ai/v1"),
        mercury_model=os.environ.get("MERCURY_MODEL", "mercury-3"),
        engine=os.environ.get("GEMINI_TTS_ENGINE", "generate"),
        mode=os.environ.get("COMPANION_MODE", "single"),
        tts_models=parse_model_list(
            os.environ.get("GEMINI_TTS_MODELS"),
            # the configured primary model is tried first, then the rest
            [primary] + [m for m in TTS_MODELS if m != primary],
        ),
        openrouter_key=os.environ.get("OPENROUTER_API_KEY") or None,
        openrouter_base=os.environ.get("OPENROUTER_BASE", "https://openrouter.ai/api/v1"),
        openrouter_tts_models=parse_model_list(
            os.environ.get("OPENROUTER_TTS_MODELS"), OPENROUTER_TTS_MODELS),
    )
