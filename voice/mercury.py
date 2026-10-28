"""Mercury (Inception Labs) chat client — action planning only.

The planner never speaks; it turns a request into a validated performance plan
that the TTS + animation layers execute. No secrets are logged.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional


class MercuryError(RuntimeError):
    pass


def _post(url: str, key: str, payload: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url.rstrip("/") + "/chat/completions",
        data=body,
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8")[:300]
        except Exception:  # noqa: BLE001
            pass
        raise MercuryError(f"Mercury HTTP {exc.code}: {detail or exc.reason}") from exc
    except Exception as exc:  # noqa: BLE001
        raise MercuryError(f"Mercury request failed: {type(exc).__name__}") from exc


def extract_json(content: str) -> Dict[str, Any]:
    """Best-effort extraction of the first JSON object in a model reply."""
    text = (content or "").strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    if start < 0:
        raise MercuryError("planner returned no JSON object")
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError as exc:
                    raise MercuryError(f"planner JSON is malformed: {exc.msg}") from exc
    raise MercuryError("planner JSON was truncated")


def chat(cfg, messages: List[Dict[str, str]], *, max_tokens: int = 4000,
         temperature: float = 0.4, timeout: float = 45.0) -> str:
    if not cfg.has_llm:
        raise MercuryError("INCEPTION_API_KEY is not configured")
    data = _post(cfg.mercury_base, cfg.inception_key, {
        "model": cfg.mercury_model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }, timeout)
    try:
        message = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise MercuryError("Mercury returned an unexpected response shape") from exc
    content = message.get("content")
    if not content:
        # reasoning models can spend the whole budget on reasoning tokens
        finish = (data.get("choices") or [{}])[0].get("finish_reason")
        raise MercuryError(f"Mercury returned no content (finish={finish}, max_tokens={max_tokens})")
    return content


def plan_once(cfg, system: str, user: str, *, repair: Optional[str] = None,
              max_tokens: int = 4000) -> Dict[str, Any]:
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": user}]
    if repair:
        messages.append({"role": "assistant", "content": repair})
        messages.append({"role": "user", "content":
                         "That reply was not a valid performance plan. Reply again with ONLY the JSON object, "
                         "using exactly the allowed emotion and gesture ids."})
    return extract_json(chat(cfg, messages, max_tokens=max_tokens))
