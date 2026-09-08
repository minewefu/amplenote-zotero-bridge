# Amplenote host test results

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
