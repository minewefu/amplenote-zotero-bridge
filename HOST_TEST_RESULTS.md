# Amplenote host test results

## September 9 checkpoint: real private-library integration

After account creation and email verification, an original test collection was provisioned in a dedicated private Zotero library through the documented API. A request without credentials returned HTTP 404; the integration's dedicated read-only key could read the same reference and its text index. The setup key was separate, was never given to the plugin, and was revoked after provisioning and source mutations; a subsequent request with it returned HTTP 403.

The published 0.3.0 source was installed and copied back exactly. The collection contained one selected journal article and an excluded book, plus an original child note, a 60,478-byte text file and a 1,924-byte PDF. Collection, tag and item-type filters selected the intended single reference. This is real authenticated Zotero-to-Amplenote coverage, not substituted network responses.

The first import created one reference and two linked notes preserving the complete normalized 59,638-character text index. An unchanged repeat created nothing. Updating only the synced text index to 59,730 characters left the source parent at version 3, yet the next import added a reference revision and two new text notes. A temporary read-only diagnostic used real native note APIs and the authenticated Zotero endpoint to verify complete text, saved reading-note preservation and note counts before and after each source change. The production import actions remained unchanged.

A one-minute automatic run first reported unchanged. After the source abstract changed to revision two, the next scheduled run reported one update and no failures. Native readback confirmed the new abstract, the saved annotation, one parent and four text notes. Automatic sync was then stopped. Reverting the source index to its original text added a reference revision and reused the original two text-note UUIDs. The saved reading note survived all three updates; the final counts were one reference, four additive revisions and four text notes.

The temporary verification action was removed and the published 0.3.0 source restored exactly. PDF copying remains disabled: successful Zotero file upload is not evidence of successful PDF transfer through the Amplenote plugin. Group libraries, remaining failure/lifecycle cases, mobile behavior, recordings, directory publication and bounty acceptance remain unverified.

## September 9 checkpoint: 0.3.0 indexed text

The current client successfully read Zotero's public example: its HTML snapshot had 5,911 indexed characters at content version 3660, while the library version was 3663. The PDF index returned unavailable. No article text was retained in the public API report.

A controlled diagnostic then supplied original synthetic Zotero responses to the actual importer and used real Amplenote APIs. The 70,318-character source created one reference and three complete text parts. A source update created three new versioned parts, an unchanged repeat created none, and a reversion reused the original three. The reference remained unique.

The first live verification failed because `getNoteContent` left literal HTML delimiters unescaped, and `htmlFromContent` subsequently interpreted them as markup. The actual editor still contained the original literal text. A read-only comparison isolated this mismatch. The corrected literal-text validation passed without overwriting the preserved part.

An editor annotation outside the managed text region survived. Parent-annotation checks initially differed between browser clients: the editing client returned the annotation, while another returned an older snapshot. This was not counted as a preservation pass. A subsequent test required the saved annotation to be visible through the API before each operation in the editing client; update, unchanged repeat and reversion all retained it. Cross-client safety remains unverified and is not promised.

All 94 local tests pass, including a simulated concurrent parent edit that is detected before a prepared update is inserted. These local tests and original-fixture host checks do not prove private/group access or owner-controlled Zotero source mutation behavior.

## September 9 checkpoint: 0.2.2

The 0.2.2 source was published at `351928fa21ff1aa4d2034a4ac9aed95f31791605`, copied into the existing plugin note, and copied back for comparison. All 40,697 normalized source characters matched. The note reported synchronized state. Automatic sync was off before replacement; it was not enabled during this test.

The saved public-library configuration was read back after a client refresh. A search for `A Unified Zotero Experience` returned its intended public reference. Selecting it for PDF copying ended with `Zotero action stopped: Failed to fetch`; this was not a successful import.

Separate read-only protocol checks downloaded the public example's 329,157-byte PDF and matched its Zotero metadata checksum. The redirected Zotero S3 server returns no CORS permission for the plugin origin and rejects preflight with HTTP 403. Amplenote's documented CORS proxy returns HTTP 400 for the Zotero API URL; Zotero is absent from the documented allowlist. Browser PDF copying remains blocked pending a supported file-access route.

