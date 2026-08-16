# Security and local data handling

Study Buddy processes data that may be personal, confidential, or licensed only
for an enrolled student. Use the smallest authorized scope and collect only the
evidence needed for the current request.

## Storage

- Workflow state belongs below the ignored `study-buddy-data/` tree.
- Reviewed deliverables are separate from internal source, state, and diagnostic
  files.
- Restrict local data and secret files to the operating-system user.
- Browser storage state, cookies, private calendar feeds, cloud-link URLs, and
  local key pairs are credentials, even when they are not named `password`.
- Source and email credentials entered through the interface are kept out of
  the public source registry and stored in the dedicated local server secret
  directory. Study Buddy enforces user-only directory/file permissions
  (`0700`/`0600`) and atomic writes, but does not currently add application-level
  encryption or an operating-system keychain layer. Protect the OS account and
  disk with full-disk encryption, and clear or rotate saved credentials if the
  device or account may be compromised.
- Delete obsolete diagnostics and runs according to a local retention policy.

## Diagnostics and support

Keep authenticated page capture disabled by default. Before sharing an error,
replace portal hosts, account names, course names, IDs, paths, query parameters,
and tokens with synthetic values. Screenshots can contain data that text
redaction misses.

## Distribution

Do not ZIP the working directory. Ignored folders may contain credentials and
gigabytes of private course data. Build from a clean clone or reviewed
`git archive`, initialize only the pinned public submodule commit, and inspect
the final file manifest before signing or uploading it.

Never push local checkpoint refs or use `git push --mirror` as a release method.
Push only explicitly reviewed branches and tags.

Release update checks use the public `HabsaTheDog/StudyBuddy` GitHub Releases
feed. Installers, channel metadata, checksums, and the SBOM are produced from the
same reviewed commit. Updates are never downloaded or installed without a user
action.

## Portal and academic safety

Use only accounts and content the user is authorized to access. Never create a
shadow permission path, start or continue a quiz during automatic evidence
acquisition, or submit a final quiz attempt. Confirm assignment targets and file
manifests before any upload.
