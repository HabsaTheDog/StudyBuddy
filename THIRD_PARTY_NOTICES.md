# Third-Party Notices

Study Buddy includes and depends on third-party software. The top-level MIT
license covers Study Buddy-owned code; it does not replace third-party terms or
grant rights to institution content, generated course material, or trademarks.

## T3 Code

The `t3code-fork/` submodule is a modified fork of
[T3 Code](https://github.com/pingdotgg/t3code), copyright T3 Tools Inc. and
contributors, licensed under MIT. Its license and notices remain in the
submodule. A release must record the exact public submodule commit.

## Vendored Typst packages

Typst packages are retained below `src/custom-skills/moodle/typst/vendor/` with
their upstream license files. The vendored CeTZ package includes LGPL-3.0-or-
later, MIT, and Apache-2.0 license material; those files govern the corresponding
components and must remain in distributions.

## npm dependencies

Runtime and development dependencies retain their own licenses. Before every
release candidate, generate an SBOM/license inventory from the clean locked
dependency graph, review non-permissive and notice-bearing licenses, and attach
the reviewed inventory to the release. `package-lock.json` is the authoritative
npm resolution for source builds.

## Content and marks

Moodle course materials, quizzes, student records, portal interfaces, and
generated artifacts that reproduce third-party content are not relicensed by
this repository. Contributors and users must supply only synthetic, owned,
openly licensed, or expressly permitted material. Moodle, FH Technikum Wien,
T3 Code, and other names and marks belong to their respective owners; mention
does not imply endorsement.