The separate native attachment diagnostic now ran twice. `app.attachNoteMedia` returned `NetworkError` first on a newly created test note and then on its saved, permanent UUID. The subsequent normal toolbar upload succeeded. Amplenote's viewer rendered the original one-page PDF, and a native `getNoteAttachments`/`getAttachmentURL` read through the documented CORS proxy returned exactly 1,924 bytes with the original SHA-256 (`b34f9d202c3aa66e479919921033efdd5404e1f1c5d76ce1eefdb98fe6a63e3b`). This proves the normal UI upload/view/read path, not successful plugin-driven PDF upload. The original plugin source was restored and copied back for exact verification; optional PDF copying and automatic sync were left off.

The [original fixture and diagnostic](diagnostics/README.md) provide a reproducible case for the supported plugin-upload-method question. Both that request and the separate Zotero CORS allowlist request were sent to support. No bounty acceptance has been received.

The 75 local tests include a before/after regression for accepting a mismatched PDF version, binary checksum boundaries, and an upload using the generated bundle with a simulated host. Those tests do not substitute for the failed real browser download.

## Earlier 0.2.1 checks

Observed September 8, 2026 in Chrome on Windows, using Zotero Bridge 0.2.1 and Zotero's documented public example library. These are actual Amplenote observations, separate from the 70 local fixture tests. The full host test plan and bounty requirements are not yet satisfied.

## Verified behavior

| Check | Observed result |
| --- | --- |
| Installation | Imported a development note, repaired its code through the editor, activated the plugin, and configured its four settings. |
| Code readback | Copied the installed code from the editor and compared it with the generated bundle, ignoring only the terminal newline. |
| Public preview | Displayed 20 references, matching an independent request to the same Zotero collection. |
| Single-reference search/import | Imported the reference with key `33TK9NH9`; displayed metadata, bibliography, abstract, and source attachment link. |
| Repeat and manual text | Repeated import reported unchanged; one note and one revision remained; the editor body and added manual sentence were unchanged. |
| Citation insertion | Inserted `(Lima et al., 2011)` once at the selected cursor position. |
| Bibliography insertion | Inserted one bibliography entry; the journal and volume retained italics. |
| Configuration and item-type filtering | Saved an artwork-only filter; preview returned one reference, Sherlock Holmes. |
| Cancel automatic start | Cancellation left the note count unchanged and created no artwork note. |
| Automatic first import | The confirmed one-minute driver created the filtered reference `6MCAN2NC` with identity, destination, and source tags. |
| Automatic repeats | Status reported one unchanged reference, zero failures and a later scheduled check; no duplicate reference appeared. |
| Navigation while enabled | After opening the imported note, status remained waiting and a later scheduled run again reported one unchanged reference. |
| Stop | The stop action confirmed automatic sync stopped in that client. |
| Persistence after reload | Reloaded the page and manually synced the one-item selection; result was zero created, zero updated, one unchanged, zero failed. |
| Fresh client state | After reload, automatic status was off with no automatic run recorded in the new session. |

Automatic synchronization was left off after testing. No private Zotero key, payment, or uploaded PDF was used.

## Host failures corrected

The browser rejected the original fetch call because it was invoked as a method of the client object. Binding it to the browser global fixed the live preview. Regression tests require the exact receiver in both direct-client and generated-bundle execution.

The original timer called `app.context.refreshSettings()` after its originating action ended. The host rejected that with Invalid context call. The driver now uses synchronized `app.settings` in timers and refreshes settings in the active navigation callback. Changes from another device remain subject to Amplenote's settings synchronization delay.

The host also returned errors across the sandbox boundary, so checking only `instanceof Error` hid useful messages. Error strings and message properties are now retained, with known API keys redacted.

The Markdown importer added extra empty lines and a stray backslash to the 0.2.0 code. The installed block was replaced with exact generated source. Version 0.2.1 removes repeated blank lines at source joins and the unsupported metadata header row. A fresh import of the final 0.2.1 Markdown file has not been separately verified.

## Still unverified

Source updates/reversions inside an owner-controlled Zotero library; private and group libraries; copying and opening real uploaded PDFs; changes during active reads/writes; complete cancellation/failure-recovery behavior; mobile/background/disable lifecycle; and the remaining cases in `HOST_TEST_PLAN.md`.

The public source library is read-only to this campaign, so it cannot establish live source-change coverage. Passing these smoke checks does not establish parity with the referenced Obsidian integration or entitlement to a bounty.
