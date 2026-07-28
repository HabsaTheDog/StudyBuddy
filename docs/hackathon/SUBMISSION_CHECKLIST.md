# OpenAI Build Week — submission TODO

Deadline: **July 21, 2026 at 5:00 PM PT / July 22 at 02:00 CEST in Vienna**.

Copy this checklist into your task manager if useful.

## Security — do first

- [ ] Change the student-portal password disclosed during preparation.
- [ ] Revoke and regenerate the disclosed private calendar feed URL.
- [ ] Do not place personal credentials or a calendar bearer URL in Git, a ZIP, screenshots, or the YouTube video.
- [ ] Ask the institution for a dedicated restricted demo account or explicit account-sharing permission.
- [ ] If a permitted test account is created, rotate it immediately after the judging period ends on August 5, 2026 at 5:00 PM PT.

## Finish and publish the code

- [x] Consolidate the root implementation and cleanup into scoped release commits.
- [x] Run `npm run typecheck` and `npm test` (86 files passed; 496 tests passed, 3 skipped).
- [x] Consolidate the T3 integration into the canonical-runtime submodule commit.
- [x] Run `pnpm typecheck` and the bounded-concurrency `pnpm test` suite inside `t3code-fork`.
- [x] Commit and push the T3 submodule changes first.
- [x] Update the parent repository's submodule pointer.
- [x] Commit the interactive-study-guide workflow and its tests.
- [x] Commit the root implementation, documentation, and cleanup in understandable commits.
- [x] Fix the red GitHub Actions run and obtain a green Linux, macOS, and Windows matrix on release commit `2a29a6f`.
- [x] Extend CI path filters to cover `interactive-study-guide/**` and `shared/**`.
- [x] Run a clean-clone setup verification on Ubuntu/Linux using the direct T3 submodule checkout path.
- [x] Keep Fedora Linux labeled as the only manually end-to-end tested platform in the hackathon submission.
- [ ] Tag the submitted commit, for example `openai-build-week-2026`.
- [ ] Make the repository public under the existing MIT license.

## Repository professionalism

- [x] Confirm the public name is “Study Buddy” everywhere judges will see it.
- [x] Confirm the HTTPS clone instructions work.
- [x] Confirm README commands use positional prompts rather than invalid `--prompt` syntax.
- [x] Confirm the T3 setup documentation contains no machine-specific absolute paths.
- [x] Remove tracked Playwright snapshots containing portal/course information.
- [x] Remove the tracked Moodle-derived PDF unless redistribution permission is documented.
- [x] Run a final tracked-file secret scan.
- [x] Confirm no `.env`, storage state, cookie, diagnostic screenshot, private calendar URL, or course download is tracked.
- [x] Confirm T3 Code and Typst third-party license notices remain intact.
- [x] Confirm the repository description and topics identify an open-source education project.

## September 2026 alpha readiness

- [x] Add CI jobs for Linux, macOS, and native Windows; keep manual clean-machine installation verification open below.
- [ ] Finish platform-specific dependency detection, setup documentation, and desktop packaging.
- [ ] Complete the remaining repository and user-experience cleanup.
- [ ] Finish the opt-in analytics consent flow, endpoint, access controls, retention policy, and deletion process.
- [ ] Verify through tests that analytics never collect prompts, course context, source material, credentials, or generated content.
- [ ] Recruit the first small student alpha group for the start of the September semester.

## Showcase

- [ ] Select one safe PDF study guide for the video and repository showcase.
- [ ] Select one safe offline interactive HTML guide.
- [ ] Use synthetic, owned, openly licensed, or expressly authorized source material.
- [ ] Remove names, account identifiers, schedules, room numbers, private URLs, and hidden metadata.
- [ ] Place public examples under `docs/hackathon/showcase/`.
- [ ] Optionally place extra upload-only examples under `hackathon-submission-private/showcase/`.
- [ ] Test the PDF in a clean viewer.
- [ ] Test the HTML offline in a clean browser profile.

## Codex and eligibility evidence

- [ ] Open Codex thread `019f7106-3623-75b1-8e0e-e4ec493c71d4`.
- [ ] Verify that it is the thread where the largest share of core functionality was built.
- [ ] Run `/feedback` in that original thread.
- [ ] Copy the `/feedback` Session ID returned by Codex into the Devpost form.
- [ ] If that is not the primary thread, repeat the check with `019f722a-41bd-7ad3-8490-d204b4ee014a`.
- [x] Confirm `NEW_WORK_EVIDENCE.md` accurately uses `fe3a6fe` as the conservative pre-hackathon baseline.
- [x] Add the consolidated July 19 hackathon release commits to the evidence table.

## Judge testing

- [ ] Populate the committed showcase so judges can inspect outputs immediately.
- [ ] Decide whether live portal testing uses a dedicated account, institutional permission, or a synthetic portal.
- [ ] Put any permitted temporary credentials only in Devpost's private testing instructions—not in the public repository or general project story.
- [ ] Confirm the account exposes only safe demo data.
- [ ] Test every judge instruction from a clean environment.
- [ ] Keep the project and any permitted test access available free of charge through the judging period.

## Demo video

- [ ] Record in English or provide a complete English translation.
- [ ] Keep the final video at or below three minutes.
- [ ] Include voice narration.
- [ ] Show a clear working product flow.
- [ ] Explain what Study Buddy does.
- [ ] Explain specifically how Codex accelerated implementation.
- [ ] Explain how GPT-5.6 is integrated into the running product.
- [ ] Briefly show the Codex thread or workflow if possible.
- [ ] Show source coverage, one interactive learning action, and a PDF result.
- [ ] Hide all credentials, private URLs, personal schedules, and real account data.
- [ ] Avoid third-party logos and copyrighted music/material unless permission is documented.
- [ ] Show the exact final submitted commit.
- [ ] Upload to YouTube as a public video.
- [ ] Watch the uploaded public video once while signed out.
- [ ] Copy the YouTube URL into Devpost.

## Devpost form

- [ ] Project name: Study Buddy.
- [ ] Entrant: Alvaro, solo.
- [ ] Track: Education.
- [ ] Paste the project story from `SUBMISSION.md`.
- [ ] Add concise feature and technology tags.
- [ ] Add the public GitHub repository URL.
- [ ] Add the public YouTube URL.
- [ ] Add the one required `/feedback` Session ID.
- [ ] Add safe screenshots and a project thumbnail.
- [ ] Add private testing instructions if using a permitted test account.
- [ ] Clearly disclose that Study Buddy predates the hackathon.
- [ ] State that judging should focus on the extension after the conservative baseline.
- [ ] Credit T3 Code and disclose the Moodle/CIS integrations.
- [ ] Preview the submission while signed out.
- [ ] Submit before the deadline; do not plan around the final hour.

## Final five-minute audit

- [ ] GitHub repository is reachable and the submitted commit is present.
- [x] GitHub Actions is green on the release commit.
- [ ] README setup links and commands render correctly.
- [ ] Showcase files open.
- [ ] YouTube video is public and under three minutes.
- [ ] `/feedback` Session ID is present.
- [ ] No secret appears anywhere in the public submission.
- [ ] Submit and save a screenshot/receipt of the completed entry.
