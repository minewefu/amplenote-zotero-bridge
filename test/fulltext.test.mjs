import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { ZoteroCore as Core } from "../core.mjs";
import { createPlugin } from "../plugin.mjs";
import { reference, service, jsonResponse, FakeApp, pdf, TestDOMParser } from "./fixtures.mjs";

const indexed = content => ({ content, indexedPages: 2, totalPages: 2 });
function setup(content = "First paragraph.\n\nSecond paragraph.", options = {}, extra = {}) {
  const app = new FakeApp(options);
  const s = service({ children: { ITEM0001: [pdf] }, fulltexts: { PDFD0001: indexed(content) }, ...extra });
  const plugin = createPlugin({ fetchImpl: s.fetch });
  return { app, s, plugin, run: () => plugin.appOption["Sync selected references"].call(plugin, app) };
}
const mainNotes = app => [...app.notes.values()].filter(n => n.tags.some(t => t.startsWith("zotero-record/")));
const textNotes = app => [...app.notes.values()].filter(n => n.tags.some(t => t.startsWith("zotero-text/")));

test("item text versions do not replace or conflict with the library version", async () => {
  const s = service({ children: { ITEM0001: [pdf] }, fulltexts: { PDFD0001: indexed("Indexed article.") }, fulltextVersions: { PDFD0001: 7 } });
  const client = new Core.Client({ libraryId: "123" }, s.fetch);
  const details = await client.details(reference());
  assert.equal(client.libraryVersion, "42");
  assert.equal(details.fulltexts[0].contentVersion, "7");
  assert.equal(details.fulltexts[0].content, "Indexed article.");
  assert.equal(new URL(s.calls.at(-1).url).searchParams.get("since"), "42");
});

test("no synced index is distinct from an empty available index", async () => {
  const missing = setup("", {}, { fulltexts: {} });
  assert.equal((await missing.run()).created, 1);
  assert.equal(textNotes(missing.app).length, 0);
  assert.match(mainNotes(missing.app)[0].body, /No synced text index is available/);
  const empty = setup("", {}, { fulltexts: { PDFD0001: { content: "", indexedPages: 0, totalPages: 0 } } });
  assert.equal((await empty.run()).created, 1);
  assert.equal(textNotes(empty.app).length, 1);
  assert.match(mainNotes(empty.app)[0].body, /Coverage is not established/);
});

test("authorization and rate errors do not masquerade as missing full text", async () => {
  for (const status of [401, 403, 429]) {
    const h = setup("", {}, { intercept: u => u.pathname.endsWith("/fulltext") && u.pathname.includes("/items/") ? jsonResponse({}, {}, status) : null });
    assert.equal(await h.run(), null);
    assert.equal(h.app.notes.size, 0);
    assert.match(h.app.alerts.join("\n"), new RegExp(`HTTP ${status}`));
  }
});

test("text snapshot changes abort before any note mutation", async () => {
  for (const response of [() => jsonResponse({}, { "Last-Modified-Version": "43" }), () => jsonResponse({ PDFD0001: 43 })]) {
    const h = setup("Text", {}, { intercept: u => u.pathname === "/users/123/fulltext" ? response() : null });
    assert.equal(await h.run(), null);
    assert.equal(h.app.notes.size, 0);
    assert.match(h.app.alerts.join("\n"), /changed during sync/);
  }
});

test("text opt-out avoids index requests and linked text notes", async () => {
  const h = setup("Text", { importFullText: false });
  assert.equal((await h.run()).created, 1);
  assert.equal(textNotes(h.app).length, 0);
  assert.ok(h.s.calls.every(c => !new URL(c.url).pathname.endsWith("/fulltext")));
  assert.doesNotMatch(mainNotes(h.app)[0].body, /Indexed article text/);
});

test("malformed text and incomplete coverage metadata stop the import", async () => {
  for (const data of [{ content: 42 }, { content: "X", indexedPages: -1, totalPages: 2 },
    { content: "X", indexedChars: 5 }, { content: "X", indexedPages: 3, totalPages: 2 }]) {
    const h = setup("", {}, { fulltexts: { PDFD0001: data } });
    assert.equal(await h.run(), null);
    assert.equal(h.app.notes.size, 0);
    assert.match(h.app.alerts.join("\n"), /invalid/);
  }
});

test("partial page and character indexes retain all returned text and disclose coverage", async () => {
  for (const coverage of [{ indexedPages: 2, totalPages: 8 }, { indexedChars: 10, totalChars: 100 }]) {
    const h = setup("", {}, { fulltexts: { PDFD0001: { content: "Available indexed text.", ...coverage } } });
    assert.equal((await h.run()).created, 1);
    assert.match(mainNotes(h.app)[0].body, /partial index/);
    assert.match(textNotes(h.app)[0].body, /Available indexed text/);
  }
});

