import unittest

from uni_agent.retrieval import BLOCK_SOURCE_HINTS, QUERY_EXPANSIONS


class RetrievalTests(unittest.TestCase):
    def test_block_7_retrieval_hints_include_dalembert(self):
        self.assertTrue(any("dalembert" in hint for hint in BLOCK_SOURCE_HINTS[7]))

    def test_block_8_retrieval_hints_include_lagrange_and_dalembert(self):
        hints = " ".join(BLOCK_SOURCE_HINTS[8])
        self.assertIn("lagrange", hints)
        self.assertIn("dalembert", hints)

    def test_query_expansion_for_freiheitsgrade(self):
        self.assertIn("3N - s".casefold(), [item.casefold() for item in QUERY_EXPANSIONS["freiheitsgrade"]])


if __name__ == "__main__":
    unittest.main()
