# Zotero Bridge

| name | Zotero Bridge |
| --- | --- |
| icon | library_books |
| description | Import Zotero references, notes and text annotations; insert citations. |
| setting | Library type |
| setting | Library ID |
| setting | API key |
| setting | Options JSON |

```javascript
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
      importFullText: input.importFullText !== false,
      maxItems: input.maxItems ?? 1000,
      maxAttachmentBytes: input.maxAttachmentBytes ?? 10485760,
      maxFullTextBytes: input.maxFullTextBytes ?? 10485760,
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
    if (input.importFullText !== undefined && typeof input.importFullText !== "boolean") throw new Error("importFullText must be true or false.");
    if (!Number.isSafeInteger(c.maxFullTextBytes) || c.maxFullTextBytes < 1 || c.maxFullTextBytes > 52428800) {
      throw new Error("Full-text response limit must be between 1 byte and 50 MiB.");
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

  async function hashText(text) {
    if (!globalThis.crypto?.subtle) throw new Error("This client does not expose Web Crypto; sync is unavailable.");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  }

  async function revision(c, item, children, annotations, fulltexts = []) {
    // Include child bodies: children can change without the parent's version changing.
    const parts = [identity(c, item), item, [...children].sort((a, b) => itemKey(a).localeCompare(itemKey(b))),
      [...annotations].sort((a, b) => itemKey(a).localeCompare(itemKey(b))), c.style, c.locale, c.copyAttachments];
    if (fulltexts.length) parts.push([...fulltexts].sort((a, b) => a.key.localeCompare(b.key)));
    return hashText(JSON.stringify(parts));
  }

  function textCoverage(text) {
    if (text.status === "unavailable") return "No synced text index is available from Zotero.";
    for (const unit of ["Pages", "Chars"]) {
      const indexed = text["indexed" + unit], total = text["total" + unit];
      if (indexed !== undefined) {
        return `Zotero indexed ${indexed} of ${total} ${unit === "Pages" ? "pages" : "characters"}.${indexed < total ? " This is a partial index." : total === 0 ? " Coverage is not established." : ""}`;
      }
    }
    return "Zotero did not report index coverage.";
  }

  // Escape every CommonMark punctuation character: indexed text is literal prose.
  function escapePlainText(text) {
    return text.replace(/[!-/:-@\[-`{-~]/g, "\\$&");
  }

  function canonicalPlainText(text) { return text.replace(/\s+/gu, " ").trim(); }

  // Native exports leave literal HTML delimiters/entities unescaped. This is
  // applied only to our managed literal-text region before rendering it again.
  function literalExportForRendering(markdown) {
    let result = "", backslashes = 0;
    for (const char of markdown) {
      if ("&<>".includes(char) && backslashes % 2 === 0) result += "\\";
      result += char;
      backslashes = char === "\\" ? backslashes + 1 : 0;
    }
    return result;
  }

  function canonicalHtmlText(html) {
    const document = new DOMParser().parseFromString(html, "text/html");
    if (document.querySelector("script,style,img,iframe,video,audio,object")) throw new Error("The managed text contains unexpected non-text content.");
    const parts = [];
    const visit = node => {
      if (node.nodeType === 3) { parts.push(node.nodeValue); return; }
      for (const child of node.childNodes) visit(child);
      if (/^(BR|P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TR)$/.test(node.nodeName)) parts.push("\n");
    };
    visit(document.body);
    return canonicalPlainText(parts.join(""));
  }

  async function fullTextParts(c, fulltexts) {
    const result = [];
    for (const text of fulltexts.filter(text => text.status === "available")) {
      const { contentVersion, ...contentState } = text;
      const digest = await hashText(JSON.stringify([identity(c, { key: text.key }), contentState]));
      const chunks = [];
      for (let start = 0; start < text.content.length;) {
        let end = Math.min(start + 30000, text.content.length);
        if (end < text.content.length) {
          const paragraph = text.content.lastIndexOf("\n\n", end - 1);
          if (paragraph > start + 24000) end = paragraph + 2;
          if (/[\uD800-\uDBFF]/.test(text.content[end - 1]) && /[\uDC00-\uDFFF]/.test(text.content[end])) end--;
        }
        chunks.push(text.content.slice(start, end)); start = end;
      }
      if (!chunks.length) chunks.push("");
      for (const [index, chunk] of chunks.entries()) {
        const id = `${identity(c, { key: text.key })}/${digest}/${index + 1}`;
        const startMarker = "Zotero text part: " + id;
        const endMarker = "End of Zotero text part: " + id;
        const markdown = [`# Indexed text: ${escapeMarkdown(text.title)}`, "", textCoverage(text), "",
          `[View source in Zotero](${itemURL(c, { key: text.key })})`, "", `Part ${index + 1} of ${chunks.length}`, "",
          startMarker, "", escapePlainText(chunk), "", endMarker, ""].join("\n");
        if (markdown.length > 95000) throw new Error("A text part exceeds the note insertion limit.");
        result.push({ attachmentKey: text.key, index: index + 1, count: chunks.length, id, chunk,
          title: `[Zotero text ${index + 1}/${chunks.length}] ${text.title}`.slice(0, 240),
          tag: `zotero-text/${c.libraryType}/${c.libraryId}/${text.key.toLowerCase()}/${digest.slice(0, 32)}/${index + 1}`,
          startMarker, endMarker, markdown });
      }
    }
    return result;
  }

  function managedTextPart(body, part) {
    const lines = body.replace(/\r\n?/g, "\n").split("\n");
    const starts = lines.map((line, i) => line === part.startMarker ? i : -1).filter(i => i >= 0);
    const ends = lines.map((line, i) => line === part.endMarker ? i : -1).filter(i => i >= 0);
    if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) throw new Error("The managed text part is incomplete or ambiguous. Review its note before syncing again.");
    return lines.slice(starts[0] + 1, ends[0]).join("\n");
  }

  function render(c, item, children, annotations, copies, digest, fulltexts = [], textLinks = []) {
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
    if (fulltexts.length) {
      lines.push("### Indexed article text", "");
      for (const text of fulltexts) {
        lines.push(`**${escapeMarkdown(text.title)}**`, "", textCoverage(text), "");
        for (const part of textLinks.filter(link => link.attachmentKey === text.key)) {
          lines.push(`- [Read text - part ${part.index} of ${part.count}](${part.url})`);
        }
        lines.push("");
      }
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
      const itemFullText = /^items\/[A-Z0-9]{8}\/fulltext$/.test(path);
      if (!itemFullText && path !== "fulltext" && !/^(items|collections)(\/[A-Z0-9]{8})?(\/(children|file|items|top))?(\/top)?$/.test(path)) {
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
        if (itemFullText && response.status === 404) { await response.body?.cancel(); return null; }
        if (!response.ok) throw new Error(`Zotero request failed (HTTP ${response.status}). No automatic retry was made.`);
        if (binary) return await this.readFile(response, expectedFileChecksum);
        const version = response.headers.get("Last-Modified-Version");
        // This endpoint reports the text index's version, not the library version.
        if (itemFullText) {
          const bytes = await this.readBytes(response, this.config.maxFullTextBytes, "Full-text response exceeds configured size limit.");
          return { data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), contentVersion: version };
        }
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
      const fulltexts = [];
      if (this.config.importFullText) {
        for (const attachment of children.filter(x => x.data?.itemType === "attachment" &&
          /^(application\/(pdf|xhtml\+xml)|text\/[^;]+)$/i.test(x.data?.contentType || ""))) {
          fulltexts.push(await this.fullText(attachment));
        }
        if (fulltexts.length) await this.verifyTextSnapshot();
      }
      return { children, annotations, fulltexts };
    }

    async fullText(attachment) {
      const key = itemKey(attachment), title = String(attachment.data?.title || attachment.data?.filename || key);
      const response = await this.request(`items/${key}/fulltext`);
      if (response === null) return { key, title, status: "unavailable" };
      const { data, contentVersion } = response;
      if (!data || typeof data.content !== "string") throw new Error("Zotero returned invalid indexed text.");
      if (contentVersion !== null && !/^\d+$/.test(contentVersion)) throw new Error("Zotero returned an invalid text-index version.");
      const text = { key, title, status: "available", contentVersion, content: data.content.replace(/\r\n?/g, "\n") };
      for (const unit of ["Pages", "Chars"]) {
        const a = "indexed" + unit, b = "total" + unit;
        if (data[a] !== undefined || data[b] !== undefined) {
          if (![data[a], data[b]].every(n => Number.isSafeInteger(n) && n >= 0) || data[a] > data[b]) throw new Error("Zotero returned invalid text-index coverage.");
          text[a] = data[a]; text[b] = data[b];
        }
      }
      return text;
    }

    async verifyTextSnapshot() {
      if (!this.libraryVersion || !/^\d+$/.test(this.libraryVersion)) throw new Error("Zotero did not expose a library version for text snapshot verification.");
      const changed = await this.request("fulltext", { since: this.libraryVersion });
      if (!changed || typeof changed !== "object" || Array.isArray(changed)) throw new Error("Zotero returned invalid text-index changes.");
      if (Object.keys(changed).length) throw new Error("Indexed text changed during sync. Run sync again for a consistent snapshot.");
    }
    async downloadAttachment(attachment) {
      const checksum = attachment.data?.md5;
      if (typeof checksum !== "string" || !/^[a-f0-9]{32}$/i.test(checksum)) {
        throw new Error("Zotero has no valid cloud-file checksum for this PDF. Finish syncing its file to Zotero storage before copying it.");
      }
      return this.request(`items/${itemKey(attachment)}/file`, {}, true, checksum.toLowerCase());
    }
    async readBytes(response, max, errorMessage) {
      const length = Number(response.headers.get("Content-Length") || 0);
      if (length > max) { await response.body?.cancel(); throw new Error(errorMessage); }
      const chunks = []; let size = 0;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > max) { await reader.cancel(); throw new Error(errorMessage); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > max) throw new Error(errorMessage);
        chunks.push(bytes); size = bytes.length;
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    }
    async readFile(response, expectedFileChecksum = null) {
      const bytes = await this.readBytes(response, this.config.maxAttachmentBytes, "Attachment exceeds configured size limit.");
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
    safeURL, tagNames, selected, revision, render, fullTextParts, managedTextPart, literalExportForRendering, canonicalHtmlText, canonicalPlainText, textCoverage, MARKER };
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
  if (body.trim() && body.trim() !== "\\" && (!ids.length || ids.some(id => id !== Core.identity(c, item)))) {
    throw new Error("The matching note does not contain this reference ID. No content was changed.");
  }
  return { note, body };
}

