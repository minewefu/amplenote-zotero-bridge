{
_instance: null,
_get() {
if (!this._instance) {
// Original implementation. Zotero is read-only; imported revisions are additive.
const ZoteroCore = (() => {
  const API = "https://api.zotero.org";
  const KEY = /^[A-Z0-9]{8}$/;
  const MARKER = "Zotero import revision: ";

  // RFC 1321 checksum for Zotero file-version comparison only, not authentication.
  // Web Crypto does not expose MD5. Keep the implementation local to the bundle.
  const MD5_CONSTANTS = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);
  const MD5_SHIFTS = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
  function fileChecksum(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("File checksum requires bytes.");
    let state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    const block = view => {
      let [a, b, c, d] = state;
      for (let i = 0; i < 64; i++) {
        let f, word;
        if (i < 16) { f = (b & c) | (~b & d); word = i; }
        else if (i < 32) { f = (d & b) | (~d & c); word = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; word = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); word = (7 * i) % 16; }
        const value = (a + f + MD5_CONSTANTS[i] + view.getUint32(word * 4, true)) | 0;
        const shift = MD5_SHIFTS[i >> 4][i % 4];
        const next = (b + ((value << shift) | (value >>> (32 - shift)))) | 0;
        a = d; d = c; c = b; b = next;
      }
      state = [(state[0] + a) | 0, (state[1] + b) | 0, (state[2] + c) | 0, (state[3] + d) | 0];
    };
    const full = bytes.length - bytes.length % 64;
    for (let offset = 0; offset < full; offset += 64) block(new DataView(bytes.buffer, bytes.byteOffset + offset, 64));
    const tail = new Uint8Array(bytes.length % 64 < 56 ? 64 : 128);
    tail.set(bytes.subarray(full)); tail[bytes.length % 64] = 0x80;
    const ending = new DataView(tail.buffer);
    ending.setUint32(tail.length - 8, (bytes.length * 8) >>> 0, true);
    ending.setUint32(tail.length - 4, Math.floor(bytes.length / 536870912), true);
    for (let offset = 0; offset < tail.length; offset += 64) block(new DataView(tail.buffer, offset, 64));
    return state.map(word => [0, 8, 16, 24].map(shift => ((word >>> shift) & 255).toString(16).padStart(2, "0")).join("")).join("");
  }

  function config(input = {}) {
    const c = {
      libraryType: input.libraryType || "users",
      libraryId: String(input.libraryId || ""),
      apiKey: String(input.apiKey || ""),
      collections: input.collections || [],
      tags: input.tags || [],
      itemTypes: input.itemTypes || [],
      tagMap: input.tagMap || {},
      destinationTag: input.destinationTag || "research/zotero",
      style: input.style || "apa",
      locale: input.locale || "en-US",
      copyAttachments: input.copyAttachments === true,
      maxItems: input.maxItems ?? 1000,
      maxAttachmentBytes: input.maxAttachmentBytes ?? 10485760,
      autoSyncMinutes: input.autoSyncMinutes ?? 15,
    };
    if (!["users", "groups"].includes(c.libraryType)) throw new Error("Library type must be users or groups.");
    if (!/^[1-9][0-9]*$/.test(c.libraryId)) throw new Error("Enter a numeric Zotero library ID, not a username.");
    for (const name of ["collections", "tags", "itemTypes"]) {
      if (!Array.isArray(c[name]) || c[name].some(x => typeof x !== "string" || !x.trim())) {
        throw new Error(name + " must be an array of nonempty strings.");
      }
      c[name] = [...new Set(c[name])];
    }
    if (c.collections.some(k => !KEY.test(k))) throw new Error("Collection keys must have eight uppercase letters/digits.");
    if (!c.tagMap || Array.isArray(c.tagMap) || typeof c.tagMap !== "object" ||
        Object.values(c.tagMap).some(v => typeof v !== "string" || !v.trim())) {
      throw new Error("Tag map must be an object mapping Zotero tags to Amplenote tags.");
    }
    if (typeof c.destinationTag !== "string" || !c.destinationTag.trim() || c.destinationTag.includes(",")) {
      throw new Error("Destination tag must be one nonempty tag.");
    }
    if (!/^[a-zA-Z0-9-]+$/.test(c.style) || !/^[a-zA-Z0-9-]+$/.test(c.locale)) {
      throw new Error("Use a Zotero citation style identifier and locale, for example apa and en-US.");
    }
    if (!Number.isSafeInteger(c.maxItems) || c.maxItems < 1 || c.maxItems > 10000) throw new Error("maxItems must be 1–10000.");
    if (!Number.isSafeInteger(c.maxAttachmentBytes) || c.maxAttachmentBytes < 1 || c.maxAttachmentBytes > 52428800) {
      throw new Error("Attachment limit must be between 1 byte and 50 MiB.");
    }
    if (!Number.isSafeInteger(c.autoSyncMinutes) || c.autoSyncMinutes < 1 || c.autoSyncMinutes > 1440) {
      throw new Error("autoSyncMinutes must be a whole number from 1 to 1440.");
    }
    return c;
  }

  function itemKey(item) {
    const key = item?.key || item?.data?.key;
    if (!KEY.test(key || "")) throw new Error("Zotero returned an invalid item key.");
    return key;
  }

  function identity(c, item) { return `${c.libraryType}/${c.libraryId}/${itemKey(item)}`; }
  function identityTag(c, item) { return `zotero-record/${identity(c, item).toLowerCase()}`; }
  function itemURL(c, item) { return `https://www.zotero.org/${identity(c, item).replace(/\/([^/]+)$/, "/items/$1")}`; }
  function escapeMarkdown(s = "") { return String(s).replace(/[\\`*_[\]{}<>#!|]/g, "\\$&"); }

  function decodeEntities(s) {
    const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, key) => {
      if (key.startsWith("#")) {
        const n = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�";
      }
      return named[key.toLowerCase()] ?? all;
    });
  }

  // Conservative text/format conversion: imported HTML never becomes executable HTML.
  function htmlToMarkdown(html = "") {
    const clean = String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    return clean.split(/(<[^>]*>)/g).map(part => {
      if (!part.startsWith("<")) return escapeMarkdown(decodeEntities(part));
      const tag = /^<\s*(\/?)([a-z0-9]+)/i.exec(part);
      if (!tag) return "";
      const closing = !!tag[1], name = tag[2].toLowerCase();
      if (["i", "em"].includes(name)) return "*";
      if (["b", "strong"].includes(name)) return "**";
      if (name === "br") return "\n";
      if (name === "li") return closing ? "\n" : "\n- ";
      if (["p", "div", "ul", "ol", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6"].includes(name)) return "\n";
      if (name === "td" || name === "th") return closing ? " | " : "";
      return "";
    }).join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function safeURL(value) {
    try {
      const u = new URL(String(value));
      return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
        ? u.href.replace(/[()]/g, x => x === "(" ? "%28" : "%29") : null;
    } catch { return null; }
  }

  function tagNames(c, item) {
    const tags = (item.data?.tags || []).map(t => t.tag).filter(t => typeof t === "string" && t.trim());
    const mapped = tags.map(t => Object.hasOwn(c.tagMap, t) ? c.tagMap[t] : `${c.destinationTag}/${t}`);
    return [...new Set([c.destinationTag, identityTag(c, item), ...mapped])];
  }

  function selected(c, item) {
    const d = item.data || {};
    return !d.deleted && !["note", "attachment", "annotation"].includes(d.itemType) &&
      (!c.collections.length || c.collections.some(k => (d.collections || []).includes(k))) &&
      (!c.tags.length || c.tags.some(t => (d.tags || []).some(x => x.tag === t))) &&
      (!c.itemTypes.length || c.itemTypes.includes(d.itemType));
  }

  async function revision(c, item, children, annotations) {
    // Include child bodies: children can change without the parent's version changing.
    const parts = [identity(c, item), item, [...children].sort((a, b) => itemKey(a).localeCompare(itemKey(b))),
      [...annotations].sort((a, b) => itemKey(a).localeCompare(itemKey(b))), c.style, c.locale, c.copyAttachments];
    if (!globalThis.crypto?.subtle) throw new Error("This client does not expose Web Crypto; sync is unavailable.");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  }

  function render(c, item, children, annotations, copies, digest) {
    const d = item.data || {}, source = itemURL(c, item);
    const authors = (d.creators || []).map(a => a.name || [a.firstName, a.lastName].filter(Boolean).join(" ")).join(", ");
    const lines = ["## Zotero reference", "", `**${escapeMarkdown(d.title || "Untitled reference")}**`, "",
      `[Open in Zotero](${source})`, "", `Reference ID: ${identity(c, item)}`, "",
      `${MARKER}${digest}`, ""];
    if (authors) lines.push(`Authors: ${escapeMarkdown(authors)}`, "");
    if (d.date) lines.push(`Date: ${escapeMarkdown(d.date)}`, "");
    if (d.DOI) lines.push(`[DOI](https://doi.org/${encodeURIComponent(d.DOI)})`, "");
    if (safeURL(d.url)) lines.push(`[Article](${safeURL(d.url)})`, "");
    if (item.bib) lines.push("### Bibliography", "", htmlToMarkdown(item.bib), "");
    if (d.abstractNote) lines.push("### Abstract", "", escapeMarkdown(d.abstractNote), "");
    const notes = children.filter(x => x.data?.itemType === "note");
    if (notes.length) {
      lines.push("### Zotero notes", "");
      for (const note of notes) lines.push(htmlToMarkdown(note.data.note || ""), "");
    }
    const attachments = children.filter(x => x.data?.itemType === "attachment");
    if (attachments.length) {
      lines.push("### Attachments", "");
      for (const attachment of attachments) {
        const key = itemKey(attachment), a = attachment.data;
        const label = escapeMarkdown(a.title || a.filename || key);
        const link = copies[key]?.url || safeURL(a.url) || itemURL(c, attachment);
        lines.push(`- [${label}](${link})${copies[key] ? " (copied to Amplenote)" : " (opens source)"}`);
      }
      lines.push("");
    }
    if (annotations.length) {
      lines.push("### PDF annotations", "");
      for (const a of annotations) {
        const ad = a.data || {};
        lines.push(`**Page ${escapeMarkdown(ad.annotationPageLabel || "unknown")}**`);
        if (ad.annotationText) lines.push(...escapeMarkdown(ad.annotationText).split("\n").map(x => "> " + x));
        if (ad.annotationComment) lines.push(escapeMarkdown(ad.annotationComment));
        if (ad.annotationType === "image" || ad.annotationType === "ink") lines.push("Visual annotation: open the source PDF to view.");
        lines.push("");
      }
    }
    lines.push("---", "");
    const content = lines.join("\n");
    if (content.length > 95000) throw new Error("Reference exceeds the safe note insertion size; no truncated import was written.");
    return content;
  }

  class Client {
    constructor(input, fetchImpl = globalThis.fetch) {
      this.config = config(input);
      // Browser fetch requires its Window receiver, unlike permissive mocks.
      this.fetch = fetchImpl.bind(globalThis);
      this.prefix = `${API}/${this.config.libraryType}/${this.config.libraryId}/`;
      this.backoffUntil = 0;
      this.libraryVersion = null;
    }
    async request(path, query = {}, binary = false, expectedFileChecksum = null) {
      if (!/^(items|collections)(\/[A-Z0-9]{8})?(\/(children|file|items|top))?(\/top)?$/.test(path)) {
        throw new Error("Unsupported Zotero resource path.");
      }
      if (Date.now() < this.backoffUntil) throw new Error("Zotero requested a pause. Run sync again after the backoff interval.");
      const url = new URL(this.prefix + path);
      for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
      const headers = { "Zotero-API-Version": "3", Accept: binary ? "application/octet-stream" : "application/json" };
      // Standard Authorization is removed by fetch on a cross-origin file redirect.
      if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await this.fetch(url.href, { method: "GET", headers, signal: controller.signal, credentials: "omit" });
        const backoff = Number(response.headers.get("Backoff") || response.headers.get("Retry-After") || 0);
        if (Number.isFinite(backoff) && backoff > 0) this.backoffUntil = Date.now() + backoff * 1000;
        if (!response.ok) throw new Error(`Zotero request failed (HTTP ${response.status}). No automatic retry was made.`);
        if (binary) return await this.readFile(response, expectedFileChecksum);
        const version = response.headers.get("Last-Modified-Version");
        if (version && this.libraryVersion && version !== this.libraryVersion) {
          throw new Error("The Zotero library changed during sync. Run sync again for a consistent snapshot.");
        }
        if (version) this.libraryVersion = version;
        return await response.json();
      } finally { clearTimeout(timer); }
    }
    async list(path, query = {}) {
      const all = [], seen = new Set();
      for (let start = 0; ; start += 100) {
        const page = await this.request(path, { ...query, format: "json", limit: 100, start });
        if (!Array.isArray(page)) throw new Error("Zotero returned an invalid list response.");
        for (const item of page) {
          const key = itemKey(item);
          if (seen.has(key)) throw new Error("Zotero pagination repeated an item; sync stopped without discarding data.");
          seen.add(key); all.push(item);
        }
        if (all.length > this.config.maxItems) throw new Error("Result exceeds maxItems; narrow the selection or increase the configured limit.");
        if (page.length < 100) return all;
      }
    }
    async items(query = "") {
      const opts = { include: "data,bib,citation", style: this.config.style, locale: this.config.locale,
        sort: "dateAdded", direction: "asc", ...(query ? { q: query, qmode: "titleCreatorYear" } : {}) };
      let rows;
      if (this.config.collections.length) {
        const byKey = new Map();
        for (const key of this.config.collections) {
          for (const item of await this.list(`collections/${key}/items/top`, opts)) byKey.set(itemKey(item), item);
        }
        rows = [...byKey.values()];
      } else rows = await this.list("items/top", opts);
      if (rows.length > this.config.maxItems) throw new Error("Combined collections exceed maxItems.");
      return rows.filter(item => selected(this.config, item));
    }
    async details(item) {
      const children = await this.list(`items/${itemKey(item)}/children`, { include: "data", sort: "dateAdded", direction: "asc" });
      const annotations = [];
      for (const attachment of children.filter(x => x.data?.itemType === "attachment" && x.data?.contentType === "application/pdf")) {
        const nested = await this.list(`items/${itemKey(attachment)}/children`, { include: "data", sort: "dateAdded", direction: "asc" });
        annotations.push(...nested.filter(x => x.data?.itemType === "annotation"));
      }
      return { children, annotations };
    }
    async downloadAttachment(attachment) {
      const checksum = attachment.data?.md5;
      if (typeof checksum !== "string" || !/^[a-f0-9]{32}$/i.test(checksum)) {
        throw new Error("Zotero has no valid cloud-file checksum for this PDF. Finish syncing its file to Zotero storage before copying it.");
      }
      return this.request(`items/${itemKey(attachment)}/file`, {}, true, checksum.toLowerCase());
    }
    async readFile(response, expectedFileChecksum = null) {
      const max = this.config.maxAttachmentBytes, length = Number(response.headers.get("Content-Length") || 0);
      if (length > max) { await response.body?.cancel(); throw new Error("Attachment exceeds configured size limit."); }
      const chunks = []; let size = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > max) { await reader.cancel(); throw new Error("Attachment exceeds configured size limit."); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > max) throw new Error("Attachment exceeds configured size limit.");
        chunks.push(bytes); size = bytes.length;
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (expectedFileChecksum !== null && fileChecksum(bytes) !== expectedFileChecksum) {
        throw new Error("The PDF file version no longer matches its Zotero metadata checksum. Run sync again after Zotero finishes syncing its file.");
      }
      const mime = (response.headers.get("Content-Type") || "application/octet-stream").split(";")[0].trim();
      if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime)) throw new Error("Attachment has an invalid content type.");
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return `data:${mime};base64,${btoa(binary)}`;
    }
  }

  return { config, Client, fileChecksum, itemKey, identity, identityTag, itemURL, escapeMarkdown, htmlToMarkdown,
    safeURL, tagNames, selected, revision, render, MARKER };
})();
const Core = ZoteroCore;

