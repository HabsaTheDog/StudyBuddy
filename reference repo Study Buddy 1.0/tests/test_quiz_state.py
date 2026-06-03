import unittest

from uni_agent.quiz_state import is_final_submit_text, is_finish_to_summary_text


class QuizStateTests(unittest.TestCase):
    def test_finish_attempt_to_summary_is_not_final_submit(self):
        self.assertTrue(is_finish_to_summary_text("Versuch abschließen ..."))
        self.assertFalse(is_final_submit_text("Versuch abschließen ..."))

    def test_submit_controls_are_denied(self):
        self.assertTrue(is_final_submit_text("Abgeben"))
        self.assertTrue(is_final_submit_text("Submit all and finish"))
        self.assertTrue(is_final_submit_text("Endgültig abgeben"))


if __name__ == "__main__":
    unittest.main()
