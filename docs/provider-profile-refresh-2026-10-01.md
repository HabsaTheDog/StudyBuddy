# Built-in profile refresh — 2026-10-01

## Decision and UI

The composer has one execution-profile picker. All saved personal and mixed
profiles remain above the built-ins, independent of the browsed provider.
Authenticated usable connections appear as provider-icon tabs inside the
built-in section when there is more than one. Hover names and keyboard tab
navigation are available. Browsing never changes the coordinator; selecting a
profile does. Reopening starts on the active connection. Existing conversation
continuation locks and unavailable mixed-worker checks remain enforced.

| Provider | Offered built-ins | Assignments |
| --- | --- | --- |
| Codex | Fast, Balanced, Quality | Fast: GPT-6.1 Sol Light coordinator, GPT-6 Luna workers, Sol review. Balanced: Sol Medium coordinator and Sol workers, Luna search. Quality: Astra Light coordinator, Astra planning/building/quiz/review and Sol content analysis; Luna search. |
| Google Gemini | Fast, Balanced; one Balanced if only a single usable Flash variant exists | Latest catalogue-reported Flash generation. Fast uses lighter thinking; Balanced uses medium coordination and high-thinking building/review. Worker retries retain native catalogue ids and the thinking levels of their variants. |
| Claude | Fast, Balanced, Quality | Existing catalogue-resolved Haiku/Sonnet/Opus policies. |

The Gemini Quality built-in id from older settings resolves to Balanced. When
only one usable Flash model exists, old Fast/Quality/unknown ids also resolve
safely to Balanced. Saved custom profiles, including old model pins and mixed
account assignments, are never rewritten. Users can duplicate a built-in in
Settings to obtain the refreshed matrix as a custom profile.

Codex models are selected from each connection's catalogue, with bounded
compatibility choices for accounts whose rollout lags: current Sol → previous
Sol → old Terra/Sol; current Luna → old Luna → available Sol; Astra → available
Sol. Models and retries stay inside the known catalogue. Empty catalogue
resolution uses the current defaults until discovery. New chats still require
an authenticated usable catalogue before starting.

Fast no longer opts into accelerated billing automatically. Its name describes
lighter reasoning and smaller workers; all built-ins use standard speed billing.
Standalone workflow defaults and desktop worker assignments remain identical.
Existing deadlines, permission checks, review/publication gates and validation
retry ceilings are retained.

## Price and usage evidence

Checked against official sources on 2026-10-01. The local Codex catalogue cache
was fetched at 2026-10-01T19:20:28Z and lists GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna
and GPT-6 Astra. Gemini discovery already reports opaque low/medium/high Flash
ids, and those exact ids are used rather than API names invented by the picker.

Standard short-context API prices, USD per million tokens:

| Model | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| GPT-6 Luna | $0.10 | $0.01 | $0.50 |
| GPT-6.1 Sol | $2.00 | $0.10 | $10.00 |
| GPT-6 Astra | $10.00 | $1.00 | $50.00 |
| Gemini 3.8 Flash, through 2026-12-31 | $0.75 | $0.075 | $3.75 |
| Gemini 3.8 Flash, from 2027-01-01 | $1.50 | $0.15 | $7.50 |

The OpenAI values come from [API pricing](https://developers.openai.com/api/docs/pricing).
Long-context pricing and accelerated modes can cost more. Google includes
thinking tokens in output pricing; caching also has a storage charge. The
Flash introductory price expires at year-end; see [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

For subscription/credit usage, [OpenAI's rate card](https://learn.chatgpt.com/docs/pricing)
quotes input/cached-input/output credits per million tokens: Luna 2.5/0.25/12.5;
6.1 Sol 50/2.5/250; Astra 250/25/1250. Old 5.6 Luna is 5/0.5/30 and old 5.6 Sol
is 100/10/500. Thus the new smaller models are sensible defaults per token,
while Astra costs five times Sol for uncached input/output. These rates do not
predict included subscription quota consumption by themselves, and more
reasoning can increase generated tokens and duration. No fixed number of chats
or measured savings is promised.

[OpenAI's model guidance](https://learn.chatgpt.com/docs/models) recommends
6.1 Sol for repeated work, Luna for focused high-volume tasks and Astra for
particularly demanding work. This supports the three Codex tiers while keeping
Astra out of Fast and Balanced, including retries.

Google describes [3.8 Flash](https://ai.google.dev/gemini-api/docs/latest-model)
as its strongest current Flash workhorse with low/medium/high thinking. The
[Antigravity catalogue](https://www.antigravity.google/docs/models/) offers it
alongside earlier Flash versions and 3.1 Pro. The current Flash variants already
provide meaningful speed/thinking choices; adding an older Pro-based Quality
preset would imply a quality ladder we have not established on Study Buddy tasks.
Cyber, Live and TTS variants are not general study-agent defaults, and Flash-Lite
API pricing does not imply availability through the connected subscription.

[Antigravity plan quotas](https://antigravity.google/docs/plans) depend on work,
capacity and plan: Pro/Ultra have five-hour refreshes and weekly limits; basic
plans refresh weekly. Optional overages use Gemini Enterprise consumption
pricing. Study Buddy uses the authenticated CLI connection; Developer API
prices are comparative evidence, not its subscription's actual invoice or a
quota multiplier. No subscription or overage setting was changed.

## Development validation and limits

Evidence is retained under `study-buddy-data/profile-picker-review/2026-10-01/`.
Screenshots show the real picker component rendered with deterministic personal
and mixed-profile fixtures in Chromium (`browser-diagnostic`), including a
390px viewport and a scrolling long list. They do not show a native desktop run.
The desktop-managed server requires pairing in a separate collaborative browser;
that browser was not paired or used to submit any model request.

Initial regressions identified old-model fixture expectations and a mixed bridge
fixture whose inherited built-in model differed from its explicitly pinned
request. The bridge fixture now explicitly retains that saved old assignment;
worker authorization remains strict. Current-model and legacy-catalogue fixtures
are covered separately. Final check results are recorded in the development batch.

Pricing and deterministic compatibility guide this refresh. No live study-task
quality, runtime or quota-savings benchmark was performed. Full frozen-batch
review and exact-candidate Windows/Fedora packaged acceptance remain release
requirements.
