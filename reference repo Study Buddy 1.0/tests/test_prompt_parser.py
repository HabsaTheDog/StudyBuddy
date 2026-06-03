import unittest

from uni_agent.activities import parse_requested_activity


class PromptParserTests(unittest.TestCase):
    def test_testbloecke_space_list(self):
        parsed = parse_requested_activity("in grundlagen der dynamik die testblöcke 6 7 und 8 machen")
        self.assertEqual(parsed, {"kind": "test_block", "block_numbers": [6, 7, 8]})

    def test_test_block_range(self):
        parsed = parse_requested_activity("test block 6-8")
        self.assertEqual(parsed, {"kind": "test_block", "block_numbers": [6, 7, 8]})

    def test_block_bis_range(self):
        parsed = parse_requested_activity("block 6 bis 8")
        self.assertEqual(parsed, {"kind": "test_block", "block_numbers": [6, 7, 8]})

    def test_rechenuebungen_kind(self):
        parsed = parse_requested_activity("rechenübungen 6 7")
        self.assertEqual(parsed, {"kind": "rechenuebung", "block_numbers": [6, 7]})


if __name__ == "__main__":
    unittest.main()
