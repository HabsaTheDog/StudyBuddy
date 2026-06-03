import unittest

from uni_agent.moodle import _is_login_or_timeout_page


class MoodleLoginStateTests(unittest.TestCase):
    def test_timeout_url_is_not_authenticated(self):
        self.assertTrue(
            _is_login_or_timeout_page(
                "https://moodle.technikum-wien.at/?redirect=0&errorcode=4",
                "Home | FHTW Moodle",
                "Moodle Login\nYour session has timed out.\nUsername\nPassword\nLog in",
            )
        )

    def test_login_form_is_not_authenticated(self):
        self.assertTrue(
            _is_login_or_timeout_page(
                "https://moodle.technikum-wien.at/login/index.php",
                "Home | FHTW Moodle",
                "Moodle Login\nUsername\nPassword",
            )
        )

    def test_dashboard_is_authenticated(self):
        self.assertFalse(
            _is_login_or_timeout_page(
                "https://moodle.technikum-wien.at/my/",
                "Dashboard | FHTW Moodle",
                "Kursübersicht\nBMR-VZ-2-SS2026-ET2-DE/165657",
            )
        )


if __name__ == "__main__":
    unittest.main()
