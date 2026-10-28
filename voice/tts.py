"""Speech providers.

`GeminiProvider` streams headerless 16-bit little-endian PCM (24 kHz, mono)
from Gemini TTS. Two engines are supported:

* ``generate`` (default, measured fastest): ``models.generate_content_stream``
  with ``response_modalities=["audio"]`` — this is the shape the working
  sample used; live probe gave ~1.1–1.4 s to first audio.
* ``interactions``: ``interactions.create(..., stream=True)`` with
  ``speech_metadata.style``. Slower in testing (~4.9 s), used only when a
  segment has a delivery style and ``GEMINI_TTS_ENGINE=interactions``.

`MockProvider` is a local tone generator for testing the pipeline; it only
runs when explicitly requested and is never presented as speech.

`OpenRouterProvider` is a stdlib-only fallback used when Gemini is unavailable;
`ChainProvider` tries Gemini first and then OpenRouter for each segment.
"""
from __future__ import annotations

import base64
import binascii
import json
import math
import struct
import time
import urllib.error
import urllib.request
from typing import Any, Iterator, List, Optional, Sequence

from config import ALL_VOICES
from config import OPENROUTER_TTS_MODELS as DEFAULT_OPENROUTER_TTS_MODELS
from config import TTS_MODELS as DEFAULT_TTS_MODELS

SAMPLE_RATE = 24000

# Hard ceiling on how many models one stream_pcm call may smoke through.
MAX_MODEL_ATTEMPTS = 4

# OpenRouter fallback limits: at most two model attempts per segment and a
# 30 second socket timeout for every request.
OPENROUTER_MAX_ATTEMPTS = 2
OPENROUTER_TIMEOUT = 30.0
_OPENROUTER_CHUNK = 16384

# Substrings that mark a quota / rate-limit rejection from the Gemini API.
_QUOTA_MARKERS = (
    "429",
    "resource_exhausted",
    "resource exhausted",
    "quota",
    "rate limit",
    "rate_limit",
    "too many requests",
)


def looks_like_quota(message: str) -> bool:
    low = (message or "").lower()
    return any(marker in low for marker in _QUOTA_MARKERS)


def looks_like_voice(message: str) -> bool:
    return "voice" in (message or "").lower()


class TTSError(RuntimeError):
    pass


def _extract_parts(chunk):
    """Return content parts from a streaming response chunk.

    google-genai has shipped both shapes:
      * chunk.parts                      (flattened convenience accessor)
      * chunk.candidates[0].content.parts (raw REST shape)
    Tolerate either, plus a fallback on chunk.content.
    """
    parts = getattr(chunk, "parts", None)
    if parts:
        return parts
    for cand in (getattr(chunk, "candidates", None) or []):
        content = getattr(cand, "content", None)
        if content is not None and getattr(content, "parts", None):
            return content.parts
    content = getattr(chunk, "content", None)
    if content is not None and getattr(content, "parts", None):
        return content.parts
    return []


