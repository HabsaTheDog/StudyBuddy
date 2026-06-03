from __future__ import annotations

from .contracts import QuizAccess, UserIntent


def quiz_permission_for_intent(intent: UserIntent) -> dict[str, object]:
    if not intent.wants_quiz_style:
        return {
            "required": False,
            "status": "not-needed",
            "allowed": False,
            "message": "Quiz resources are not needed for this request.",
        }
    if intent.quiz_access == "none":
        return {
            "required": False,
            "status": "disabled",
            "allowed": False,
            "message": "Quiz resources were disabled by command option.",
        }
    if intent.quiz_access == "authorized":
        return {
            "required": True,
            "status": "authorized",
            "allowed": True,
            "message": "Quiz access was explicitly authorized for this run. Final submissions remain forbidden.",
        }
    return {
        "required": True,
        "status": "needs-user-authorization",
        "allowed": False,
        "message": (
            "Für Moodle-ähnliche Theoriefragen könnten Quizze als Stil-/Themenquelle genutzt werden. "
            "Soll ich Quizze öffnen? Achtung: Manche Tests können Timer, Deadlines oder Attempt-Zähler starten. "
            "Bitte gib genau an, welche Quizze ich öffnen darf und ob ich nur Übersichtsseiten oder auch Review-/Frageansichten ansehen darf."
        ),
    }


def timed_quiz_warning() -> str:
    return (
        "Timed/deadline/attempt-relevant quizzes must not be opened unless the user gives an additional, explicit, "
        "situation-specific authorization. Final submission is always forbidden."
    )
