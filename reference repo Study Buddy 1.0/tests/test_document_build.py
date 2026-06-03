import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from uni_agent.assistant import _looks_like_study_build_request
from uni_agent.document_build.contracts import DocumentPlan, PlannedSection, SourceChunk, SourceDescriptor, TaskRef
from uni_agent.document_build.intent import parse_document_intent
from uni_agent.document_build.pipeline import generate_document_build
from uni_agent.document_build.section_builder import build_local_document
from uni_agent.document_build.source_resolver import resolve_sources
from uni_agent.document_build.template_registry import get_template


KREUZERL_PROMPT = (
    "Löse alle Übungen mit einem Kreuzerl/Häkchen mit kurzen Erklärungen und fasse sie in einem PDF zusammen. "
    "Ausnehmen: Thema 6/2, Thema 7/4 und Thema 8/4. Bei Aufgabe 7/7 genügt der ungerade Fall."
)


class DocumentBuildIntentTests(unittest.TestCase):
    def test_kreuzerl_prompt_preserves_exclusions_and_partial_scope(self):
        intent = parse_document_intent(KREUZERL_PROMPT)
        self.assertEqual(intent.selected_template, "math_worked_solutions")
        self.assertTrue(intent.wants_marked_tasks)
        self.assertEqual(intent.requested_topics, [6, 7, 8])
        self.assertEqual({item.key for item in intent.exclusions}, {(6, 2), (7, 4), (8, 4)})
        self.assertEqual(len(intent.partial_requirements), 1)
        self.assertEqual(intent.partial_requirements[0].task.key, (7, 7))
        self.assertIn("ungerade", intent.partial_requirements[0].scope.casefold())

    def test_exact_worksheet_prompt_maps_to_single_math_task(self):
        intent = parse_document_intent("Mathe Aufgabe 4 von Übungsblatt 8 als PDF lösen")
        self.assertEqual(intent.selected_template, "math_worked_solutions")
        self.assertEqual([task.key for task in intent.requested_tasks], [(8, 4)])
        self.assertFalse(intent.wants_marked_tasks)

    def test_prompt_runner_classifies_marked_exercise_pdf_as_document_build(self):
        self.assertTrue(_looks_like_study_build_request(KREUZERL_PROMPT.casefold()))


class DocumentBuildSourcePolicyTests(unittest.TestCase):
    def test_missing_current_sources_fail_after_targeted_sync_without_output_fallback(self):
        intent = parse_document_intent(KREUZERL_PROMPT, sync_policy="require-current")
        course = {
            "id": "32274",
            "title": "BMR-VZ-2-SS2026-MAES2-DE/165575 Mathematik für Engineering Science 2",
            "url": "https://moodle.example/course/view.php?id=32274",
        }
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            with patch("uni_agent.document_build.source_resolver.load_synced_courses", return_value=[course]), patch(
                "uni_agent.document_build.source_resolver.read_json", return_value={"documents": []}
            ), patch("uni_agent.document_build.source_resolver.download_course_materials"), patch(
                "uni_agent.document_build.source_resolver.refresh_document_index"
            ):
                sources, chunks, tasks, omissions, issues, selected_course, ambiguous = resolve_sources(intent, run_dir)
        self.assertEqual(selected_course["id"], "32274")
        self.assertEqual(ambiguous, [])
        self.assertEqual(sources, [])
        self.assertEqual(chunks, [])
        self.assertEqual(tasks, [])
        self.assertTrue(any(issue["code"] == "sources-missing-after-sync" for issue in issues))

    def test_pipeline_does_not_render_pdf_on_preflight_failure(self):
        course = {
            "id": "32274",
            "title": "BMR-VZ-2-SS2026-MAES2-DE/165575 Mathematik für Engineering Science 2",
            "url": "https://moodle.example/course/view.php?id=32274",
        }
        with patch("uni_agent.document_build.source_resolver.load_synced_courses", return_value=[course]), patch(
            "uni_agent.document_build.source_resolver.read_json", return_value={"documents": []}
        ), patch("uni_agent.document_build.source_resolver.download_course_materials"), patch(
            "uni_agent.document_build.source_resolver.refresh_document_index"
        ):
            run_dir = generate_document_build(KREUZERL_PROMPT, output_format="markdown+pdf")
        self.assertTrue((run_dir / "missing-sources.md").exists())
        self.assertFalse((run_dir / "document-build.pdf").exists())
        self.assertFalse((run_dir / "study-build.pdf").exists())

    def test_worked_solution_section_uses_document_build_provider_hook(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            script = root / "section_builder.py"
            script.write_text(
                "import json, os\n"
                "payload = {'heading': 'Thema 7/7', 'body': ['Kurzlösung aus Provider.'], 'source_ids': ['S1'], 'risk_flags': []}\n"
                "open(os.environ['DOCUMENT_BUILD_OUTPUT_PATH'], 'w', encoding='utf-8').write(json.dumps(payload))\n",
                encoding="utf-8",
            )
            intent = parse_document_intent("Löse Thema 7/7 als PDF")
            plan = DocumentPlan(
                title="Mathe",
                template_id="math_worked_solutions",
                course={"title": "Mathematik"},
                sections=[
                    PlannedSection(
                        id="section-1",
                        heading="Thema 7/7",
                        kind="worked_solution",
                        task_ref=TaskRef(topic=7, task=7),
                        source_ids=["S1"],
                        builder_mode="model",
                    )
                ],
                sources=[SourceDescriptor(id="S1", title="uebung.pdf", role="worksheet", status="selected", path=None)],
                chunks=[SourceChunk(source_id="S1", title="uebung.pdf", role="worksheet", path=None, page=1, text="Aufgabe 7: Rechne den ungeraden Fall.")],
                omissions=[],
                issues=[],
                safety={"output_fallbacks_allowed": False},
            )
            command = subprocess.list2cmdline([sys.executable, str(script)])
            with patch("uni_agent.document_build.section_builder.env_with_dotenv", return_value={"DOCUMENT_BUILD_SECTION_COMMAND": command}):
                document = build_local_document(intent, get_template("math_worked_solutions"), plan, run_dir=root)
        self.assertEqual(document.sections[0].body, ["Kurzlösung aus Provider."])
        self.assertEqual(document.sections[0].risk_flags, [])


if __name__ == "__main__":
    unittest.main()
