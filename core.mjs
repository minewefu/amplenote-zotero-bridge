// Original implementation. Zotero is read-only; imported revisions are additive.
export const ZoteroCore = (() => {
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
