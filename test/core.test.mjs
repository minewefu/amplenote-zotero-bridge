import test from "node:test";
import assert from "node:assert/strict";
import { ZoteroCore as Core } from "../core.mjs";
import { reference, service, jsonResponse, pdf, note, annotation } from "./fixtures.mjs";

const settings = extras => ({ libraryId: "123", ...extras });

test("fetch uses the browser global receiver rather than the Client instance", async () => {
  const s = service();
  function browserFetch(...args) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    return s.fetch(...args);
  }
  const client = new Core.Client(settings(), browserFetch);
  assert.equal((await client.items()).length, 1);
});

test("configuration rejects invalid identifiers and limits", () => {
  for (const bad of [{ libraryId: "name" }, { libraryType: "other" }, { collections: ["short"] },
    { maxItems: 0 }, { maxAttachmentBytes: 0 }, { tags: "science" }, { tagMap: [] }, { destinationTag: "a,b" }]) {
    assert.throws(() => Core.config(settings(bad)));
  }
  assert.equal(Core.config(settings({ libraryType: "groups" })).libraryType, "groups");
});

test("selection combines collection, tag and type filters; excludes child objects", () => {
  const c = Core.config(settings({ collections: ["COLL0001"], tags: ["science"], itemTypes: ["book"] }));
  assert.equal(Core.selected(c, reference("ITEM0001", { itemType: "book", collections: ["COLL0001"] })), true);
  assert.equal(Core.selected(c, reference()), false);
  assert.equal(Core.selected(Core.config(settings()), pdf), false);
  assert.equal(Core.selected(Core.config(settings()), reference("ITEM0001", { deleted: 1 })), false);
});

test("tag mapping retains source identity independently of destination tag", () => {
  const c = Core.config(settings({ tagMap: { science: "reading/physics" } }));
  assert.deepEqual(Core.tagNames(c, reference()), ["research/zotero", "zotero-record/users/123/item0001", "reading/physics"]);
  assert.equal(Core.identityTag({ ...c, destinationTag: "other" }, reference()), Core.identityTag(c, reference()));
});

test("HTML conversion preserves basic formatting and treats markup-like text literally", () => {
  assert.equal(Core.htmlToMarkdown("<p>A <i>title</i> &amp; &#x3b1;</p>"), "A *title* & α");
  assert.equal(Core.htmlToMarkdown("<script>ignored()</script><p>&lt;tag&gt; [literal]</p>"), "\\<tag\\> \\[literal\\]");
  assert.equal(Core.safeURL("javascript:ignored"), null);
  assert.equal(Core.safeURL("https://name:password@example.invalid/"), null);
  assert.equal(Core.safeURL("https://example.invalid/a(b)"), "https://example.invalid/a%28b%29");
});

test("render includes metadata, notes, bibliography, attachment links and text annotations", async () => {
  const c = Core.config(settings()), item = reference("ITEM0001", { DOI: "10.0000/example", url: "https://example.invalid/paper" });
  const digest = await Core.revision(c, item, [note, pdf], [annotation]);
  const body = Core.render(c, item, [note, pdf], [annotation], {}, digest);
  for (const text of ["Alex Example", "Bibliography", "synthetic", "Fixture PDF", "highlighted sentence", "Page 3", "doi.org", digest]) {
    assert.ok(body.includes(text), text);
  }
  assert.ok(!body.includes("<p>"));
  assert.throws(() => Core.render(c, reference("ITEM0001", { abstractNote: "x".repeat(100000) }), [], [], {}, digest), /exceeds/);
});

test("revision changes when a child changes even if parent version does not", async () => {
  const c = Core.config(settings()), item = reference();
  const before = await Core.revision(c, item, [note, pdf], []);
  assert.equal(await Core.revision(c, item, [pdf, note], []), before);
  const changed = structuredClone(note); changed.data.note = "Changed child body";
  assert.notEqual(await Core.revision(c, item, [changed, pdf], []), before);
  assert.notEqual(await Core.revision({ ...c, style: "chicago-author-date" }, item, [note, pdf], []), before);
});

