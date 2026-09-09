# Native PDF upload diagnostic

This diagnostic uses an original, one-page, 1,924-byte PDF. It does not contact Zotero and is separate from the production plugin.

Place `native-pdf-probe.js` in the first JavaScript code block of a temporary Amplenote plugin note, with normal plugin metadata, and invoke **Validate original PDF upload**. It creates one note tagged `test/zotero-attachment-probe`, attempts `app.attachNoteMedia`, and checks the returned attachment through the documented native attachment API and CORS proxy. Re-running reuses the existing test note without uploading again. If the first attempt leaves a note without an attachment, inspect that note before further changes.

On September 9, 2026, `app.attachNoteMedia(noteHandle, dataURL)` returned `NetworkError` for this PDF both on a newly created note and on its saved, permanent note UUID. In contrast, uploading the same file through the normal note toolbar succeeded. The PDF viewer displayed the original one-page document. A native API readback found one attachment and returned identical bytes through Amplenote's documented CORS proxy.

Fixture SHA-256: `b34f9d202c3aa66e479919921033efdd5404e1f1c5d76ce1eefdb98fe6a63e3b`.

These observations establish the normal upload/view/read path, not successful plugin-driven PDF upload. The supported method for uploading PDF documents from a plugin remains unresolved.
