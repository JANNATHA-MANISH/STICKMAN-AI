"""Planner schema tests — no network, no API keys."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mercury import MercuryError, extract_json  # noqa: E402
from planner import PlanError, normalize, system_prompt, user_prompt  # noqa: E402

SPEAKERS = [
    {"id": "a", "name": "Ava", "voice": "Fola"},
    {"id": "b", "name": "Ben", "voice": "Kore"},
]


class ExtractJsonTests(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(extract_json('{"a": 1}'), {"a": 1})

    def test_fenced(self):
        self.assertEqual(extract_json('```json\n{"a": 1}\n```'), {"a": 1})

    def test_trailing_prose(self):
        self.assertEqual(extract_json('Here you go:\n{"a": {"b": 2}}\nHope it helps'),
                         {"a": {"b": 2}})

    def test_braces_inside_strings(self):
        self.assertEqual(extract_json('{"t": "a } b"}'), {"t": "a } b"})

    def test_truncated(self):
        with self.assertRaises(MercuryError):
            extract_json('{"a": [1, 2')

    def test_no_json(self):
        with self.assertRaises(MercuryError):
            extract_json("I cannot do that")


class NormalizeTests(unittest.TestCase):
    def test_valid(self):
        plan = normalize({"segments": [
            {"text": "Hello!", "emotion": "happy", "intensity": 0.8, "gesture": "wave"},
            {"text": "Bye.", "speaker_id": "b", "emotion": "sad", "pause_after_ms": 500},
        ]}, "podcast", SPEAKERS)
        self.assertEqual(len(plan["segments"]), 2)
        self.assertEqual(plan["segments"][0]["speaker_id"], "a")
        self.assertEqual(plan["segments"][1]["speaker_id"], "b")
        self.assertEqual(plan["segments"][0]["gesture"], "wave")
        self.assertEqual(plan["version"], 1)

    def test_synonyms_and_free_gesture_text(self):
        plan = normalize({"segments": [
            {"text": "yay", "emotion": "excited", "gesture": "wide smile, fist pump"},
            {"text": "hmm", "emotion": "puzzled", "gesture": "hand on chin"},
        ]}, "single", SPEAKERS[:1])
        self.assertEqual(plan["segments"][0]["emotion"], "ecstatic")
        self.assertEqual(plan["segments"][1]["emotion"], "confused")
        self.assertEqual(plan["segments"][1]["gesture"], "thinkChin")

    def test_clamps(self):
        plan = normalize({"segments": [
            {"text": "x", "intensity": 99, "pause_after_ms": 99999},
        ]}, "single", SPEAKERS[:1])
        self.assertLessEqual(plan["segments"][0]["intensity"], 1.6)
        self.assertLessEqual(plan["segments"][0]["pause_after_ms"], 1500)

    def test_unknown_speaker_falls_back(self):
        plan = normalize({"segments": [{"text": "hi", "speaker_id": "zzz"}]},
                         "podcast", SPEAKERS)
        self.assertEqual(plan["segments"][0]["speaker_id"], "a")

    def test_empty_and_invalid(self):
        for bad in [None, {}, {"segments": []}, {"segments": "nope"}]:
            with self.assertRaises(PlanError):
                normalize(bad, "single", SPEAKERS[:1])

    def test_empty_text_segments_skipped(self):
        with self.assertRaises(PlanError):
            normalize({"segments": [{"text": "   "}]}, "single", SPEAKERS[:1])

    def test_caps_segments(self):
        plan = normalize({"segments": [{"text": f"s{i}"} for i in range(50)]},
                         "single", SPEAKERS[:1])
        self.assertLessEqual(len(plan["segments"]), 6)

    def test_prompts_mention_ids(self):
        self.assertIn("wave", system_prompt("single", 1))
        self.assertIn('id "b"', user_prompt("hello", "podcast", SPEAKERS, False))
        self.assertIn("podcast conversation", user_prompt("space", "podcast", SPEAKERS, True))


if __name__ == "__main__":
    unittest.main(verbosity=2)
