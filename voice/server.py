"""Local voice + performance service for the stick companion studio.

    POST /api/speak   text or plan → framed stream (JSON events + PCM)
    POST /api/plan    text → validated Mercury performance plan (no audio)
    GET  /health      provider, models, voices, LLM status

Frame format: 1 byte kind ('J' JSON, 'A' PCM s16le mono 24 kHz), 4-byte
big-endian length, payload. Chunked HTTP; every JSON event carries `seq`.
"""
from __future__ import annotations

import argparse
import json
import socket
import struct
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List

from config import load_config
from mercury import MercuryError
from planner import PlanError, plan_performance
from director import plan_action
from scene import make_scene
from protocol import EMOTIONS, GESTURES, parse_response
from tts import SAMPLE_RATE, TTSError, build_provider

MAX_BODY = 128 * 1024


def frame(kind: str, payload: bytes) -> bytes:
    return kind.encode("ascii") + struct.pack(">I", len(payload)) + payload


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "stick-voice/2.0"

    # ------------------------------------------------------------- plumbing
    def handle(self):
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def log_message(self, fmt, *args):
        sys.stderr.write("[voice] " + (fmt % args) + "\n")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return None, "invalid body size"
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            return None, f"invalid JSON: {exc}"
        if not isinstance(body, dict):
            return None, "body must be an object"
        return body, None

    # ---------------------------------------------------------------- routes
    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/health":
            cfg = self.server.cfg  # type: ignore[attr-defined]
            payload = cfg.health()
            payload.update({
                "emotions": EMOTIONS,
                "gestures": GESTURES,
                "sdk": self.server.sdk_version,  # type: ignore[attr-defined]
                "activeVoiceProvider": getattr(self.server, "active_voice", None),  # type: ignore[attr-defined]
            })
            self._json(200, payload)
            return
        if path == "/api/voices":
            self._json(200, {"ok": True, "voices": self._voice_catalog()})
            return
        self._json(404, {"ok": False, "error": "not found"})

    # ------------------------------------------------------------- voices
    def _voice_catalog(self):
        """Every usable voice, tagged with provider and gender.

        Gemini voices come from config.VOICE_META. The OpenRouter TTS models on
        the free tier only expose a few names; we tag them honestly so a male
        character never silently gets a female voice.
        """
        from config import VOICE_META
        out = []
        for name, meta in VOICE_META.items():
            gender, tone = (meta + ("", ""))[:2] if isinstance(meta, tuple) else (str(meta), "")
            out.append({
                "id": name, "provider": "gemini",
                "gender": (gender or "unknown").lower(),
                "tone": tone or "",
            })
        # `verified` = this name actually answered on the free tier when probed.
        # Unverified names are still offered (they may work on a paid key) but
        # routing prefers verified ones so audio keeps working.
        or_voices = [
            ("Tabitha", "female", "warm, articulate", "heygen/heygen-voice-1-turbo:free", True),
            ("nadine", "female", "bright, mid-high", "heygen/heygen-voice-1-turbo:free", True),
            ("Sara", "female", "clear, bright", "heygen/heygen-voice-1-turbo:free", False),
            ("Paul", "male", "steady, lower", "heygen/heygen-voice-1-turbo:free", False),
            ("alloy", "neutral", "balanced, mid", "fish-audio/s2.1-pro-free:free", True),
            ("eve", "female", "soft, mid", "fish-audio/s2.1-pro-free:free", False),
            ("Adrian", "male", "friendly, casual American", "fish-audio/s2.1-pro-free:free", False),
            ("Energetic Male", "male", "energetic, forward", "fish-audio/s2.1-pro-free:free", False),
        ]
        for vid, gender, tone, model, verified in or_voices:
            out.append({
                "id": vid, "provider": "openrouter", "model": model,
                "gender": gender, "tone": tone, "verified": verified,
            })
        return out

    def do_POST(self):  # noqa: N802
        path = self.path.split("?")[0]
        if path not in ("/api/speak", "/api/plan", "/api/scene", "/api/config", "/api/action"):
            self._json(404, {"ok": False, "error": "not found"})
            return
        body, err = self._read_json()
        if err:
            self._json(400, {"ok": False, "error": err})
            return
        if path == "/api/plan":
            self._plan(body)
        elif path == "/api/scene":
            self._scene(body)
        elif path == "/api/config":
            self._config(body)
        elif path == "/api/action":
            self._action(body)
        else:
            self._speak(body)

    # ---------------------------------------------------------------- action
    def _action(self, body: Dict[str, Any]):
        cfg = self._cfg_for(body)
        prompt = str(body.get("prompt", "")).strip()
        if not prompt:
            self._json(400, {"ok": False, "error": "empty prompt"})
            return
        if not cfg.has_llm:
            self._json(503, {"ok": False, "error": "INCEPTION_API_KEY is not configured"})
            return
        # Solo and room are different performances: tell the director which,
        # and give it the real cast so it never invents its own names.
        mode = str(body.get("mode") or "single")
        names = [str(s.get("name")) for s in (body.get("speakers") or []) if s.get("name")]
        if mode == "podcast":
            cast = ", ".join(names[:2]) if len(names) >= 2 else "two people"
            prompt = (f"[ROOM: two people are on stage, named {cast}. They must talk to "
                      f"each other, alternating the speaker. Give every beat a \"speaker\" "
                      f"that is exactly one of: {cast}.]\n" + prompt)
        else:
            who = names[0] if names else "the performer"
            prompt = (f"[SOLO: exactly one person is on stage, named {who}. They perform "
                      f"alone and never address a second character. Set every beat's "
                      f"\"speaker\" to {who}.]\n" + prompt)
        try:
            plan = plan_action(cfg, prompt)
        except MercuryError as exc:
            self._json(502, {"ok": False, "error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001
            self._json(422, {"ok": False, "error": str(exc)})
            return
        self._json(200, {"ok": True, "action": plan})

    # ----------------------------------------------------------------- plan
    def _plan(self, body: Dict[str, Any]):
        cfg = self._cfg_for(body)
        if not cfg.has_llm:
            self._json(503, {
                "ok": False,
                "error": "INCEPTION_API_KEY is not configured",
                "hint": "add it to stick/voice/.env to use Speak with actions",
            })
            return
        text = str(body.get("text", "")).strip()
        if not text:
            self._json(400, {"ok": False, "error": "empty text"})
            return
        mode = "podcast" if body.get("mode") == "podcast" else "single"
        speakers = body.get("speakers") or [{"id": "companion", "name": "Companion"}]
        if not isinstance(speakers, list) or not speakers:
            self._json(400, {"ok": False, "error": "speakers must be a non-empty list"})
            return
        if mode == "podcast" and len(speakers) < 2:
            self._json(400, {"ok": False, "error": "podcast mode needs at least 2 speakers"})
            return
        try:
            plan = plan_performance(cfg, text, mode=mode, speakers=speakers,
                                    topic=bool(body.get("topic")),
                                    actions=bool(body.get("actions")))
        except MercuryError as exc:
            self._json(502, {"ok": False, "error": str(exc)})
            return
        except PlanError as exc:
            self._json(422, {"ok": False, "error": str(exc)})
            return
        self._json(200, {"ok": True, "plan": plan})

    # ---------------------------------------------------------------- scene
    def _scene(self, body: Dict[str, Any]):
        cfg = self._cfg_for(body)
        prompt = str(body.get("prompt", "")).strip()
        if not prompt:
            self._json(400, {"ok": False, "error": "empty prompt"})
            return
        if not cfg.has_llm:
            self._json(503, {"ok": False, "error": "INCEPTION_API_KEY is not configured"})
            return
        try:
            spec = make_scene(cfg, prompt)
        except MercuryError as exc:
            self._json(502, {"ok": False, "error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001
            self._json(422, {"ok": False, "error": str(exc)})
            return
        self._json(200, {"ok": True, "scene": spec})


    # ---------------------------------------------------------------- config
    def _config(self, body: Dict[str, Any]):
        """Save API keys to voice/.env (local only) and reload config."""
        from pathlib import Path
        cfg_path = Path(__file__).resolve().parent / ".env"
        lines = []
        if cfg_path.is_file():
            lines = cfg_path.read_text(encoding="utf-8-sig").splitlines()
        wanted = {
            "GEMINI_API_KEY": body.get("geminiKey"),
            "INCEPTION_API_KEY": body.get("inceptionKey"),
        }
        out = []
        seen = set()
        for line in lines:
            key = line.split("=", 1)[0].strip() if "=" in line else None
            if key in wanted and wanted[key]:
                out.append(f"{key}={wanted[key]}")
                seen.add(key)
            else:
                out.append(line)
        for key, val in wanted.items():
            if val and key not in seen:
                out.append(f"{key}={val}")
        cfg_path.write_text("\n".join(out) + "\n", encoding="utf-8")
        from config import load_config
        new_cfg = load_config()
        self.server.cfg = new_cfg  # type: ignore[attr-defined]
        from tts import build_provider
        self.server.provider = build_provider(new_cfg)  # type: ignore[attr-defined]
        self._json(200, {"ok": True, "health": new_cfg.health()})

    # ---------------------------------------------------------------- speak
    def _provider_for(self, body: Dict[str, Any]):
        cfg = self.server.cfg  # type: ignore[attr-defined]
        p = body.get("provider") or {}
        key = p.get("geminiKey") or cfg.api_key
        if not key:
            # No Gemini key: an OpenRouter-only setup can still speak via the
            # already-built chain/provider, so don't reject here.
            if getattr(cfg, "has_openrouter", False) or self.server.provider is not None:
                return self.server.provider  # type: ignore[attr-defined]
            return None
        model = p.get("model") or cfg.model
        voice = p.get("voice") or cfg.voice
        if p.get("geminiKey") and p["geminiKey"] != cfg.api_key:
            from tts import GeminiProvider
            return GeminiProvider(key, model, voice, cfg.fallback_voice, cfg.engine,
                                  models=getattr(cfg, "tts_models", None))
        return self.server.provider  # type: ignore[attr-defined]

    def _cfg_for(self, body: Dict[str, Any]):
        cfg = self.server.cfg  # type: ignore[attr-defined]
        p = body.get("provider") or {}
        if not p:
            return cfg
        from dataclasses import replace
        return replace(
            cfg,
            inception_key=p.get("llmKey") or cfg.inception_key,
            mercury_base=p.get("llmBase") or cfg.mercury_base,
            mercury_model=p.get("llmModel") or cfg.mercury_model,
        )

    def _speak(self, body: Dict[str, Any]):
        cfg = self.server.cfg  # type: ignore[attr-defined]
        provider = self._provider_for(body)
        speakers = body.get("speakers") if isinstance(body.get("speakers"), list) else None
        speaker_ids = [str(s.get("id")) for s in speakers] if speakers else None
        plan = parse_response(
            text=str(body.get("text", "")),
            segments=body.get("segments"),
            emotion=body.get("emotion", "neutral"),
            intensity=body.get("intensity", 1.0),
            gesture=body.get("gesture"),
            style=body.get("style"),
            voice=body.get("voice"),
            model=body.get("model"),
            speaker_ids=speaker_ids,
        )
        if not plan.segments:
            self._json(400, {"ok": False, "error": "no speakable text",
                             "warnings": plan.warnings})
            return
        if provider is None:
            self._json(503, {
                "ok": False,
                "error": "GEMINI_API_KEY is not configured",
                "hint": "put GEMINI_API_KEY in stick/voice/.env, or run with --mock",
                "warnings": plan.warnings,
            })
            return
        self._stream(plan, provider, cfg, body)

    def _stream(self, plan, provider, cfg, body):
        t0 = time.perf_counter()
        seq = 0
        audio_bytes = 0
        cancelled = False
        default_voice = body.get("voice") or getattr(provider, "voice", cfg.voice)
        default_model = body.get("model") or cfg.model
        speaker_ids = [s.get("id") for s in body.get("speakers", [])
                       if isinstance(s, dict) and s.get("id")] or ["companion"]
        default_speaker = speaker_ids[0]

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True

        def write_chunk(data: bytes) -> bool:
            nonlocal cancelled
            try:
                self.wfile.write(b"%X\r\n" % len(data) + data + b"\r\n")
                self.wfile.flush()
                return True
            except (BrokenPipeError, ConnectionResetError, socket.timeout, OSError):
                cancelled = True
                return False

        def event(payload: dict) -> bool:
            nonlocal seq
            payload = dict(payload)
            payload["seq"] = seq
            seq += 1
            return write_chunk(frame("J", json.dumps(payload).encode("utf-8")))

        if not event({
            "type": "start",
            "provider": getattr(provider, "name", "gemini"),
            "voice": default_voice,
            "model": default_model,
            "sampleRate": SAMPLE_RATE,
            "channels": 1,
            "bits": 16,
            "mode": body.get("mode", "single"),
            "segments": [s.to_dict() for s in plan.segments],
            "warnings": plan.warnings,
        }):
            return
        for warning in plan.warnings:
            if not event({"type": "notice", "message": warning}):
                return

        try:
            for idx, seg in enumerate(plan.segments):
                if cancelled:
                    break
                voice = seg.voice or default_voice
                model = seg.model or default_model
                if not event({
                    "type": "segment",
                    "index": idx,
                    "speaker_id": seg.speaker_id or default_speaker,
                    "text": seg.text,
                    "emotion": seg.emotion,
                    "intensity": seg.intensity,
                    "gesture": seg.gesture,
                    "style": seg.style,
                    "voice": voice,
                    "model": model,
                    "pause_after_ms": seg.pause_after_ms,
                    "atMs": round((time.perf_counter() - t0) * 1000, 1),
                }):
                    break
                try:
                    for pcm in provider.stream_pcm(seg.text, seg.style, voice, model):
                        if cancelled:
                            break
                        audio_bytes += len(pcm)
                        if not write_chunk(frame("A", pcm)):
                            break
                except TTSError as exc:
                    event({"type": "error", "message": str(exc)})
                    cancelled = True
                    break
                for note in getattr(provider, "notes", [])[-1:]:
                    event({"type": "notice", "message": note})
            if not cancelled:
                event({
                    "type": "end",
                    "seconds": round(audio_bytes / (2 * SAMPLE_RATE), 2),
                    "totalMs": round((time.perf_counter() - t0) * 1000, 1),
                })
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            event({"type": "error", "message": f"stream failed: {exc}"})
        finally:
            try:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except OSError:
                pass
            if cancelled:
                sys.stderr.write("[voice] client cancelled — synthesis stopped\n")


def probe_providers(provider) -> str:
    """Ask each provider for a tiny sample once, and short-circuit dead ones.

    Returns a one-line human summary. Never raises; a failed probe just leaves
    the chain in its normal state.
    """
    chain = provider
    providers = getattr(chain, "providers", None)
    if not providers:
        return ""
    alive, dead = [], []
    for p in providers:
        name = getattr(p, "name", "provider")
        try:
            # one very short utterance is enough to reveal 401/404/429
            got = False
            for _chunk in p.stream_pcm("Hi.", None, None, None):
                got = True
                break
            (alive if got else dead).append(name)
        except Exception as exc:  # noqa: BLE001
            dead.append(name)
            if hasattr(chain, "_skip_until"):
                try:
                    import time as _t
                    cooldown = getattr(chain, "quota_cooldown", 120.0)
                    # a startup failure is worth a long skip: 15 minutes
                    chain._skip_until[id(p)] = _t.time() + max(cooldown, 900.0)
                except Exception:  # noqa: BLE001
                    pass
    parts = []
    if alive:
        parts.append("ready: " + ", ".join(alive))
    if dead:
        parts.append("skipped: " + ", ".join(dead))
    return " | ".join(parts)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Local voice + planner service")
    parser.add_argument("--mock", action="store_true", help="tone generator (no API key)")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--host", default=None)
    args = parser.parse_args(argv)

    cfg = load_config(argv_mock=args.mock)
    if args.port:
        cfg.port = args.port
    if args.host:
        cfg.host = args.host
    provider = build_provider(cfg, mock_realtime=True)

    # Probe once at startup so the first request does not pay for a dead
    # provider. If Gemini is already quota-exhausted we mark it as skipped for
    # the whole session; the chain goes straight to OpenRouter from then on.
    try:
        probe_note = probe_providers(provider)
        if probe_note:
            print(f"  probe  : {probe_note}")
    except Exception as exc:  # noqa: BLE001
        print(f"  probe  : skipped ({str(exc)[:80]})")

    sdk = "not installed"
    try:
        import google.genai as genai
        sdk = getattr(genai, "__version__", "unknown")
    except ImportError:
        pass

    server = ThreadingHTTPServer((cfg.host, cfg.port), Handler)
    server.daemon_threads = True
    server.cfg = cfg            # type: ignore[attr-defined]
    server.provider = provider  # type: ignore[attr-defined]
    server.sdk_version = sdk    # type: ignore[attr-defined]

    print(f"stick studio service on http://{cfg.host}:{cfg.port}")
    print(f"  speech : {cfg.provider} · {cfg.model} · voice {cfg.voice}")
    print(f"  planner: {'mercury:' + cfg.mercury_model if cfg.has_llm else 'disabled'}")
    print(f"  engine : {cfg.engine}")
    if cfg.voice_note():
        print(f"  note   : {cfg.voice_note()}")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
