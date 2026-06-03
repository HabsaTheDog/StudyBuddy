import unittest

from uni_agent.activities import classify_activity, normalize_activity_title


class ActivityClassificationTests(unittest.TestCase):
    def test_test_block_not_rechenuebung(self):
        self.assertEqual(classify_activity("Test Block 6"), ("test_block", 6))
        self.assertEqual(classify_activity("Rechenübungen 6"), ("rechenuebung", 6))

    def test_empty_link_parent_context_can_classify(self):
        kind, number = classify_activity("", "Aktivität Test Block 8 auswählen Test Block 8 Machen Sie den Kurztest")
        self.assertEqual(kind, "test_block")
        self.assertEqual(number, 8)

    def test_normalize_umlauts(self):
        self.assertIn("rechenuebungen", normalize_activity_title("Rechenübungen 7"))


if __name__ == "__main__":
    unittest.main()
