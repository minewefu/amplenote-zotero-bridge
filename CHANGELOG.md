# Changes

## 0.3.0 validation follow-up — September 9, 2026

Published and installed the exact generated bundle. Real private-library tests passed for initial import, complete indexed text, unchanged repeat, index-only source changes, a scheduled abstract update and text reversion/reuse. Native readback confirmed that a saved reading note survived each update. The separate temporary setup key was revoked; automatic sync was stopped and temporary diagnostics removed. Group and remaining lifecycle coverage, browser PDF transfer and submission deliverables remain unfinished.

## 0.3.0 — September 9, 2026

Added indexed HTML/PDF/text import through Zotero's documented full-text API. Content-index versions are kept separate from the library version, and missing/partial indexes are reported accurately. Long text is split into versioned linked notes under the host insertion limit; identical parts are reused, and changed managed text is preserved for review.

Added parent-change detection before writing a prepared reference. Live checks exposed literal HTML delimiters left unescaped by the host's Markdown export; validation now protects those literal delimiters before re-rendering, without changing stored text.

All 94 local tests pass. A public API check returned a 5,911-character HTML index. Original-fixture tests with real Amplenote APIs verified a 70,318-character import, updates, repeats, reversions and saved annotations within one client. Separate browser tabs returned different note snapshots, so cross-client safety is not claimed. Private/group integration, PDF copying, the remaining lifecycle cases, videos and bounty submission remain unfinished.

## 0.2.2 — September 9, 2026

PDF copying now compares the downloaded bytes with Zotero's metadata checksum before creating a note or uploading a file. Missing cloud-file checksums and changed files stop with an actionable error. The check works without an exposed ETag header. A regression test reproduced the old importer accepting a mismatched version.

All 75 local tests pass, including RFC checksum vectors, binary boundary comparisons against Node's implementation, and an upload through the generated browser bundle. A read-only public Zotero example downloaded 329,157 bytes and matched its metadata checksum. This does not establish browser CORS, Amplenote upload, private access or complete host coverage.

## 0.2.1 — September 8, 2026

Live Amplenote testing found that storing native `fetch` as a Client method changed its receiver and caused Illegal invocation. The client now binds fetch to the browser global. Error handling now retains string and cross-realm host messages while redacting known keys.

The automatic driver no longer calls context-only settings methods after the originating action ends. Settings refresh runs within `onNavigate`; timer callbacks use synchronized app settings. The host had rejected the old callback with Invalid context call. The corrected driver completed a live initial import, repeated unchanged polls, navigation, and stop. A reload followed by manual sync retained the existing note.

Removed the unsupported Setting name metadata header and trimmed source boundaries to avoid repeated empty lines in the generated code. The imported note was repaired through the editor and its code copied back for exact comparison, ignoring only the terminal newline.

All 70 local tests pass. Live checks passed for public preview (20 records), one-reference import, repeat with manual text preserved, one-item type filtering, configuration, cancelled automatic start, and real cursor citation/bibliography insertion with italics. Full host coverage, mobile/background/disable lifecycle, source mutations, private data and PDF copying remain incomplete. No submission, award, or receipt.

## 0.2.0 — September 8, 2026

Added opt-in synchronization while an Amplenote client remains open, a configurable 1–1440 minute interval (default 15), and start/stop/status actions. Successful runs remain quiet. The driver pauses after errors or settings changes, defers when a manual action is running, and schedules one overdue check on navigation. Enabled state is not persisted.

Automatic cancellation prevents writes when stopped during source reads. Once a reference begins mutating, it finishes before stopping; later references are not attempted. Shared sync code reports partial results and redacts API keys. The generated plugin delegates `onNavigate` to the same instance as its actions.

Ran `node verify.mjs`: all 65 local tests pass, including 24 new automatic-sync cases and generated-bundle execution. Source/bundle hashes match. Updated instructions, inquiry, host plan, and recording outlines. Authenticated host execution, timer lifecycle, feature parity, recordings, publication, acceptance, and payment remain unverified.

## 0.1.1 — September 8, 2026

Corrected import verification to require the newest revision marker. A failed write when reverting Zotero to an older value could previously be mistaken for success because that older marker was still in the note. Incorrect append behavior is now rejected too.

Configuration now holds the operation lock across the dialog and setting writes, releases it after cancellation/error, and reports a failed prompt without leaving the plugin locked. Error redaction covers old and newly entered keys.

Added seven tests, covering these four reproduced failure cases, single-reference import/repeat/cancellation, and tag failure on repeat. All 41 local tests pass. The generated manifest now derives its version from package metadata. Added installation, requirements, host-test, and recording documents plus an unsent inquiry. Authenticated host integration and bounty acceptance remain unverified.
