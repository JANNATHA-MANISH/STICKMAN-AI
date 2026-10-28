"""Tests for inline-tag parsing and structured segments."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from protocol import parse_response  # noqa: E402


class TagParsingTests(unittest.TestCase):
    def test_plain_text(self):
        plan = parse_response("Hello there.")
        self.assertEqual(len(plan.segments), 1)
        self.assertEqual(plan.segments[0].text, "Hello there.")
        self.assertEqual(plan.segments[0].emotion, "neutral")
        self.assertFalse(plan.warnings)

    def test_emotion_tag_splits_and_applies(self):
        plan = parse_response("Hi. [happy] That is great!")
        self.assertEqual([s.text for s in plan.segments], ["Hi.", "That is great!"])
        self.assertEqual(plan.segments[0].emotion, "neutral")
        self.assertEqual(plan.segments[1].emotion, "happy")

    def test_gesture_tag_is_not_spoken(self):
        plan = parse_response("[wave] Hello!")
        self.assertEqual(plan.segments[0].text, "Hello!")
        self.assertEqual(plan.segments[0].gesture, "wave")

    def test_unknown_tag_dropped_with_warning(self):
        plan = parse_response("Well [blorp] then.")
        text = " ".join(s.text for s in plan.segments)
        self.assertNotIn("blorp", text)
        self.assertTrue(any("blorp" in w for w in plan.warnings))

    def test_sonic_cues_stay_inline_and_canonical(self):
        plan = parse_response("[laughs] oh no [whisper] keep it down")
        text = plan.segments[0].text
        self.assertIn("[laughs]", text)
        self.assertIn("[whispers]", text)
        self.assertEqual(plan.segments[0].emotion, "laughing")
        self.assertIn("laugh", plan.segments[0].vocal_events)

    def test_short_pause_is_timeline_not_speech(self):
        plan = parse_response("Wait. [short pause] What was that?")
        self.assertEqual([s.text for s in plan.segments], ["Wait.", "What was that?"])
        self.assertEqual(plan.segments[0].pause_after_ms, 450)
        self.assertNotIn("pause", " ".join(s.text for s in plan.segments).lower())

    def test_structured_segments(self):
        plan = parse_response(segments=[
            {"text": "Oh, that is wonderful!", "emotion": "happy", "intensity": 0.8, "gesture": "wave"},
            {"text": "Let me think.", "emotion": "thinking", "intensity": 0.5},
        ])
        self.assertEqual(len(plan.segments), 2)
        self.assertEqual(plan.segments[0].gesture, "wave")
        self.assertAlmostEqual(plan.segments[0].intensity, 0.8)

    def test_structured_segments_rejects_unknown(self):
        plan = parse_response(segments=[{"text": "Hi", "emotion": "furious", "gesture": "backflip"}])
        self.assertEqual(plan.segments[0].emotion, "neutral")
        self.assertIsNone(plan.segments[0].gesture)
        self.assertEqual(len(plan.warnings), 2)

    def test_empty(self):
        plan = parse_response("   ")
        self.assertEqual(plan.segments, [])
        self.assertTrue(plan.warnings)

    def test_only_tags(self):
        plan = parse_response("[happy][wave]")
        self.assertEqual(plan.segments, [])
        self.assertTrue(any("only" in w for w in plan.warnings))

    def test_numbers_in_brackets_are_not_tags(self):
        plan = parse_response("Use array[0] here.")
        self.assertEqual(plan.segments[0].text, "Use array[0] here.")

    def test_intensity_clamped(self):
        plan = parse_response("[happy] hi", intensity=9)
        self.assertLessEqual(plan.segments[0].intensity, 1.6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