test("oversized and invalid UTF-8 text responses fail before any notes exist", async () => {
  const oversized = setup("X".repeat(100), { maxFullTextBytes: 20 });
  assert.equal(await oversized.run(), null);
  assert.match(oversized.app.alerts.join("\n"), /Full-text response exceeds/);
  assert.equal(oversized.app.notes.size, 0);
  const invalid = setup("", {}, { intercept: u => u.pathname.includes("/items/") && u.pathname.endsWith("/fulltext")
    ? new Response(new Uint8Array([0xff, 0xfe])) : null });
  assert.equal(await invalid.run(), null);
  assert.equal(invalid.app.notes.size, 0);
});

test("long article import preserves every numbered paragraph below the native per-call limit", async () => {
  const paragraphs = Array.from({ length: 2500 }, (_, i) => `Record ${String(i).padStart(4, "0")} - complete source text with <angle> & [literal] punctuation and a final token END${i}.`);
  const h = setup(paragraphs.join("\n\n"));
  const sizes = [], insert = h.app.insertNoteContent.bind(h.app);
  h.app.insertNoteContent = async (...args) => { sizes.push(args[1].length); return insert(...args); };
  assert.equal((await h.run()).created, 1, h.app.alerts.join("\n"));
  assert.ok(textNotes(h.app).length > 1);
  assert.ok(sizes.every(size => size <= 100000));
  const imported = [];
  for (const n of textNotes(h.app)) {
    const html = await h.app.htmlFromContent(n.body);
    const text = new TestDOMParser().parseFromString(html, "text/html").body.textContent;
    imported.push(...text.matchAll(/Record (\d{4}) - complete source text with <angle> & \[literal\] punctuation and a final token END(\d+)\./g));
  }
  assert.equal(imported.length, paragraphs.length);
  imported.forEach((match, i) => { assert.equal(Number(match[1]), i); assert.equal(Number(match[2]), i); });
  assert.equal(mainNotes(h.app).length, 1);
  const count = h.app.notes.size, writes = h.app.writes;
  assert.equal((await h.run()).unchanged, 1);
  assert.equal(h.app.notes.size, count);
  assert.equal(h.app.writes, writes);
});

test("literal markup stays text and surrogate pairs survive part boundaries", async () => {
  const literal = "# Heading\n- list\n1. item\n> quote\n![image](https://example.invalid) <script>x</script> &lt; `code` \\\n";
  const content = "x".repeat(29999) + "😀" + literal;
  const h = setup(content);
  assert.equal((await h.run()).created, 1, h.app.alerts.join("\n"));
  const client = new Core.Client({ libraryId: "123" }, h.s.fetch);
  const { fulltexts } = await client.details(reference());
  const parts = await Core.fullTextParts(client.config, fulltexts);
  assert.equal(parts.map(p => p.chunk).join(""), content);
  for (const part of parts) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(part.chunk));
    const managed = Core.managedTextPart(part.markdown, part);
    const html = await h.app.htmlFromContent(managed);
    const document = new TestDOMParser().parseFromString(html, "text/html");
    assert.equal(document.querySelector("script,img,a,ul,ol,blockquote,pre,h1"), null);
    assert.equal(Core.canonicalHtmlText(html), Core.canonicalPlainText(part.chunk));
  }
});

test("full-text changes and reversions create parent revisions while reusing identical text", async () => {
  const h = setup("Original article text.");
  await h.run();
  const parent = mainNotes(h.app)[0], originalPart = textNotes(h.app)[0];
  parent.body += "\nMy parent notes.\n";
  originalPart.body += "\nMy reading notes.\n";
  const originalBody = originalPart.body;
  h.s.fulltexts.PDFD0001.content = "Revised article text.";
  h.s.fulltextVersions.PDFD0001 = 43; h.s.state.libraryVersion = "43";
  assert.equal((await h.run()).updated, 1);
  assert.equal(textNotes(h.app).length, 2);
  assert.equal(originalPart.body, originalBody);
  assert.match(parent.body, /My parent notes/);
  h.s.fulltexts.PDFD0001.content = "Original article text.";
  h.s.fulltextVersions.PDFD0001 = 44; h.s.state.libraryVersion = "44";
  assert.equal((await h.run()).updated, 1);
  assert.equal(textNotes(h.app).length, 2);
  assert.equal(originalPart.body, originalBody);
  assert.equal((await h.run()).unchanged, 1);
  assert.equal((parent.body.match(/^Zotero import revision:/gm) || []).length, 3);
});

