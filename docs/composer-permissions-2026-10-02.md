# Compact composer permission labels — 2026-10-02

The composer now shows the active profile's name without adding “profile”.
Built-ins read Fast, Balanced, and Quality; custom names are preserved verbatim.
A single vertical divider separates the profile picker from Computer, Email,
and Quizzes. Their selected modes appear through icons, hover descriptions,
and the existing detailed menus.

Computer retains its locked, edit, and unlocked icons. Email uses an envelope
with an X for off, search for reading, plus for drafts, and a small paper plane
for sending with approval. Multiple accounts retain the generic envelope and
their individual account permissions in the popover. Quizzes always use a
shield: an “i” for review, a question mark for asking before opening, and a
check mark for assistance. The same quiz icons appear in the narrow overflow
menu. The existing responsive overflow behavior remains in place.

This is a presentation change. Runtime permission values, per-account email
policy, quiz admission and the final-submission boundary are preserved.

## Evidence

Browser-diagnostic screenshots of the actual rendered composer are retained
under `study-buddy-data/composer-controls-review/2026-10-02/`: desktop and narrow
layouts, plus all three quiz modes. The screenshots were visually inspected.
These fixture-backed browser checks do not establish native desktop or
packaged Windows/Fedora acceptance. No chat prompt or actual quiz was submitted.

Focused regressions cover fixed control labels and ordering, one divider,
verbatim custom names, runtime menu descriptions and icon changes, all three
quiz transitions and saved values, and all four email permission states with
their corresponding account switches.

All 125 affected Chromium checks passed across the full chat view, profile
picker, compact controls menu, and source settings. Full fork `vp check`
passed, and all 13 workspace typechecks passed.

UI commit `eec115d93` and the parent pointer/documentation are committed locally.

The follow-up replaces the email approval question mark with a paper plane
at the envelope's bottom-right corner. The detailed menu still requires
approval for sending. Its browser-diagnostic capture is
`study-buddy-data/composer-controls-review/2026-10-02/email-ask-to-send.png`.
Follow-up UI `3521096d8` is committed locally; all 10 source-settings browser
checks, full fork format/lint, and all 13 workspace typechecks passed.
This change belongs to the open `0.2.3-alpha` development batch. It is local
development work; it has not been pushed, merged, packaged, deployed, published,
or release-accepted. Frozen-batch review and exact-candidate Windows/Fedora
acceptance remain required.
