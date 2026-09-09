# Zotero Bridge for Amplenote

Development candidate 0.3.0. Bounty acceptance and payment are unconfirmed; the directory listing and complete host-validation matrix remain unfinished.

The plugin imports Zotero reference metadata, abstracts, child notes, annotations and available indexed article text. It searches references, inserts formatted citations and bibliography entries, and can sync a selected library or collection while the Amplenote client remains open. Zotero access is read-only.

## Indexed article text

Available HTML, PDF and text indexes are copied into linked Amplenote notes. Each part contains at most 30,000 source characters, keeping its escaped Markdown below Amplenote's 100,000-character insertion limit. Long documents are preserved across multiple parts; no truncated text is presented as a complete import.

The reference note shows Zotero's page or character coverage, including a partial-index notice when appropriate. A missing index is reported separately from an empty available index. Coverage describes what Zotero indexed, not a guarantee that its index contains every part of the original document.

Identical text parts are reused across repeats and metadata updates. Text changes create versioned parts; reverting to earlier text reuses its existing parts. Add your reading notes outside the marked managed-text region. A changed managed region stops the import and is preserved for review. Completed parts can be reused after an interrupted import, and the parent revision is added only after all its parts are verified.

Reference sync results count references, not the additional text notes. Formatting and whitespace follow Amplenote's Markdown renderer; verification checks the complete normalized text, including literal punctuation.

## Develop and test

Use a Node version supported by `package.json` (Node 24.15+ in the 24.x line is supported).

```sh
npm ci --ignore-scripts
node verify.mjs
```

All 94 local tests pass on Node 24.18.0. They cover source preservation, file-version checks, long indexed documents, partial/missing indexes, independent text/library versions, interruptions, retries, manual annotations and automatic-sync cancellation. The generated bundle is executed in the test harness. `marked` and `jsdom` are development dependencies; the distributed plugin does not load them.

Real private-library checks also pass for the selected cases: collection/tag/type filtering, initial import, unchanged repeat, a 59,638-character indexed article, index-only source changes, a scheduled abstract update, reversion/reuse and saved reading notes in one client. The source was an original fixture stored in an owner-controlled Zotero account, accessed by the plugin with a dedicated read-only key. A temporary read-only diagnostic compared native note content with the actual authenticated Zotero index; it was removed after testing. See `HOST_TEST_RESULTS.md` for scope and remaining gaps.

Earlier component checks used a public 5,911-character HTML index and a 70,318-character synthetic-response fixture with real Amplenote APIs. Those results are recorded separately from the subsequent private-library integration.

## Install for testing

Import `dist/PLUGIN_NOTE.md` through Amplenote's Markdown importer and select its note in Account Settings > Plugins. Alternatively, copy the metadata table and exact `dist/plugin.js` object into a plugin note. Verify the code after importing: earlier host imports changed whitespace in code blocks. Stop automatic sync before replacing the code.

Open Quick Open and choose **Zotero Bridge: Configure**. Enter a personal/group library type and numeric library ID. A public library can use a blank API key. Keep a dedicated private-library read-only key in the configuration dialog, not the source note or repository.

Use **Preview selection**, then **Sync selected references** or **Search and import one reference**. Citation and bibliography insertion are available from the text-insertion plugin menu with an active note cursor.

## Configuration

The four settings are `Library type`, `Library ID`, `API key` and `Options JSON`. An example using synthetic filter values:

```json
{
  "collections": ["COLL0001"],
  "tags": ["science"],
  "itemTypes": ["journalArticle", "book"],
  "tagMap": {"science": "reading/science"},
  "destinationTag": "research/zotero",
  "style": "apa",
  "locale": "en-US",
  "importFullText": true,
  "copyAttachments": false,
  "autoSyncMinutes": 15,
  "maxItems": 1000,
  "maxAttachmentBytes": 10485760,
  "maxFullTextBytes": 10485760
}
```

Each filter list is OR within that list; nonempty collection, tag and item-type filters combine with AND. Replace the sample collection key or use an empty list. Unmapped source tags are added beneath the destination tag, and existing tags remain when mappings change.

`importFullText` defaults to true. Set it to false to skip index requests and new text copies; this does not delete existing copies. `maxFullTextBytes` bounds each JSON text response, defaults to 10 MiB, and can be set up to 50 MiB. Exceeding a limit stops the import rather than truncating it. The reference metadata/index itself must fit a 95,000-character insertion; large article bodies use the linked parts.

## Automatic sync and preservation

Automatic sync is off in a fresh plugin instance. **Start automatic sync in this client** imports immediately after confirmation and schedules the next check after the current run finishes. The interval accepts 1-1440 minutes. Reloading or closing the client stops it; this is not a closed-app service. Errors pause the driver until explicit restart.

**Stop automatic sync** prevents the next read/write unit. An in-flight text part finishes, then later parts and the parent update are left for a future run. Once the parent begins its own mutation, that reference finishes. Completed text parts are reusable after a stop or failure. Opening Configure stops the automatic driver.

Use the same client for editing and importing. Live checks found that separate browser tabs could return different snapshots of a note. An observed parent edit while an import is being prepared now stops its content update, but the documented API offers no atomic compare-and-swap operation. Concurrent changes from other clients cannot be guaranteed safe. Prior imported revisions and annotations outside managed regions are retained in the verified single-client workflow.

## Remaining limitations

Browser PDF copying is unresolved. Zotero's file server does not permit the plugin origin, and Zotero is absent from Amplenote's documented CORS-proxy allowlist. Separately, `app.attachNoteMedia` returned `NetworkError` for an original PDF, although normal toolbar upload, native viewing and byte-identical API readback succeeded. The [diagnostic](diagnostics/README.md) is available, and both questions were sent to support. Keep `copyAttachments` false until a supported route is available.

Only synced indexed text is available through the web API. Local-only files, PDF image/ink crops, Better BibTeX workflows, Nunjucks templates and arbitrary export formats remain outside this candidate. The bounty brief qualifies feature parity as “or as close as possible”; sponsor acceptance of this scope is still required.

Group-library integration, remaining failure cases, full mobile/background/disable lifecycle coverage, the two demonstration recordings and directory publication remain unfinished. Passing the listed private-library checks is not bounty acceptance or received earnings.

Original code is MIT-licensed; see `LICENSE`.
