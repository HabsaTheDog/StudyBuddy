import unittest

from uni_agent.quiz import _answer_values, _fill_question_js


class AnswerMatchingTests(unittest.TestCase):
    def test_answer_values_prefers_answers_v2(self):
        answer = {
            "answer": "fallback",
            "answers": [{"control_id": "q1", "letter": "b", "text": "Theta und Phi"}],
        }
        self.assertEqual(_answer_values(answer), [{"control_id": "q1", "letter": "b", "text": "Theta und Phi"}])

    def test_fill_js_supports_control_id_and_letter_matching(self):
        js = _fill_question_js(
            {"question_id": "question-1"},
            {"answers": [{"control_id": "q2264278:2_choice1", "letter": "b", "text": "Θ und Φ"}]},
        )
        self.assertIn("expectedControlId", js)
        self.assertIn("expectedLetter", js)
        self.assertIn('matchedBy = "control_id"', js)
        self.assertIn('matchedBy = "letter"', js)


if __name__ == "__main__":
    unittest.main()
