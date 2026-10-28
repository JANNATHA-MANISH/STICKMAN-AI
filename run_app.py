#!/usr/bin/env python3
"""Inkwell Studio — one command starts everything.

    uv run app
    uv run app --port 8020 --voice-port 8770
    python run_app.py --no-open

Starts two things in one process tree:
  * the static app (companion/ + js/) on --port
  * the voice + planner service (voice/server.py) on --voice-port

Every path is derived from this file's location, so the folder can be cloned
anywhere (spaces, another drive, another OS) and still runs.
"""
from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
VOICE_DIR = HERE / "voice"
VOICE_SERVER = VOICE_DIR / "server.py"


class QuietHandler(SimpleHTTPRequestHandler):
    """Static handler that serves from HERE and stays quiet in the console."""

    def log_message(self, fmt, *args):  # noqa: A003
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def _wait_for_port(host: str, port: int, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.6):
                return True
        except OSError:
            time.sleep(0.25)
    return False


def serve_static(port: int, host: str) -> None:
    os.chdir(HERE)                      # serve relative to the repo, not cwd
    httpd = ThreadingHTTPServer((host, port), QuietHandler)
    print(f"[app]   static   http://{host}:{port}/companion/", flush=True)
    httpd.serve_forever()


def start_voice(port: int, host: str):
    if not VOICE_SERVER.is_file():
        print(f"[voice] server.py not found at {VOICE_SERVER}", flush=True)
        return None
    env = os.environ.copy()
    env["VOICE_PORT"] = str(port)
    env["VOICE_HOST"] = host
    venv_py = VOICE_DIR / ".venv" / ("Scripts" if os.name == "nt" else "bin") / (
        "python.exe" if os.name == "nt" else "python")
    py = str(venv_py) if venv_py.is_file() else sys.executable
    print(f"[voice] starting with {Path(py).name} on {host}:{port}", flush=True)
    return subprocess.Popen([py, str(VOICE_SERVER)], cwd=str(VOICE_DIR), env=env)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Run Inkwell Studio")
    ap.add_argument("--port", type=int, default=8010, help="static site port")
    ap.add_argument("--voice-port", type=int, default=8765, help="voice service port")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-open", action="store_true", help="do not open a browser")
    args = ap.parse_args(argv)

    proc = start_voice(args.voice_port, args.host)
    if proc is not None:
        if _wait_for_port(args.host, args.voice_port, timeout=30):
            print(f"[voice] ready    http://{args.host}:{args.voice_port}/health", flush=True)
        else:
            print("[voice] did not answer yet — the app still runs; speech will "
                  "report 'offline' until it does", flush=True)

    url = f"http://{args.host}:{args.port}/companion/"
    if not args.no_open:
        try:
            import webbrowser
            threading.Timer(1.2, lambda: webbrowser.open(url)).start()
        except Exception:  # noqa: BLE001
            pass

    try:
        serve_static(args.port, args.host)
    except KeyboardInterrupt:
        print("\n[app] stopped", flush=True)
    finally:
        if proc is not None:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