const SETTINGS = { type: "Library type", id: "Library ID", key: "API key", options: "Options JSON" };

function readConfig(app) {
  const s = app.settings || {};
  let extra;
  try { extra = JSON.parse(s[SETTINGS.options] || "{}"); }
  catch { throw new Error("Options JSON is invalid. Open Configure to correct it."); }
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("Options JSON must be an object.");
  return Core.config({ ...extra, libraryType: s[SETTINGS.type] || "users",
    libraryId: s[SETTINGS.id], apiKey: s[SETTINGS.key] || "" });
}

function safeError(error, ...apiKeys) {
  // Host RPC errors may be plain objects, strings, or Errors from another realm.
  let text = typeof error === "string" ? error
    : typeof error?.message === "string" ? error.message : "The operation failed.";
  for (const apiKey of apiKeys) if (apiKey) text = text.split(apiKey).join("[redacted]");
  return text.slice(0, 500);
}

function latestRevision(body) {
  return typeof body === "string" ? body.match(/^Zotero import revision: ([a-f0-9]{64})$/m)?.[1] : undefined;
}

class SyncCancelled extends Error {}

async function findImportedNote(app, c, item) {
  const matches = await app.filterNotes({ tag: Core.identityTag(c, item) });
  if (!Array.isArray(matches)) throw new Error("Amplenote returned an invalid note list.");
  if (matches.length > 1) throw new Error("Multiple notes have this Zotero record tag. Resolve the duplicate before syncing this record.");
  if (!matches.length) return null;
  const note = matches[0];
  if (typeof note.uuid !== "string" || !note.uuid) throw new Error("Amplenote returned an invalid note handle.");
  const body = await app.getNoteContent(note);
  if (typeof body !== "string") throw new Error("Amplenote returned invalid note content.");
  const ids = [...body.matchAll(/^Reference ID: ([^\r\n]+)$/gm)].map(m => m[1]);
  if (body.trim() && (!ids.length || ids.some(id => id !== Core.identity(c, item)))) {
    throw new Error("The matching note does not contain this reference ID. No content was changed.");
  }
  return { note, body };
}

