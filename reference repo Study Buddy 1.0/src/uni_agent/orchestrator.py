from __future__ import annotations

import argparse
import json

from .courses import index_courses
from .documents import download_materials, refresh_document_index
from .activities import resolve_requested_activities
from .browser import AgentBrowser
from .knowledge import load_synced_courses
from .moodle import login, snapshot
from .providers import provider_diagnostics
from .quiz import assist_quiz, fill_quiz, verify_quiz
from .storage import ROOT, create_output_run_dir, ensure_dirs, env_with_dotenv, read_json, write_json
from .document_build import generate_document_build
from .sync import sync_moodle


def main() -> None:
    parser = argparse.ArgumentParser(prog="uni-agent")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("login")

    snapshot_parser = subparsers.add_parser("snapshot")
    snapshot_parser.add_argument("url", nargs="?")

    subparsers.add_parser("courses")
    materials_parser = subparsers.add_parser("materials")
    materials_parser.add_argument("--download-limit", type=int, default=0)
    materials_parser.add_argument("--course-limit", type=int, default=0)

    subparsers.add_parser("documents")
    subparsers.add_parser("providers")

    sync_parser = subparsers.add_parser("sync")
    sync_parser.add_argument("--course-limit", type=int, default=0)
    sync_parser.add_argument("--download", action="store_true", help="Compatibility flag. Downloads are enabled by default.")
    sync_parser.add_argument("--no-download", action="store_true")
    sync_parser.add_argument("--incremental", action="store_true", help="Keep existing material cache and merge indexes instead of starting clean.")
    sync_parser.add_argument(
        "--download-limit-per-course",
        type=int,
        default=0,
        help="Maximum files to download per course. 0 means unlimited.",
    )
    sync_parser.add_argument("--max-bytes-per-file", type=int, default=100_000_000)

    study_build_parser = subparsers.add_parser("study-build")
    study_build_parser.add_argument("prompt", nargs="+")
    study_build_parser.add_argument(
        "--format",
        default="markdown+pdf",
        choices=["markdown+pdf", "markdown", "typst", "pdf"],
    )
    study_build_parser.add_argument(
        "--quiz-access",
        default="ask",
        choices=["ask", "none", "authorized"],
        help="Quiz access policy for document generation. Default asks before opening any quiz.",
    )
    study_build_parser.add_argument("--max-repair-cycles", type=int, default=3)
    study_build_parser.add_argument("--live-moodle-read", action="store_true")
    study_build_parser.add_argument(
        "--template",
        default="auto",
        choices=[
            "auto",
            "math_worked_solutions",
            "study_guide",
            "formula_sheet",
            "theory_summary",
            "assignment_brief",
            "quiz_safe_review",
        ],
    )
    study_build_parser.add_argument(
        "--sync-policy",
        default="require-current",
        choices=["require-current", "no-sync"],
        help="Source policy for document generation. Default requires current Moodle/material sources and never falls back to output artifacts.",
    )

    activity_parser = subparsers.add_parser("activity-resolve")
    activity_parser.add_argument("prompt", nargs="+")

    quiz_parser = subparsers.add_parser("quiz")
    quiz_parser.add_argument("url")
    quiz_parser.add_argument("--fill-safe", action="store_true")
    quiz_parser.add_argument("--verify-only", action="store_true")
    quiz_parser.add_argument("--verify-persisted", action="store_true")
    quiz_parser.add_argument("--resume-attempt", action="store_true")
    quiz_parser.add_argument("--summary-only", action="store_true")
    quiz_parser.add_argument("--answers")
    quiz_parser.add_argument("--auto-answer", action="store_true")
    quiz_parser.add_argument(
        "--max-pages",
        type=int,
        default=100,
        help="Safety cap for quiz pages. Defaults to 100 so the whole quiz is attempted until safe navigation stops.",
    )
    quiz_parser.add_argument("--no-start", action="store_true")
    quiz_parser.add_argument(
        "--respect-review-only",
        action="store_true",
        help="Use the review-only classifier in fill mode instead of the default fill behavior.",
    )

    args = parser.parse_args()
    ensure_dirs()

    if args.command == "login":
        result = login()
        print(f"Logged in or already authenticated. Current URL: {result['url_after']}")
    elif args.command == "snapshot":
        print(snapshot(args.url))
    elif args.command == "courses":
        courses = index_courses()
        print(f"Indexed {len(courses)} courses into state/course_index.json")
    elif args.command == "materials":
        target = download_materials(
            download_limit=args.download_limit,
            course_limit=args.course_limit or None,
        )
        print(f"Wrote material index to {target.relative_to(target.parents[1])}")
    elif args.command == "documents":
        target = refresh_document_index()
        print(f"Wrote {target.relative_to(target.parents[1])}")
    elif args.command == "providers":
        diagnostics = provider_diagnostics(env_with_dotenv())
        write_json(ROOT / "state" / "agent_provider_diagnostics.json", diagnostics)
        print(json.dumps(diagnostics, indent=2, ensure_ascii=False))
    elif args.command == "sync":
        run_dir = sync_moodle(
            course_limit=args.course_limit or None,
            download=not args.no_download,
            download_limit_per_course=args.download_limit_per_course,
            max_bytes_per_file=args.max_bytes_per_file,
            clean=not args.incremental,
        )
        print(f"Wrote Moodle sync report to {run_dir}")
    elif args.command == "study-build":
        run_dir = generate_document_build(
            " ".join(args.prompt),
            output_format=args.format,
            quiz_access=args.quiz_access,
            max_repair_cycles=args.max_repair_cycles,
            live_moodle_read=args.live_moodle_read,
            template=args.template,
            sync_policy=args.sync_policy,
        )
        manifest = read_json(run_dir / "artifacts" / "metadata" / "run-manifest.json", default={})
        status = manifest.get("status") if isinstance(manifest, dict) else None
        print(f"Wrote document build ({status or 'unknown'}) to {run_dir}")
    elif args.command == "activity-resolve":
        prompt = " ".join(args.prompt)
        courses = load_synced_courses(refresh_if_missing=True)
        course = next((item for item in courses if "dynamik" in str(item.get("title", "")).casefold() and "phdyn" in str(item.get("title", "")).casefold()), courses[0] if courses else None)
        if not course:
            raise SystemExit("No courses available to resolve activities.")
        result = resolve_requested_activities(prompt, course, browser=AgentBrowser(mode="read"))
        run_dir = create_output_run_dir("activity-resolve", prompt)
        write_json(run_dir / "activity-resolution.json", result)
        print(f"Wrote activity resolution to {run_dir}")
    elif args.command == "quiz":
        if args.verify_only or args.summary_only:
            run_dir = verify_quiz(args.url)
            print(f"Wrote quiz verification to {run_dir}")
        elif args.fill_safe:
            if not args.answers and not args.auto_answer:
                raise SystemExit("--fill-safe requires --answers <path> or --auto-answer")
            run_dir = fill_quiz(
                args.url,
                answers_path=ROOT / args.answers if args.answers else None,
                max_pages=args.max_pages,
                start_attempt=not args.no_start,
                bypass_review_only=not args.respect_review_only,
                auto_answer=args.auto_answer,
            )
            if args.verify_persisted:
                fill_payload = read_json(run_dir / "fill-results.json", default={})
                verification_url = str(fill_payload.get("url") or args.url)
                verify_dir = verify_quiz(verification_url)
                write_json(run_dir / "post-fill-verification.json", {"verification_run": str(verify_dir)})
            print(f"Wrote quiz fill report to {run_dir}")
        else:
            run_dir = assist_quiz(args.url)
            print(f"Wrote quiz review to {run_dir}")


if __name__ == "__main__":
    main()
