# Profile picker tab usability — 2026-10-02

The previous provider tabs inherited the conversation's coordinator lock. In an
existing Codex conversation this disabled the Gemini tab itself, making its
profiles impossible to browse. The locked-provider browser regression fails on
that implementation and passes after separating browsing from selection.

Provider icons now sit beside the “Built in” label. Each occupies a compact 32px
target; an underline indicates the browsed provider. Hover names and arrow-key
navigation remain available. The filled, full-width segmented bar is removed.
Personal and mixed profiles stay above the built-ins.

Tabs always permit browsing connected providers. A locked conversation keeps
foreign coordinator profiles disabled and displays “Start a new chat to use
Google Gemini profiles.” Selecting a profile in a fresh draft still switches the
coordinator and saves its default; browsing alone does neither. This change does
not modify saved profile assignments or the model catalogue.

## Verification

- 129 Chromium checks passed across the picker (11), model picker (24), and full
  chat view (94). These include locked provider browsing, return to Codex,
  disabled custom/profile shortcuts, foreign coordinator selection in a fresh
  draft, reopening, keyboard navigation, personal/mixed ordering and a 390px
  scrolling viewport.
- Full fork `vp check`: all 1,724 files formatted, no lint warnings/errors in
  1,619 files. All 13 workspace typechecks passed.
- Actual Electron: clicked both provider tabs, selected Gemini Balanced in a
  fresh draft, reopened on Gemini, then selected Codex Balanced and reopened on
  Codex. Personal/mixed profiles stayed above both lists. Native screenshots
  show three Codex presets and two Gemini presets.
- Logs and screenshots are retained under
  `study-buddy-data/profile-picker-review/2026-10-01-tab-fix/`.

The source desktop check uses an isolated Study Buddy (Dev) Electron session,
backend 13943, frontend 5854, and CDP 9515. The owner's running desktop and
independently installed T3 Code retain their existing processes and state. No
chat prompt was submitted. Locked-conversation coverage is deterministic browser
coverage; this is not frozen-candidate Windows/Fedora packaged acceptance.

UI commit `b4888d57207d3579e3442284a26cdc53a3ce0da1` and the parent pointer/documentation are committed locally.
They have not been pushed, merged, packaged, published, or release-accepted.