class MockProvider:
    name = "mock"

    def __init__(self, chunk_seconds: float = 0.09, realtime: bool = False) -> None:
        self.chunk_seconds = max(0.02, chunk_seconds)
        self.realtime = realtime
        self.notes: list[str] = []

    def stream_pcm(self, text: str, style: Optional[str] = None,
                   voice: Optional[str] = None, model: Optional[str] = None,
                   engine: Optional[str] = None) -> Iterator[bytes]:
        words = max(1, len(text.split()))
        duration = max(0.9, min(6.0, 0.32 * words))
        per = int(SAMPLE_RATE * self.chunk_seconds)
        n_chunks = int(duration / self.chunk_seconds) + 1
        for c in range(n_chunks):
            buf = bytearray()
            for i in range(per):
                t = (c * per + i) / SAMPLE_RATE
                syl = 0.55 + 0.45 * math.sin(2 * math.pi * 3.3 * t)
                swell = 0.75 + 0.25 * math.sin(2 * math.pi * 0.33 * t)
                f0 = 122 + 7 * math.sin(2 * math.pi * 0.6 * t)
                v = (math.sin(2 * math.pi * f0 * t)
                     + 0.45 * math.sin(2 * math.pi * f0 * 2.1 * t)
                     + 0.07 * math.sin(2 * math.pi * 780 * t))
                v *= syl * swell * 0.22
                buf += struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32000))
            yield bytes(buf)
            if self.realtime:
                time.sleep(self.chunk_seconds)


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str, voice: str,
                 fallback_voice: str = "Kore", engine: str = "generate",
                 models: Optional[Sequence[str]] = None) -> None:
        try:
            from google import genai
            from google.genai import types
        except ImportError as exc:  # pragma: no cover
            raise TTSError(
                "google-genai is not installed. Run: "
                r"voice\.venv\Scripts\pip install -r voice\requirements.txt"
            ) from exc
        self._types = types
        self.client = genai.Client(api_key=api_key)
        self.model = model
        self.voice = voice
        self.fallback_voice = fallback_voice
        self.engine = engine
        self.models: List[str] = self._clean_models(models) or list(DEFAULT_TTS_MODELS)
        self.notes: list[str] = []

    @staticmethod
    def _clean_models(models: Optional[Sequence[str]]) -> List[str]:
        out: List[str] = []
        for m in models or []:
            name = (m or "").strip()
            if name and name not in out:
                out.append(name)
        return out

    def model_candidates(self, requested: Optional[str] = None) -> List[str]:
        """The ordered, de-duplicated model ladder for one request (<= 4)."""
        ladder = self._clean_models([requested or self.model] + list(self.models))
        return ladder[:MAX_MODEL_ATTEMPTS] or [requested or self.model]

    # ------------------------------------------------------------------ api
    def stream_pcm(self, text: str, style: Optional[str] = None,
                   voice: Optional[str] = None, model: Optional[str] = None,
                   engine: Optional[str] = None) -> Iterator[bytes]:
        """Stream PCM, walking an ordered model ladder on failure.

        Single non-recursive loop. For each model the requested voice is tried
        first and the fallback voice only when the API complains about the
        voice. A 429 / RESOURCE_EXHAUSTED (or any other failure) moves on to
        the next configured model, at most ``MAX_MODEL_ATTEMPTS`` models in
        total. Every attempt is appended to ``self.notes``; when nothing is
        left a ``TTSError`` is raised.
        """
        use_voice = voice or self.voice
        use_engine = engine or self.engine
        ladder = self.model_candidates(model)

        voices = [use_voice]
        if self.fallback_voice and self.fallback_voice != use_voice:
            voices.append(self.fallback_voice)

        tried: list[str] = []
        quota_seen = False
        last_msg = ""
        last_exc: Optional[BaseException] = None

        for mi, model_name in enumerate(ladder):
            for vi, voice_name in enumerate(voices):
                if vi > 0:
                    if not looks_like_voice(last_msg):
                        break
                    self.notes.append(
                        f'voice "{use_voice}" rejected — retried with "{voice_name}"')
                if vi == 0 and mi > 0:
                    self.notes.append(
                        f'model "{ladder[mi - 1]}" failed — trying "{model_name}" '
                        f'(attempt {mi + 1} of at most {len(ladder)})')
                try:
                    if use_engine == "interactions" and style:
                        yield from self._interactions(text, style, voice_name, model_name)
                    else:
                        yield from self._generate(text, voice_name, model_name)
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    last_msg = str(exc) or exc.__class__.__name__
                    is_quota = looks_like_quota(last_msg)
                    quota_seen = quota_seen or is_quota
                    tried.append(f"{model_name}/{voice_name}: {last_msg[:120]}")
                    self.notes.append(
                        f"attempt {len(tried)} failed on {model_name} "
                        f'(voice "{voice_name}")' + (" — quota" if is_quota else "")
                        + f": {last_msg[:120]}")
                    continue
                if mi > 0 or vi > 0:
                    self.notes.append(
                        f'spoken with "{model_name}" (voice "{voice_name}") after retry')
                return

        names = ", ".join(ladder)
        detail = " | ".join(tried[: len(ladder) * 2])
        if quota_seen:
            raise TTSError(
                f"Gemini TTS quota exhausted: 429 RESOURCE_EXHAUSTED on every "
                f"configured model ({names}) with voice "
                f'"{use_voice}"' + (f' or "{self.fallback_voice}"'
                                    if len(voices) > 1 else "") + f". {detail}"
            ) from last_exc
        raise TTSError(
            "Gemini TTS failed on every configured model (quota was not the "
            f"reported cause): tried {names}. {detail}") from last_exc

    def _generate(self, text: str, voice: str, model: str) -> Iterator[bytes]:
        types = self._types
        cfg = types.GenerateContentConfig(
            temperature=1,
            response_modalities=["audio"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))),
        )
        contents = [types.Content(role="user", parts=[types.Part.from_text(text=text)])]
        got = False
        for chunk in self.client.models.generate_content_stream(
                model=model, contents=contents, config=cfg):
            parts = _extract_parts(chunk)
            for part in parts:
                inline = getattr(part, "inline_data", None) or getattr(part, "inlineData", None)
                if not inline:
                    continue
                data = getattr(inline, "data", None)
                if not data:
                    continue
                got = True
                yield data if isinstance(data, bytes) else base64.b64decode(data)
        if not got:
            raise TTSError("Gemini returned no audio for this segment")

    def _interactions(self, text: str, style: str, voice: str, model: str) -> Iterator[bytes]:
        stream = self.client.interactions.create(
            model=model,
            input=[{"type": "user_input", "content": [{
                "type": "text", "text": text,
                "annotations": [{"type": "speech_metadata", "style": style}],
            }]}],
            response_format={"type": "audio", "mime_type": "audio/l16", "sample_rate": SAMPLE_RATE},
            generation_config={"speech_config": [{"voice": voice}]},
            stream=True,
        )
        got = False
        for event in stream:
            if getattr(event, "event_type", None) != "step.delta":
                continue
            delta = getattr(event, "delta", None)
            if delta is None or getattr(delta, "type", None) != "audio":
                continue
            data = getattr(delta, "data", None)
            if data:
                got = True
                yield base64.b64decode(data)
        if not got:
            raise TTSError("Gemini returned no audio for this segment")