async function importReference(app, client, snapshot, canContinue = () => true) {
  const c = client.config, { item, children, annotations, digest } = snapshot;
  const found = await findImportedNote(app, c, item);
  if (!canContinue()) throw new SyncCancelled();
  const newestDigest = latestRevision(found?.body);
  if (newestDigest === digest) {
    for (const tag of Core.tagNames(c, item)) {
      if (await app.addNoteTag(found.note, tag) === false) throw new Error("Amplenote could not apply a requested reference tag.");
    }
    return "unchanged";
  }

  // Validate the complete text and download bounded files before creating a note.
  Core.render(c, item, children, annotations, {}, digest);
  const downloads = [];
  if (c.copyAttachments) {
    for (const attachment of children) {
      if (!canContinue()) throw new SyncCancelled();
      const d = attachment.data || {};
      if (d.itemType === "attachment" && d.contentType === "application/pdf" &&
          ["imported_file", "imported_url"].includes(d.linkMode)) {
        downloads.push([Core.itemKey(attachment), await client.downloadAttachment(attachment)]);
      }
    }
  }

  // Once note mutation starts, finish this reference before honoring a stop.
  // A stop during metadata or file reads must not create an empty note.
  if (!canContinue()) throw new SyncCancelled();
  let note = found?.note;
  if (!note) {
    const title = `[Zotero] ${item.data?.title || "Untitled reference"}`.slice(0, 240);
    const uuid = await app.createNote(title, [Core.identityTag(c, item)]);
    if (typeof uuid !== "string" || !uuid) throw new Error("Amplenote did not return a new note ID.");
    note = { uuid };
  }
  for (const tag of Core.tagNames(c, item)) {
    if (await app.addNoteTag(note, tag) === false) throw new Error("Amplenote could not apply a requested reference tag.");
  }
  const copies = {};
  for (const [key, dataURL] of downloads) {
    const url = Core.safeURL(await app.attachNoteMedia(note, dataURL));
    if (!url) throw new Error("Amplenote did not return a valid attachment URL.");
    copies[key] = { url };
  }
  const content = Core.render(c, item, children, annotations, copies, digest);
  // Prepending leaves all previous imported revisions and manual text intact.
  // There is no cross-client transaction in the host API: use one syncing client.
  await app.insertNoteContent(note, content + "\n", { atEnd: false });
  const readback = await app.getNoteContent(note);
  // Old revisions remain in the note. Their markers cannot prove this write worked,
  // especially when the Zotero source is reverted to a previously imported value.
  if (latestRevision(readback) !== digest) {
    throw new Error("The import could not be verified by reading the note. Run sync again before treating it as complete.");
  }
  return found ? "updated" : "created";
}

