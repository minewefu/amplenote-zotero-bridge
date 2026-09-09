# Zotero Bridge for Amplenote

Development candidate 0.2.2. **Not submitted or represented as bounty-complete.** The earlier 0.2.1 build passed public-library preview, single-reference import/repeat, manual-text preservation, cursor citation/bibliography insertion, and automatic start/repeat/navigation/stop inside Amplenote. Version 0.2.2 adds PDF file-version checks and still needs its own host verification. See `HOST_TEST_RESULTS.md` for the exact earlier scope.

This plugin imports Zotero reference metadata, abstracts, child notes, and text annotations into Amplenote. It searches references and inserts formatted citations or bibliography entries at the current cursor. Zotero access is read-only. Changed imports are prepended as revisions so existing text and manual notes remain.

## Local verification

With Node.js 22 or newer, run these commands from this directory. No dependency installation is needed.

```text
node verify.mjs
```

The verified 0.2.2 build passes 75/75 tests. `evidence/verification.json` records the source/bundle hashes, runtime, test counts, and scope. Tests use synthetic Zotero responses, an in-memory Amplenote adapter, and a deterministic clock, including execution of the generated plugin object. The 25 automatic-sync cases cover opt-in, child updates, cancellation, overlap, settings changes, partial failures, and redacted status. PDF-version tests cover changed files before note mutation, absent checksums, binary boundaries and generated-bundle uploads. The earlier 0.1.1 regression transcript and source hash remain under `evidence/regression-before.*`.

The earlier `evidence/live-smoke.json` proves one unauthenticated request to Zotero's documented public example, decoding citations/bibliography, and local rendering. It does not verify private authentication, file copying, browser CORS behavior, or Amplenote execution. Do not relabel this as an end-to-end pass.

## Install for host testing

Use a dedicated test account or disposable notes. Import `dist/PLUGIN_NOTE.md` as an Amplenote note, retaining its settings table and first JavaScript code block. Alternatively, create a note and copy the rendered table plus `dist/plugin.js` into the first JavaScript code block. Then select the note under Settings > Plugins > Add a plugin, following the [official builder guide](https://www.amplenote.com/help/guide_to_developing_amplenote_plugins).

Open Quick Open and choose **Zotero Bridge: Configure**. Supply a personal/group library type and numeric library ID. Public libraries can use an empty API key. Enter a dedicated read-only key for a private library in the configuration dialog; never paste it into the plugin note, repository, recording, or submission email.

The Markdown importer was observed adding blank-line artifacts and a stray backslash to the 0.2.0 code. Check the code block after import; if necessary, replace it with the exact contents of `dist/plugin.js`. Version 0.2.1 removes the extra metadata header and repeated blank lines at bundle joins. Installation through the note editor has been verified; a fresh 0.2.1 file import still requires its own check.

Run **Preview selection** before **Sync selected references**. To test one item, use **Search and import one reference**. With a cursor in an editable note, invoke **Insert formatted citation** or **Insert bibliography entry** through the text insertion plugin menu.

## Automatic synchronization

After checking the selection, choose **Start automatic sync in this client** and confirm. The driver imports immediately, then schedules the next check after each completed run. `autoSyncMinutes` defaults to 15 and accepts whole numbers from 1 to 1440. This option sets the interval; saving it alone never enables automatic imports.

Use **Show automatic sync status** to see the last result and next check, or **Stop automatic sync** to stop. A stop before note mutation prevents that import. A reference already being written finishes; later references are left untouched. Success is quiet. Errors or detected settings changes pause the driver and require an explicit restart. Timer polls inspect synchronized `app.settings`; a navigation callback can refresh settings through its live context. Cross-device changes are subject to the host's settings synchronization delay. Opening Configure also stops it, even if the dialog is cancelled. A manual action postpones an overlapping automatic check by 30 seconds.

Run automatic sync on only one client. Enabled state is held in memory and is not restored by a fresh plugin instance. There is no closed-app service. Browser throttling can delay checks; navigation schedules one overdue check. Repeated timer-driven imports, navigation, stop, and fresh state after reload have been checked in Chrome. Reload while enabled, disable behavior, mobile/background operation, and the full lifecycle matrix still require host verification. Stop automatic sync before editing or replacing the plugin code.

## Configuration

The four settings are `Library type`, `Library ID`, `API key`, and `Options JSON`. Example options using synthetic collection keys and source tags:

```json
{
  "collections": ["COLL0001"],
  "tags": ["science"],
  "itemTypes": ["journalArticle", "book"],
  "tagMap": {"science": "reading/science"},
  "destinationTag": "research/zotero",
  "style": "apa",
  "locale": "en-US",
  "copyAttachments": false,
  "autoSyncMinutes": 15,
  "maxItems": 1000,
  "maxAttachmentBytes": 10485760
}
```

Replace the example collection key with your own or use an empty list. Each filter list is an OR within that list; nonempty collection, tag, and item-type filters combine with AND. Filters use exact source values. Unmapped source tags are added beneath the destination tag. Existing tags are retained when mappings change. The item limit also bounds intermediate fetched lists, so a large library can require a narrower collection before tag filtering.

`copyAttachments` enables copying uploaded Zotero PDF attachments to Amplenote. It defaults off. Linked local files are not copied; other attachments remain links to their source. Each copied file must match the MD5 version checksum in its Zotero metadata. Missing or mismatched checksums stop the import before a note is created or the file is uploaded; finish Zotero file synchronization and run sync again. This checksum is for version comparison, not authentication. Per-file limits default to 10 MiB and cannot exceed 50 MiB. The selected-item limit cannot exceed 10,000. Imports over 95,000 characters fail rather than silently truncate. These limits do not establish a maximum total account storage requirement.

## Current limitations

Manual sync and opt-in periodic sync have passed selected public-library host checks. Private-library, live source-update, PDF-copy, and remaining lifecycle scenarios are still unverified. Only cloud-synced Zotero data is available. PDF image/ink annotations point to the source rather than exporting crops. Nunjucks templates, Better BibTeX integration, arbitrary export formats, local-only files, and whole-article HTML capture are not implemented. These differences matter because the bounty explicitly requests parity with an Obsidian integration; see `SUBMISSION.md`.

Only one client should sync a library at a time. Cross-device transactions are unavailable in this implementation. A failed operation may leave an empty tagged note or an uploaded attachment; re-running can recover the note but does not guarantee attachment deduplication after partial failure. The latest revision marker is checked after writes, but that check is not proof that every rendered character survived host conversion.

## Project layout

`core.mjs` handles Zotero requests, filters, identity, revisions, and rendering. `plugin.mjs` implements Amplenote actions. `build.mjs` emits the installable object and note. `test/` covers read/write behavior and failure recovery. `HOST_TEST_PLAN.md` contains the remaining manual cases. `VIDEO_SCRIPTS.md` prepares the two walkthroughs; recordings have not been created.

MIT licensed; see `LICENSE`. No upstream Obsidian source was copied into this continuation.