class OpenRouterProvider:
    """OpenRouter text-to-speech fallback (stdlib only, no new deps).

    Calls ``POST {base}/audio/speech`` and normalises the result to headerless
    24 kHz mono s16le PCM. OpenRouter TTS backends are not perfectly uniform,
    so the response may be:

    * raw PCM / WAV bytes (``audio/*`` or ``application/octet-stream``),
    * a JSON envelope ``{"audio": "<base64>"}``,
    * a JSON envelope ``{"data": [{"b64_json": "<base64>"}]}``.

    MP3/OGG containers are rejected instead of being emitted as PCM garbage.
    Each model in the ladder is tried once, at most two attempts in total.
    """

    name = "openrouter"

    def __init__(self, api_key: str, base: str, models: Sequence[str],
                 voice: str = "alloy") -> None:
        self.api_key = api_key
        self.base = (base or "https://openrouter.ai/api/v1").rstrip("/")
        self.models: List[str] = (
            self._clean_models(models) or list(DEFAULT_OPENROUTER_TTS_MODELS))
        self.voice = voice or "alloy"
        self.notes: list[str] = []

    @staticmethod
    def _clean_models(models: Optional[Sequence[str]]) -> List[str]:
        out: List[str] = []
        for m in models or []:
            name = (m or "").strip()
            if name and name not in out:
                out.append(name)
        return out

    def _resolve_voice(self, voice: Optional[str]) -> str:
        """Keep a caller-supplied OpenRouter voice; ignore Gemini voice names.

        The voice service always has a Gemini voice configured (e.g. "Kore"),
        and the chain passes it through. Those names mean nothing to
        OpenRouter, so they map back to this provider's default voice.
        """
        candidate = (voice or "").strip()
        if not candidate:
            return self.voice
        if candidate in ALL_VOICES:
            return self.voice
        return candidate

    # Each backend expects its own voice vocabulary. Sending a Gemini name or
    # "alloy" to HeyGen is what produced a 404.
    # Only these names are known to work on the free tier; the HeyGen ones are
    # both female, so a male character must map to the neutral voice instead.
    VOICE_BY_MODEL = {
        "heygen/heygen-voice-1-turbo:free": "tabitha",
        "fish-audio/s2.1-pro-free:free": "alloy",
    }

    # Only these combinations actually answer on the free tier (probed):
    #   heygen -> Tabitha / nadine (female). No male voice works there.
    #   fish   -> only "alloy" (neutral); every other name returns HTTP 400.
    # So a female character must be served by heygen to get a female voice.
    OPENROUTER_VOICES = {
        "heygen/heygen-voice-1-turbo:free": {
            "female": ["Tabitha", "nadine"],
            "male": ["alloy"],
            "neutral": ["alloy"],
        },
        "fish-audio/s2.1-pro-free:free": {
            "female": ["alloy"],
            "male": ["alloy"],
            "neutral": ["alloy"],
        },
    }
    # names we will pass through verbatim when a caller asks for them
    KNOWN_OPENROUTER = {
        "sara", "tabitha", "nadine", "paul", "eve", "adrian",
        "energetic male", "alloy",
    }

    @staticmethod
    def _gender_of(voice_name: str) -> str:
        """Look up a Gemini voice's gender so it can be mapped correctly."""
        try:
            from config import VOICE_META
            meta = VOICE_META.get(voice_name)
            if isinstance(meta, tuple) and meta:
                return str(meta[0]).lower()
            if isinstance(meta, str):
                return meta.lower()
        except Exception:  # noqa: BLE001
            pass
        return ""

    def _voice_for(self, model: str, requested: str = "") -> str:
        req = (requested or "").strip()
        table = self.OPENROUTER_VOICES.get(model, {})
        # 1. an explicit OpenRouter voice name wins
        if req and req.lower() in self.KNOWN_OPENROUTER:
            return req
        # 2. a Gemini voice was passed through: match by gender, never cross it
        gender = self._gender_of(req)
        bucket = table.get(gender) or table.get("neutral") or []
        if bucket:
            return bucket[0]
        return table.get("neutral", ["alloy"])[0]

    # -------------------------------------------------------------- request
    def _fetch(self, text: str, voice: str, model: str) -> bytes:
        # OpenRouter accepts only "mp3" or "pcm" here (wav is rejected with a
        # ZodError). PCM is what we want; the real sample rate arrives in the
        # response Content-Type, e.g. "audio/pcm;rate=44100;channels=1".
        payload = {
            "model": model,
            "input": text,
            "voice": voice,
            "response_format": "pcm",
        }
        req = urllib.request.Request(
            f"{self.base}/audio/speech",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://127.0.0.1",
                "X-Title": "Inkwell Studio",
            },
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=OPENROUTER_TIMEOUT)
        try:
            headers = getattr(resp, "headers", None)
            content_type = ""
            if headers is not None and hasattr(headers, "get"):
                content_type = headers.get("Content-Type", "")
            if not content_type:
                getheader = getattr(resp, "getheader", None)
                if callable(getheader):
                    content_type = getheader("Content-Type") or ""
            body = resp.read()
        finally:
            close = getattr(resp, "close", None)
            if callable(close):
                close()
        if not isinstance(content_type, str):
            content_type = ""
        audio = self._extract_audio(body, content_type)
        return self._normalise_pcm(audio, content_type)

    @staticmethod
    def _decode_b64(value: str) -> bytes:
        raw = value.strip()
        if raw.startswith("data:") and "," in raw:
            raw = raw.split(",", 1)[1]
        try:
            return base64.b64decode(raw)
        except (binascii.Error, ValueError, TypeError) as exc:
            raise TTSError(
                f"openrouter returned invalid base64 audio: {exc}") from exc

    @staticmethod
    def _audio_from_json(payload: Any) -> Optional[bytes]:
        if not isinstance(payload, dict):
            return None
        audio = payload.get("audio")
        if isinstance(audio, str) and audio.strip():
            return OpenRouterProvider._decode_b64(audio)
        rows = payload.get("data")
        if isinstance(rows, dict):
            return OpenRouterProvider._audio_from_json(rows)
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict):
                    for key in ("b64_json", "audio"):
                        value = row.get(key)
                        if isinstance(value, str) and value.strip():
                            return OpenRouterProvider._decode_b64(value)
                elif isinstance(row, str) and row.strip():
                    return OpenRouterProvider._decode_b64(row)
        return None

    @staticmethod
    def _extract_audio(body: bytes, content_type: str) -> bytes:
        ctype = (content_type or "").split(";")[0].strip().lower()
        if ctype.startswith("audio/") or ctype == "application/octet-stream":
            return body
        stripped = body.lstrip()
        if stripped.startswith(b"{") or stripped.startswith(b"["):
            try:
                payload = json.loads(body.decode("utf-8"))
            except (ValueError, UnicodeDecodeError) as exc:
                raise TTSError(
                    f"openrouter returned an unreadable JSON envelope: {exc}") from exc
            audio = OpenRouterProvider._audio_from_json(payload)
            if audio is None:
                raise TTSError("openrouter JSON response contained no audio")
            return audio
        # Unknown/missing content type and not JSON: treat as raw audio.
        return body

    @staticmethod
    def _parse_wav(data: bytes) -> tuple:
        """Return (sample_rate, channels, bits, pcm_bytes) from a RIFF/WAVE blob.

        Walks the chunk list instead of assuming a 44-byte header: TTS services
        often add LIST/fact chunks, and the audio may be 44.1 kHz stereo. Taking
        the whole payload as 24 kHz mono is what made speech play at half speed.
        """
        if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            return (0, 0, 0, b"")
        pos = 12
        rate = channels = bits = 0
        pcm = b""
        while pos + 8 <= len(data):
            cid = data[pos:pos + 4]
            size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
            body_start = pos + 8
            body_end = min(len(data), body_start + size)
            if cid == b"fmt " and size >= 16:
                fmt = struct.unpack("<HHIIHH", data[body_start:body_start + 16])
                _tag, channels, rate, _byte_rate, _align, bits = fmt
            elif cid == b"data":
                pcm = data[body_start:body_end]
                pos = body_end + (size & 1)
                if pcm:
                    break
                continue
            pos = body_end + (size & 1)
        return (rate, channels, bits, pcm)

    @staticmethod
    def _resample_to_24k(pcm: bytes, rate: int, channels: int, bits: int) -> bytes:
        """Convert arbitrary PCM to 24 kHz mono s16le (what the client plays)."""
        if not pcm:
            return b""
        # decode to float mono in -1..1
        if bits == 16:
            n = len(pcm) // 2
            vals = struct.unpack("<%dh" % n, pcm[:n * 2])
            mono = [vals[i] / 32768.0 for i in range(0, n, max(1, channels))]
        elif bits == 8:
            vals = pcm
            mono = [(vals[i] - 128) / 128.0 for i in range(0, len(vals), max(1, channels))]
        elif bits == 32:
            n = len(pcm) // 4
            vals = struct.unpack("<%di" % n, pcm[:n * 4])
            mono = [vals[i] / 2147483648.0 for i in range(0, n, max(1, channels))]
        else:
            raise TTSError(f"openrouter WAV has unsupported bit depth {bits}")

        src_rate = rate or 24000
        if src_rate == SAMPLE_RATE:
            out = mono
        else:
            # linear interpolation resample
            ratio = SAMPLE_RATE / float(src_rate)
            out_len = max(1, int(len(mono) * ratio))
            out = [0.0] * out_len
            last = len(mono) - 1
            for i in range(out_len):
                pos = i / ratio
                i0 = int(pos)
                if i0 >= last:
                    out[i] = mono[last]
                else:
                    frac = pos - i0
                    out[i] = mono[i0] * (1 - frac) + mono[i0 + 1] * frac
        # back to s16le
        out = [max(-1.0, min(1.0, v)) for v in out]
        return struct.pack("<%dh" % len(out), *[int(v * 32767) for v in out])

    @staticmethod
    def _rate_from_ctype(content_type: str) -> tuple:
        """Parse "audio/pcm;rate=44100;channels=1" -> (44100, 1)."""
        rate, channels = 0, 1
        for part in (content_type or "").split(";"):
            part = part.strip().lower()
            if part.startswith("rate="):
                try:
                    rate = int(float(part[5:]))
                except ValueError:
                    pass
            elif part.startswith("channels="):
                try:
                    channels = int(float(part[9:]))
                except ValueError:
                    pass
        return (rate, max(1, channels))

    @staticmethod
    def _normalise_pcm(data: bytes, content_type: str = "") -> bytes:
        if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE":
            rate, channels, bits, pcm = OpenRouterProvider._parse_wav(data)
            if not pcm:
                raise TTSError(
                    "openrouter returned a WAV container with no PCM payload")
            return OpenRouterProvider._resample_to_24k(pcm, rate, channels, bits)
        if data[:3] == b"ID3" or data[:4] == b"OggS" or data[:4] == b"fLaC" or data[:3] == b"\xff\xfb":
            raise TTSError(
                "openrouter returned a compressed container; only PCM is supported")
        # Headerless PCM: the real rate comes from the Content-Type. Assuming
        # 24 kHz here is what made 44.1 kHz audio play at ~0.54x speed.
        rate, channels = OpenRouterProvider._rate_from_ctype(content_type)
        if rate and rate != SAMPLE_RATE:
            return OpenRouterProvider._resample_to_24k(data, rate, channels, 16)
        return data

    # ------------------------------------------------------------------ api
    def stream_pcm(self, text: str, style: Optional[str] = None,
                   voice: Optional[str] = None, model: Optional[str] = None,
                   engine: Optional[str] = None) -> Iterator[bytes]:
        """Yield PCM, walking the OpenRouter model ladder on failure.

        ``model`` is only used when it is an OpenRouter-style slug (contains
        "/", or is one of the configured models) so a Gemini model name from
        the chain is not sent to OpenRouter by mistake.
        """
        requested = (model or "").strip()
        if requested and (requested in self.models or "/" in requested):
            ladder = self._clean_models([requested] + list(self.models))
        else:
            ladder = list(self.models)
        ladder = ladder[:OPENROUTER_MAX_ATTEMPTS]
        if not ladder:  # pragma: no cover - __init__ guarantees a default
            raise TTSError("openrouter has no TTS models configured")

        use_voice = self._resolve_voice(voice)
        tried: list[str] = []
        last_exc: Optional[BaseException] = None

        for idx, model_name in enumerate(ladder):
            try:
                use_voice = self._voice_for(model_name, voice)
                pcm = self._fetch(text, use_voice, model_name)
                if not pcm:
                    raise TTSError("openrouter returned no audio")
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                msg = str(exc) or exc.__class__.__name__
                tried.append(f"{model_name}: {msg[:160]}")
                self.notes.append(
                    f"attempt {idx + 1} failed on {model_name} "
                    f"(openrouter): {msg[:160]}")
                continue
            if idx > 0:
                self.notes.append(
                    f'spoken with "{model_name}" via OpenRouter after retry')
            for start in range(0, len(pcm), _OPENROUTER_CHUNK):
                yield pcm[start:start + _OPENROUTER_CHUNK]
            return

        names = ", ".join(ladder)
        detail = " | ".join(tried)
        raise TTSError(
            "openrouter TTS failed on every configured model "
            f"({names}). {detail}") from last_exc


