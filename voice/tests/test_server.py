"""End-to-end tests for the streaming server (mock provider, no API key)."""
import http.client
import json
import socket
import struct
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server as srv  # noqa: E402
from config import Config, load_config  # noqa: E402
from tts import MockProvider  # noqa: E402


def read_frames(conn):
    """Yield (kind, payload) from the framed chunked response."""
    buf = b""
    while True:
        chunk = conn.read(4096)
        if not chunk:
            break
        buf += chunk
        while len(buf) >= 5:
            kind = buf[0:1]
            (length,) = struct.unpack(">I", buf[1:5])
            if len(buf) < 5 + length:
                break
            payload = buf[5:5 + length]
            buf = buf[5 + length:]
            yield kind, payload


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cfg = load_config(argv_mock=True)
        cfg.port = 0
        cfg.host = "127.0.0.1"
        cls.server = srv.ThreadingHTTPServer((cfg.host, 0), srv.Handler)
        cls.server.daemon_threads = True
        cls.server.cfg = cfg
        cls.server.provider = MockProvider(chunk_seconds=0.05, realtime=False)
        cls.server.sdk_version = "mock"
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def post(self, body, path="/api/speak"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        conn.request("POST", path, body=json.dumps(body), headers={"Content-Type": "application/json"})
        return conn

    def collect(self, body):
        conn = self.post(body)
        resp = conn.getresponse()
        frames = list(read_frames(resp))
        conn.close()
        return resp.status, frames

    def test_health(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", "/health")
        data = json.loads(conn.getresponse().read())
        conn.close()
        self.assertTrue(data["ok"])
        self.assertEqual(data["provider"], "mock")
        self.assertIn("happy", data["emotions"])
        self.assertGreaterEqual(len(data["gestures"]), 14)

    def test_stream_order_and_seq(self):
        status, frames = self.collect({"text": "[happy] Hello there! [wave] How are you?"})
        self.assertEqual(status, 200)
        events = [json.loads(p) for k, p in frames if k == b"J"]
        audio = [p for k, p in frames if k == b"A"]
        self.assertEqual(events[0]["type"], "start")
        self.assertEqual(events[-1]["type"], "end")
        seqs = [e["seq"] for e in events]
        self.assertEqual(seqs, sorted(seqs))
        self.assertEqual(seqs, list(range(len(seqs))))
        segments = [e for e in events if e["type"] == "segment"]
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["emotion"], "happy")
        self.assertEqual(segments[1]["gesture"], "wave")
        self.assertGreater(len(audio), 0)
        self.assertTrue(all(len(a) % 2 == 0 for a in audio))
        self.assertGreater(sum(len(a) for a in audio), 1000)
        self.assertGreater(events[-1]["seconds"], 0.5)

    def test_unknown_tag_warning(self):
        status, frames = self.collect({"text": "Hmm [wibble] ok."})
        events = [json.loads(p) for k, p in frames if k == b"J"]
        self.assertEqual(status, 200)
        self.assertTrue(any("wibble" in w for w in events[0]["warnings"]))
        self.assertTrue(any(e["type"] == "notice" for e in events))
        spoken = " ".join(s["text"] for s in events[0]["segments"])
        self.assertNotIn("wibble", spoken)

    def test_structured_segments_body(self):
        status, frames = self.collect({"segments": [
            {"text": "One.", "emotion": "sad", "intensity": 0.6, "gesture": "nod"},
            {"text": "Two.", "emotion": "happy"},
        ]})
        events = [json.loads(p) for k, p in frames if k == b"J"]
        segments = [e for e in events if e["type"] == "segment"]
        self.assertEqual([s["text"] for s in segments], ["One.", "Two."])
        self.assertEqual(segments[0]["emotion"], "sad")
        self.assertEqual(segments[0]["gesture"], "nod")

    def test_empty_text_is_400(self):
        conn = self.post({"text": "  "})
        resp = conn.getresponse()
        body = json.loads(resp.read())
        conn.close()
        self.assertEqual(resp.status, 400)
        self.assertFalse(body["ok"])

    def test_bad_json_is_400(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("POST", "/api/speak", body="{nope", headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        self.assertEqual(resp.status, 400)
        conn.close()

    def test_cancel_then_reuse(self):
        # Open a stream, read one frame, then drop the socket mid-stream.
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=10)
        body = json.dumps({"text": "This is a long line that will be cancelled early."}).encode()
        sock.sendall(
            b"POST /api/speak HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
            + b"Content-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
        )
        first = sock.recv(2048)
        self.assertTrue(first)
        sock.close()

        # The service must still serve a clean request afterwards.
        status, frames = self.collect({"text": "Still alive?"})
        events = [json.loads(p) for k, p in frames if k == b"J"]
        self.assertEqual(status, 200)
        self.assertEqual(events[-1]["type"], "end")


if __name__ == "__main__":
    unittest.main(verbosity=2)