async function ensureTextPart(app, c, part, mustExist = false) {
  const matches = await app.filterNotes({ tag: part.tag });
  if (!Array.isArray(matches) || matches.length > 1) throw new Error("Multiple or invalid notes match an indexed text part. Review them before syncing.");
  let note = matches[0];
  if (!note && mustExist) throw new Error("An imported indexed text note is missing. Restore or review it before syncing this unchanged reference.");
  let body = note ? await app.getNoteContent(note) : "";
  if (typeof body !== "string") throw new Error("Amplenote returned invalid indexed text content.");
  const empty = !body.trim() || body.trim() === "\\";
  if (empty) {
    if (mustExist) throw new Error("An imported indexed text part was cleared. Review its note before syncing.");
    if (!note) {
      const uuid = await app.createNote(part.title, [part.tag, c.destinationTag + "/indexed-text"]);
      if (typeof uuid !== "string" || !uuid) throw new Error("Amplenote did not return an indexed text note ID.");
      note = { uuid };
    }
    await app.insertNoteContent(note, part.markdown, { atEnd: false });
    body = await app.getNoteContent(note);
  }
  const managed = Core.managedTextPart(body, part);
  const html = await app.htmlFromContent(Core.literalExportForRendering(managed));
  if (typeof html !== "string" || Core.canonicalHtmlText(html) !== Core.canonicalPlainText(part.chunk)) {
    throw new Error("An indexed text part differs from the source. Its note was preserved; review it before syncing again.");
  }
  const url = Core.safeURL(await app.getNoteURL(note));
  if (!url) throw new Error("Amplenote did not return a valid indexed text note URL.");
  return { attachmentKey: part.attachmentKey, index: part.index, count: part.count, url };
}