test("pagination retrieves 101 items with documented sort and no key in URL", async () => {
  const items = Array.from({ length: 101 }, (_, i) => reference("I" + String(i).padStart(7, "0")));
  const s = service({ items }), client = new Core.Client(settings({ apiKey: "fixture-key-only" }), s.fetch);
  assert.equal((await client.items()).length, 101);
  assert.equal(s.calls.length, 2);
  assert.equal(new URL(s.calls[1].url).searchParams.get("start"), "100");
  assert.equal(s.calls[0].options.headers.Authorization, "Bearer fixture-key-only");
  assert.ok(s.calls.every(call => !call.url.includes("fixture-key-only")));
});

test("overlapping selected collections import each reference once", async () => {
  const s = service({ items: [reference("ITEM0001", { collections: ["COLL0001", "COLL0002"] })] });
  const client = new Core.Client(settings({ collections: ["COLL0001", "COLL0002"] }), s.fetch);
  assert.equal((await client.items()).length, 1);
  assert.equal(s.calls.length, 2);
});

test("maxItems overflow fails instead of returning a falsely complete selection", async () => {
  const s = service({ items: [reference("ITEM0001"), reference("ITEM0002")] });
  await assert.rejects(new Core.Client(settings({ maxItems: 1 }), s.fetch).items(), /maxItems/);
});

test("repeated pagination and changed library versions stop processing", async () => {
  const items = Array.from({ length: 100 }, (_, i) => reference("I" + String(i).padStart(7, "0")));
  const duplicate = service({ intercept: () => jsonResponse(items) });
  await assert.rejects(new Core.Client(settings(), duplicate.fetch).items(), /repeated/);
  const drift = service({ intercept: (_url, n) => n === 1 ? jsonResponse(items) : jsonResponse([], { "Last-Modified-Version": "43" }) });
  await assert.rejects(new Core.Client(settings(), drift.fetch).items(), /changed during sync/);
});

test("rate limit pauses later calls and never retries automatically", async () => {
  const s = service({ intercept: () => jsonResponse({}, { "Retry-After": "60" }, 429) });
  const client = new Core.Client(settings(), s.fetch);
  await assert.rejects(client.items(), /HTTP 429/);
  await assert.rejects(client.items(), /pause/);
  assert.equal(s.calls.length, 1);
});

test("successful Backoff response is honored before the next request", async () => {
  const s = service({ intercept: () => jsonResponse([reference()], { Backoff: "60" }) });
  const client = new Core.Client(settings(), s.fetch);
  assert.equal((await client.items()).length, 1);
  await assert.rejects(client.details(reference()), /pause/);
  assert.equal(s.calls.length, 1);
});

test("details retrieves nested PDF annotations", async () => {
  const s = service({ children: { ITEM0001: [pdf, note], PDFD0001: [annotation] } });
  const details = await new Core.Client(settings(), s.fetch).details(reference());
  assert.equal(details.children.length, 2);
  assert.equal(details.annotations[0].data.annotationPageLabel, "3");
});

test("file reader handles base64 and rejects oversized declared and streamed bodies", async () => {
  const client = new Core.Client(settings({ maxAttachmentBytes: 4 }));
  assert.equal(await client.readFile(new Response(new Uint8Array([65, 66]), { headers: { "Content-Type": "application/pdf" } })), "data:application/pdf;base64,QUI=");
  await assert.rejects(client.readFile(new Response("12345", { headers: { "Content-Length": "5" } })), /size limit/);
  await assert.rejects(client.readFile(new Response("12345")), /size limit/);
});

test("unexpected resource paths are rejected before any fetch", async () => {
  const s = service(), client = new Core.Client(settings(), s.fetch);
  await assert.rejects(client.request("../other"), /Unsupported/);
  assert.equal(s.calls.length, 0);
});