async function snapshotItem(client, item) {
  const { children, annotations } = await client.details(item);
  const digest = await Core.revision(client.config, item, children, annotations);
  Core.render(client.config, item, children, annotations, {}, digest);
  return { item, children, annotations, digest };
}

async function syncReferences(app, client, { items, canContinue = () => true } = {}) {
  items ??= await client.items();
  const result = { selected: items.length, created: 0, updated: 0, unchanged: 0,
    failed: 0, notAttempted: 0, cancelled: false };
  // Complete metadata reads before note mutations, preserving snapshot checks.
  const snapshots = [];
  for (const item of items) {
    if (!canContinue()) return { ...result, cancelled: true, notAttempted: items.length };
    snapshots.push(await snapshotItem(client, item));
  }
  for (let i = 0; i < snapshots.length; i++) {
    if (!canContinue()) return { ...result, cancelled: true, notAttempted: snapshots.length - i };
    try { result[await importReference(app, client, snapshots[i], canContinue)]++; }
    catch (error) {
      if (error instanceof SyncCancelled) {
        return { ...result, cancelled: true, notAttempted: snapshots.length - i };
      }
      result.failed++;
      result.notAttempted = snapshots.length - i - 1;
      result.error = `Sync stopped at reference ${Core.itemKey(snapshots[i].item)}. Earlier successful imports remain. The current note or its attachments may be partially written.\n${safeError(error, client.config.apiKey)}`;
      break;
    }
  }
  return result;
}