test("native unescaped HTML delimiters in literal-text exports do not drop source characters", async () => {
  const h = setup("Literal <angle> and &lt; entity-looking text, & plain ampersand.\\\nNext paragraph <other>.");
  const get = h.app.getNoteContent.bind(h.app);
  h.app.getNoteContent = async handle => (await get(handle)).replace(/\\([<>&])/g, "$1");
  assert.equal((await h.run()).created, 1, h.app.alerts.join("\n"));
  assert.equal((await h.run()).unchanged, 1);
  assert.equal(h.app.notes.size, 2);
  const part = textNotes(h.app)[0];
  part.body = part.body.replace("Literal", "Modified");
  assert.equal((await h.run()).failed, 1);
  assert.match(part.body, /Modified/);
});

test("metadata-only updates do not duplicate unchanged article text", async () => {
  const h = setup("Stable indexed text.");
  await h.run();
  const first = textNotes(h.app)[0];
  h.s.items[0].data.title = "Corrected citation title";
  assert.equal((await h.run()).updated, 1);
  assert.equal(textNotes(h.app).length, 1);
  assert.equal(textNotes(h.app)[0].uuid, first.uuid);
});

test("a parent edit observed while text parts are prepared aborts the parent update", async () => {
  const h = setup("First article."); await h.run();
  const parent = mainNotes(h.app)[0], render = h.app.htmlFromContent.bind(h.app);
  h.s.fulltexts.PDFD0001.content = "Changed article.";
  let editPending = true;
  h.app.htmlFromContent = async markdown => {
    if (editPending) { editPending = false; parent.body += "\nConcurrent parent annotation.\n"; }
    return render(markdown);
  };
  const result = await h.run();
  assert.equal(result.failed, 1);
  assert.match(result.error, /reference note changed/);
  assert.equal((parent.body.match(/^Zotero import revision:/gm) || []).length, 1);
  assert.match(parent.body, /Concurrent parent annotation/);
  assert.equal((await h.run()).updated, 1);
  assert.match(parent.body, /Concurrent parent annotation/);
  assert.equal(textNotes(h.app).length, 2);
});

test("edited or missing managed text is not overwritten or reported unchanged", async () => {
  const edited = setup("Important source phrase."); await edited.run();
  const part = textNotes(edited.app)[0]; part.body = part.body.replace("Important source phrase", "Edited phrase");
  const kept = part.body;
  assert.equal((await edited.run()).failed, 1);
  assert.equal(part.body, kept);
  assert.equal(edited.app.notes.size, 2);
  const missing = setup("A source phrase."); await missing.run();
  missing.app.notes.delete(textNotes(missing.app)[0].uuid);
  assert.equal((await missing.run()).failed, 1);
  assert.equal(missing.app.notes.size, 1);
});

test("interrupted part writes resume without duplicating completed text notes", async () => {
  const h = setup("A".repeat(40000));
  const insert = h.app.insertNoteContent.bind(h.app); let calls = 0;
  h.app.insertNoteContent = async (...args) => { if (++calls === 2) throw new Error("Interrupted second part"); return insert(...args); };
  assert.equal((await h.run()).failed, 1);
  assert.equal(mainNotes(h.app).length, 0);
  assert.equal(textNotes(h.app).length, 2);
  const first = textNotes(h.app)[0], kept = first.body;
  h.app.insertNoteContent = insert;
  assert.equal((await h.run()).created, 1);
  assert.equal(textNotes(h.app).length, 2);
  assert.equal(first.body, kept);
  assert.equal(mainNotes(h.app).length, 1);
});

test("empty host backslash export recovers a failed parent write without a duplicate", async () => {
  const h = setup("Reusable source text.");
  const insert = h.app.insertNoteContent.bind(h.app);
  h.app.insertNoteContent = async (handle, content, options) => {
    if (content.startsWith("## Zotero reference")) { h.app.notes.get(handle.uuid).body = "\\"; throw new Error("Parent write failed"); }
    return insert(handle, content, options);
  };
  assert.equal((await h.run()).failed, 1);
  h.app.insertNoteContent = insert;
  assert.equal((await h.run()).updated, 1);
  assert.equal(textNotes(h.app).length, 1); assert.equal(mainNotes(h.app).length, 1);
});

test("generated bundle executes the indexed-text import with real DOM parsing", async () => {
  const h = setup("Bundled article: <text> & punctuation.");
  const source = await readFile(new URL("../dist/plugin.js", import.meta.url), "utf8");
  const context = { fetch: h.s.fetch, URL, Response, AbortController, setTimeout, clearTimeout,
    TextEncoder, TextDecoder, DOMParser: TestDOMParser, crypto: globalThis.crypto, btoa };
  const plugin = vm.runInNewContext("(" + source + ")", context, { timeout: 1000 });
  const run = () => plugin.appOption["Sync selected references"].call(plugin, h.app);
  assert.equal((await run()).created, 1, h.app.alerts.join("\n"));
  assert.equal(h.app.notes.size, 2);
  assert.equal((await run()).unchanged, 1);
});