async function importReference(app, client, snapshot, canContinue = () => true) {
  const c = client.config, { item, children, annotations, digest, fulltexts, textParts } = snapshot;
  const found = await findImportedNote(app, c, item);
  if (!canContinue()) throw new SyncCancelled();
  const newestDigest = latestRevision(found?.body);
  if (textParts.length && (typeof DOMParser !== "function" || typeof app.htmlFromContent !== "function")) {
    throw new Error("This client cannot validate indexed text notes. Update the client or disable importFullText.");
  }
  if (newestDigest === digest) {
    for (const part of textParts) {
      if (!canContinue()) throw new SyncCancelled();
      await ensureTextPart(app, c, part, true);
    }
    for (const tag of Core.tagNames(c, item)) {
      if (await app.addNoteTag(found.note, tag) === false) throw new Error("Amplenote could not apply a requested reference tag.");
    }
    return "unchanged";
  }

  // Validate the complete text and download bounded files before creating a note.
  const placeholderLinks = textParts.map(part => ({ ...part, url: "https://www.amplenote.com/notes/local-00000000-0000-0000-0000-000000000000" }));
  Core.render(c, item, children, annotations, {}, digest, fulltexts, placeholderLinks);
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

  // Each finished text part is reusable after interruption. Publish the parent
  // revision only after every part is verified, without overwriting old parts.
  const textLinks = [];
  for (const part of textParts) {
    if (!canContinue()) throw new SyncCancelled();
    textLinks.push(await ensureTextPart(app, c, part));
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
  const content = Core.render(c, item, children, annotations, copies, digest, fulltexts, textLinks);
  if (found && await app.getNoteContent(note) !== found.body) {
    throw new Error("The reference note changed while this import was prepared. Its content was not updated; review it and sync again.");
  }
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
  const { children, annotations, fulltexts } = await client.details(item);
  const digest = await Core.revision(client.config, item, children, annotations, fulltexts);
  const textParts = await Core.fullTextParts(client.config, fulltexts);
  const placeholderLinks = textParts.map(part => ({ ...part, url: "https://www.amplenote.com/notes/local-00000000-0000-0000-0000-000000000000" }));
  Core.render(client.config, item, children, annotations, {}, digest, fulltexts, placeholderLinks);
  return { item, children, annotations, digest, fulltexts, textParts };
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
          const answer = await app.alert(`Import ${items.length} references? New revisions will be added above existing content.${client.config.importFullText ? " Available indexed text will be copied into linked notes; long documents may use several parts." : ""} Run sync from only one client at a time.`, {
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
          const answer = await app.alert(`Automatically import the configured ${c.libraryType}/${c.libraryId} selection now and every ${c.autoSyncMinutes} minutes while this Amplenote client stays open? New revisions and tags will be added; ${c.copyAttachments ? "uploaded PDFs will also be copied" : "files will remain source links"}.${c.importFullText ? " Available indexed text will be copied into linked notes." : ""} Enable this on only one client. Closing or reloading the app stops it; errors pause it until you restart.`, {
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
```

Configure private settings after installing. Do not paste credentials into this note. Public-library smoke checks are documented in HOST_TEST_RESULTS.md; full compatibility and bounty acceptance remain unverified.