function syncSummary(result) {
  return `${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.failed} failed, ${result.notAttempted} not attempted.`;
}

async function chooseReference(app, client) {
  const query = await app.prompt("Search Zotero by title, author, or year", {
    inputs: [{ label: "Search", type: "text", value: "" }],
  });
  if (query === null) return null;
  if (typeof query !== "string" || !query.trim()) throw new Error("Enter a search term.");
  const items = await client.items(query.trim());
  if (!items.length) { await app.alert("No references matched the search and configured filters."); return null; }
  if (items.length > 100) throw new Error("More than 100 references matched. Use a more specific search.");
  const key = await app.prompt("Choose a reference", {
    inputs: [{ type: "select", label: "Reference", options: items.map(item => ({
      label: `${item.data?.title || "Untitled"} (${item.data?.date || "undated"}) [${Core.itemKey(item)}]`,
      value: Core.itemKey(item),
    })) }],
  });
  if (key === null) return null;
  const item = items.find(row => Core.itemKey(row) === key);
  if (!item) throw new Error("No valid reference was selected.");
  return item;
}

function createPlugin({ fetchImpl = globalThis.fetch, now = () => Date.now(),
  schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
  unschedule = timer => globalThis.clearTimeout(timer) } = {}) {
  return {
    _busy: false,
    _backoffUntil: 0,
    _fetch: fetchImpl,
    _now: now,
    _schedule: schedule,
    _unschedule: unschedule,
    _auto: { enabled: false, running: false, generation: 0, timer: null, app: null,
      signature: null, intervalMs: 0, nextAt: null, lastRun: null, state: "off", error: "" },

    _autoStatus() {
      const a = this._auto;
      // Configuration and credentials are never returned or persisted as status.
      return { enabled: a.enabled, running: a.running, state: a.state,
        intervalMinutes: a.intervalMs / 60000, nextAt: a.nextAt,
        lastRun: a.lastRun ? { ...a.lastRun } : null, error: a.error };
    },

    _stopAuto(state = "stopped", reason = "") {
      const a = this._auto;
      a.enabled = false;
      a.generation++;
      if (a.timer !== null) this._unschedule(a.timer);
      a.timer = null;
      a.nextAt = null;
      a.app = null;
      a.signature = null;
      a.state = state === "stopped" && a.running ? "stopping" : state;
      a.error = reason;
    },

    async _pauseAuto(app, reason) {
      this._stopAuto("paused", reason);
      // A stale/closed host may reject alerts. Preserve status without retrying.
      try { await app.alert("Automatic Zotero sync paused: " + reason); } catch {}
    },

    _scheduleAuto(delay) {
      const a = this._auto;
      if (!a.enabled) return;
      if (a.timer !== null) this._unschedule(a.timer);
      const generation = a.generation;
      a.nextAt = this._now() + delay;
      a.state = "waiting";
      a.timer = this._schedule(async () => {
        if (!a.enabled || a.generation !== generation) return;
        a.timer = null;
        await this._autoTick(generation);
      }, delay);
    },

    async _autoTick(generation) {
      const a = this._auto;
      if (!a.enabled || generation !== a.generation || a.running) return null;
      if (this._busy) { this._scheduleAuto(30000); return null; }
      this._busy = true;
      a.running = true;
      a.state = "running";
      a.nextAt = null;
      const app = a.app, startedAt = this._now(), signature = a.signature;
      let client;
      try {
        // A timer outlives the action that provided app.context. Context-only
        // methods then reject with "Invalid context call" in the real host.
        const config = readConfig(app);
        if (!a.enabled || a.generation !== generation) return null;
        if (JSON.stringify(config) !== signature) {
          await this._pauseAuto(app, "Settings changed. Review the selection and start automatic sync again.");
          return null;
        }
        client = new Core.Client(config, this._fetch);
        client.backoffUntil = this._backoffUntil;
        const canContinue = () => {
          if (!a.enabled || a.generation !== generation) return false;
          try { return JSON.stringify(readConfig(a.app)) === signature; } catch { return false; }
        };
        const result = await syncReferences(app, client, { canContinue });
        a.lastRun = { startedAt, finishedAt: this._now(), ...result };
        if (a.enabled && a.generation === generation) {
          if (result.failed) await this._pauseAuto(app, result.error);
          else if (result.cancelled) await this._pauseAuto(app, "Settings changed during sync. Review the selection and start automatic sync again.");
        }
        return result;
      } catch (error) {
        const reason = safeError(error, client?.config.apiKey,
          app.settings?.[SETTINGS.key], a.app?.settings?.[SETTINGS.key]);
        a.lastRun = { startedAt, finishedAt: this._now(), status: "error", error: reason };
        if (a.enabled && a.generation === generation) await this._pauseAuto(app, reason);
        return null;
      } finally {
        if (client) this._backoffUntil = Math.max(this._backoffUntil, client.backoffUntil);
        this._busy = false;
        a.running = false;
        if (a.state === "stopping") a.state = "stopped";
        if (a.enabled && a.generation === generation) {
          this._scheduleAuto(Math.max(a.intervalMs, this._backoffUntil - Date.now()));
        }
      }
    },

    async onNavigate(app) {
      const a = this._auto;
      if (!a.enabled) return;
      try {
        // Navigation supplies a live action context, so refresh is valid here.
        const settings = typeof app.context?.refreshSettings === "function"
          ? await app.context.refreshSettings() : app.settings;
        if (JSON.stringify(readConfig({ settings })) !== a.signature) {
          await this._pauseAuto(app, "Settings changed. Review the selection and start automatic sync again.");
          return;
        }
        a.app = app;
        // Resume one overdue check after timer throttling; never accumulate ticks.
        if (!a.running && (a.timer === null || a.nextAt <= this._now())) this._scheduleAuto(0);
      } catch (error) {
        await this._pauseAuto(app, safeError(error, app.settings?.[SETTINGS.key]));
      }
    },

    async _execute(app, operation) {
      if (this._busy) { await app.alert("A Zotero action is already running in this client."); return null; }
      this._busy = true;
      let client;
      try {
        client = new Core.Client(readConfig(app), this._fetch);
        client.backoffUntil = this._backoffUntil;
        return await operation(client);
      } catch (error) {
        await app.alert("Zotero action stopped: " + safeError(error, app.settings?.[SETTINGS.key]));
        return null;
      } finally {
        if (client) this._backoffUntil = Math.max(this._backoffUntil, client.backoffUntil);
        this._busy = false;
      }
    },

    appOption: {
      async "Configure"(app) {
        if (this._busy) { await app.alert("Finish the current Zotero action before changing settings."); return; }
        if (this._auto.enabled) this._stopAuto("stopped", "Configuration opened. Start automatic sync again after reviewing settings.");
        this._busy = true;
        const s = app.settings || {};
        let input;
        try {
          // Keep the lock across the prompt and every asynchronous setting write.
          input = await app.prompt("Zotero library and filters. Use a dedicated read-only API key for a private library.", {
            inputs: [
              { type: "select", label: "Library type", value: s[SETTINGS.type] || "users", options: [
                { label: "Personal library", value: "users" }, { label: "Group library", value: "groups" }] },
              { type: "text", label: "Numeric library ID", value: s[SETTINGS.id] || "" },
              { type: "secureText", label: "API key (blank for a public library)", value: s[SETTINGS.key] || "" },
              { type: "text", label: "Options JSON", value: s[SETTINGS.options] || "{}" },
            ],
          });
          if (input === null) return;
          if (!Array.isArray(input) || input.length < 4) throw new Error("The settings form returned an invalid response.");
          const values = { [SETTINGS.type]: input[0], [SETTINGS.id]: input[1], [SETTINGS.key]: input[2], [SETTINGS.options]: input[3] };
          readConfig({ settings: values });
          for (const [key, value] of Object.entries(values)) await app.setSetting(key, String(value));
          await app.alert("Settings saved. Use Preview selection before importing.");
        } catch (error) {
          await app.alert("Settings were not fully saved: " + safeError(error,
            s[SETTINGS.key], Array.isArray(input) ? String(input[2] || "") : ""));
        } finally { this._busy = false; }
      },

      async "Preview selection"(app) {
        return this._execute(app, async client => {
          const items = await client.items();
          const names = items.slice(0, 20).map(item => item.data?.title || "Untitled").join("\n");
          await app.alert(`${items.length} references selected. No notes were changed.\n\n${names}${items.length > 20 ? "\n…" : ""}`);
          return items.length;
        });
      },

      async "Sync selected references"(app) {
        return this._execute(app, async client => {
          const items = await client.items();
          if (!items.length) { await app.alert("No references match the configured filters."); return null; }
          const answer = await app.alert(`Import ${items.length} references? New revisions will be added above existing content. Run sync from only one client at a time.`, {
            actions: [{ label: "Import references", value: "import" }],
            primaryAction: { label: "Cancel" },
          });
          if (answer !== "import") return null;
          const result = await syncReferences(app, client, { items });
          if (result.error) await app.alert(result.error);
          await app.alert("Sync results: " + syncSummary(result));
          return result;
        });
      },

      async "Start automatic sync in this client"(app) {
        if (this._auto.enabled) {
          await app.alert("Automatic sync is already enabled in this client. Use Show automatic sync status or Stop automatic sync.");
          return this._autoStatus();
        }
        return this._execute(app, async client => {
          const generation = this._auto.generation, c = client.config;
          const answer = await app.alert(`Automatically import the configured ${c.libraryType}/${c.libraryId} selection now and every ${c.autoSyncMinutes} minutes while this Amplenote client stays open? New revisions and tags will be added; ${c.copyAttachments ? "uploaded PDFs will also be copied" : "files will remain source links"}. Enable this on only one client. Closing or reloading the app stops it; errors pause it until you restart.`, {
            actions: [{ label: "Start automatic sync", value: "start-auto" }], primaryAction: { label: "Cancel" },
          });
          if (answer !== "start-auto" || generation !== this._auto.generation) return null;
          if (JSON.stringify(readConfig(app)) !== JSON.stringify(c)) throw new Error("Settings changed during confirmation. Review them and try again.");
          Object.assign(this._auto, { enabled: true, app, signature: JSON.stringify(c),
            intervalMs: c.autoSyncMinutes * 60000, lastRun: null, error: "" });
          this._scheduleAuto(0);
          return this._autoStatus();
        });
      },

      async "Stop automatic sync"(app) {
        this._stopAuto();
        await app.alert(this._auto.running
          ? "Automatic sync is stopping. A reference already being written will finish; no further references will be started."
          : "Automatic sync stopped in this client.");
        return this._autoStatus();
      },

      async "Show automatic sync status"(app) {
        const status = this._autoStatus();
        const last = status.lastRun;
        const lastText = !last ? "No automatic run recorded in this session."
          : last.status === "error" ? "Last attempt failed: " + last.error
          : "Last run: " + syncSummary(last) + (last.cancelled ? " Stopped before finishing the selection." : "");
        await app.alert(`Automatic sync: ${status.state}.\n${lastText}${status.nextAt !== null ? "\nNext check at or after " + new Date(status.nextAt).toISOString() : ""}${status.error ? "\n" + status.error : ""}`);
        return status;
      },

      async "Search and import one reference"(app) {
        return this._execute(app, async client => {
          const item = await chooseReference(app, client);
          if (!item) return null;
          const outcome = await importReference(app, client, await snapshotItem(client, item));
          await app.alert(`Reference ${outcome}. Find it under the configured destination tag.`);
          return outcome;
        });
      },
    },

    insertText: {
      async "Insert formatted citation"(app) {
        await this._execute(app, async client => {
          const item = await chooseReference(app, client);
          if (!item) return;
          const text = Core.htmlToMarkdown(item.citation || "");
          if (!text) throw new Error("Zotero did not return a formatted citation for this reference.");
          if (!await app.context.replaceSelection(text)) throw new Error("The original insertion point is no longer available. No citation was inserted.");
        });
        return null;
      },
      async "Insert bibliography entry"(app) {
        await this._execute(app, async client => {
          const item = await chooseReference(app, client);
          if (!item) return;
          const text = Core.htmlToMarkdown(item.bib || "");
          if (!text) throw new Error("Zotero did not return a bibliography entry for this reference.");
          if (!await app.context.replaceSelection(text)) throw new Error("The original insertion point is no longer available. No bibliography entry was inserted.");
        });
        return null;
      },
    },
  };
}
this._instance = createPlugin();
}
return this._instance;
},
appOption: {
"Configure": function(app) { const instance = this._get(); return instance["appOption"]["Configure"].call(instance, app); },
"Preview selection": function(app) { const instance = this._get(); return instance["appOption"]["Preview selection"].call(instance, app); },
"Sync selected references": function(app) { const instance = this._get(); return instance["appOption"]["Sync selected references"].call(instance, app); },
"Start automatic sync in this client": function(app) { const instance = this._get(); return instance["appOption"]["Start automatic sync in this client"].call(instance, app); },
"Stop automatic sync": function(app) { const instance = this._get(); return instance["appOption"]["Stop automatic sync"].call(instance, app); },
"Show automatic sync status": function(app) { const instance = this._get(); return instance["appOption"]["Show automatic sync status"].call(instance, app); },
"Search and import one reference": function(app) { const instance = this._get(); return instance["appOption"]["Search and import one reference"].call(instance, app); }
},
insertText: {
"Insert formatted citation": function(app) { const instance = this._get(); return instance["insertText"]["Insert formatted citation"].call(instance, app); },
"Insert bibliography entry": function(app) { const instance = this._get(); return instance["insertText"]["Insert bibliography entry"].call(instance, app); }
},
onNavigate: function(app, ...args) { const instance = this._get(); return instance.onNavigate.call(instance, app, ...args); }
}