class ChainProvider:
    """Try providers in order; fall back to the next when one fails."""

    name = "chain"

    def __init__(self, providers: list) -> None:
        self.providers = [p for p in providers if p is not None]
        if not self.providers:
            raise TTSError("ChainProvider requires at least one provider")
        self.voice = getattr(self.providers[0], "voice", "alloy")
        self.notes: list[str] = []
        self._forwarded: dict[int, int] = {}
        # When a provider reports dead quota, skip it for a while so we don't
        # spend ~5s re-trying an exhausted key on every single line.
        self._skip_until: dict[int, float] = {}
        self.quota_cooldown = 120.0   # seconds

    def _is_quota_error(self, exc: BaseException) -> bool:
        msg = (str(exc) or "").lower()
        return ("quota" in msg or "429" in msg or "resource_exhausted" in msg
                or "resource exhausted" in msg or "rate limit" in msg)

    def _forward_notes(self, provider) -> None:
        notes = getattr(provider, "notes", None)
        if not isinstance(notes, list):
            return
        start = self._forwarded.get(id(provider), 0)
        if len(notes) > start:
            self.notes.extend(notes[start:])
            self._forwarded[id(provider)] = len(notes)

    def stream_pcm(self, text: str, style: Optional[str] = None,
                   voice: Optional[str] = None, model: Optional[str] = None,
                   engine: Optional[str] = None) -> Iterator[bytes]:
        errors: list[str] = []
        last_exc: Optional[BaseException] = None

        for idx, provider in enumerate(self.providers):
            pname = getattr(provider, "name", "provider")
            # honour an active cooldown from an earlier quota failure
            key = id(provider)
            until = self._skip_until.get(key, 0)
            if until and time.time() < until:
                remaining = int(until - time.time())
                self.notes.append(f"skipping {pname} ({remaining}s quota cooldown) — trying next")
                continue
            emitted = False
            try:
                for chunk in provider.stream_pcm(text, style, voice, model, engine):
                    if not chunk:
                        continue
                    emitted = True
                    yield chunk
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                msg = str(exc) or exc.__class__.__name__
                self._forward_notes(provider)
                self.notes.append(f"{pname} failed via chain: {msg[:200]}")
                if self._is_quota_error(exc):
                    self._skip_until[key] = time.time() + self.quota_cooldown
                    self.notes.append(
                        f"{pname} looks quota-exhausted — skipping it for "
                        f"{int(self.quota_cooldown)}s")
                errors.append(f"{pname}: {msg[:160]}")
                if emitted:
                    self.notes.append(
                        f"{pname} failed mid-stream after partial audio; "
                        "continuing with the next provider")
                continue
            self._forward_notes(provider)
            if idx > 0:
                self.notes.append(
                    f"spoken via {pname} after fallback from "
                    f"{getattr(self.providers[idx - 1], 'name', 'provider')}")
            return

        detail = " | ".join(errors)
        raise TTSError(
            "gemini and openrouter TTS both failed — no speech provider could "
            f"be used. {detail}") from last_exc


def build_provider(cfg, mock_realtime: bool = False):
    if cfg.mock:
        return MockProvider(chunk_seconds=cfg.chunk_seconds, realtime=mock_realtime)
    gemini = None
    openrouter = None
    if cfg.has_key:
        try:
            gemini = GeminiProvider(
                cfg.api_key, cfg.model, cfg.voice, cfg.fallback_voice, cfg.engine,
                models=getattr(cfg, "tts_models", None))
        except TTSError:
            # A broken/missing google-genai install must not disable the
            # OpenRouter fallback when that one is configured.
            if not getattr(cfg, "has_openrouter", False):
                raise
    if getattr(cfg, "has_openrouter", False):
        openrouter = OpenRouterProvider(
            cfg.openrouter_key, cfg.openrouter_base, cfg.openrouter_tts_models)
    if gemini is not None and openrouter is not None:
        return ChainProvider([gemini, openrouter])
    if gemini is not None:
        return gemini
    if openrouter is not None:
        return openrouter
    return None
