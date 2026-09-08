# Authenticated Amplenote test plan

Status: **not run**. Local fixture passes are recorded separately. Use disposable notes and public/example or owner-authorized library content. Keep account identifiers and keys out of recordings and public artifacts.

Record test time, plugin version and bundle hash, browser/app version, public/private library category, and actual results. A test result is `not_run`, `pass`, `fail`, or `blocked`; do not convert an unobserved case into a pass.

| Case | Procedure and required observation | Status |
| --- | --- | --- |
| Install | Import the generated plugin note; add it in Settings; verify compilation, seven app actions and two insertion actions | not_run |
| Public preview | Configure a public library; preview a bounded collection; no notes are created | not_run |
| Settings | Save library/type/options; reopen Configure and verify values; cancel leaves them unchanged | not_run |
| Private access | Owner supplies a scoped read-only key; preview succeeds; key is absent from plugin note/errors | not_run |
| First import | Import one reference containing a note, PDF, and highlight; compare all displayed content with source | not_run |
| Repeat/reload | Repeat, reload Amplenote, repeat again; one note exists and content is unchanged | not_run |
| Additive change | Add manual text, change source metadata or a child note, sync; new revision is first and manual text remains | not_run |
| Source reversion | Return source to its earlier value; sync; earlier-value revision becomes newest, then next run is unchanged | not_run |
| Filters/tags | Exercise overlapping collections, a tag filter, item-type filter, mapping, and destination changes | not_run |
| Search/cancel | Search/import one reference; cancel at each chooser; cancellation makes no note changes | not_run |
| Insertion | Insert citation and bibliography at an actual cursor; italics survive and each result appears once | not_run |
| Lost cursor | Navigate away while choosing a citation; no unrelated note or selection is changed | not_run |
| File copying | Enable PDF copy for a permitted small file; view the uploaded PDF and compare it with source; repeat creates no new upload | not_run |
| Size rejection | Use a file above the configured limit; explicit failure precedes note creation | not_run |
| Host failure | On a disposable read-only note or interrupted connection, verify failure counts and that retry recovers without duplicating the note | not_run |
| Operation lock | Keep Configure open while another action is attempted; no parallel request starts; cancel restores normal operation | not_run |
| Automatic opt-in | Fresh install/navigation and cancelled start perform no imports; confirm Start and verify one immediate import | not_run |
| Automatic freshness | Set a one-minute interval; change an authorized source child note; wait for an automatic revision, then verify the next unchanged poll adds no content | not_run |
| Automatic status | Inspect last-run counts and next-check time; successful polls show no dialogs | not_run |
| Automatic stop | Stop during idle, source reading and a write; no future imports begin, an already-mutating reference completes, status settles at stopped | not_run |
| Automatic settings | Change host settings or open Configure; verify automatic sync stops/pauses before using a changed selection or credential | not_run |
| Automatic overlap | Invoke a manual action when a poll is due; verify no overlapping import or duplicate note and one later poll | not_run |
| Automatic errors | Interrupt source/host connectivity during a poll; verify it pauses, exposes accurate status without keys, and does not retry until explicit restart | not_run |
| Automatic lifecycle | Navigate within the app, background/restore it, reload it, disable and re-enable the plugin; check retained contexts, one overdue check, no duplicated driver, and fresh instances start disabled | not_run |
| Plugin replacement | Stop the driver, edit/reinstall the exact bundle, and verify no old-instance timer remains; assess host disposal behavior before promising automatic cleanup | not_run |

After a change, rebuild and run `node verify.mjs`. Repeat affected host cases against that exact bundle. Store host observations under `evidence/host-testing.json` with explicit scope. Never flip `authenticatedHostIntegrationVerified` merely because the fixture suite passes.

Host success would not resolve the remaining feature-parity or publication gates in `SUBMISSION.md`.
