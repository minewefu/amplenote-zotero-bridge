// Entirely synthetic fixtures. This module never contacts Zotero or Amplenote.
export function reference(key = "ITEM0001", overrides = {}) {
  return { key, version: 7, library: { type: "user", id: 123 },
    citation: "<span>(Example, 2026)</span>", bib: "<div>Example. <i>Sample research</i>. 2026.</div>",
    data: { key, version: 7, itemType: "journalArticle", title: "Sample research", date: "2026",
      creators: [{ firstName: "Alex", lastName: "Example" }], tags: [{ tag: "science" }], collections: [],
      abstractNote: "A synthetic abstract.", dateAdded: "2026-09-01T00:00:00Z", ...overrides } };
}

export function jsonResponse(value, headers = {}, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    "Content-Type": "application/json", "Last-Modified-Version": "42", ...headers,
  } });
}

export function service({ items = [reference()], children = {}, files = {}, intercept } = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    const u = new URL(url);
    if (u.origin !== "https://api.zotero.org") throw new Error("Fixture refused an unexpected origin.");
    if (options.method !== "GET") throw new Error("Fixture refused a non-read request.");
    calls.push({ url: u.href, options });
    if (intercept) {
      const intercepted = await intercept(u, calls.length);
      if (intercepted) return intercepted;
    }
    const path = u.pathname.replace(/^\/(users|groups)\/[1-9][0-9]*\//, "");
    let rows;
    if (path === "items/top") rows = items;
    else if (/^collections\/[A-Z0-9]{8}\/items\/top$/.test(path)) {
      rows = items.filter(item => item.data.collections.includes(path.split("/")[1]));
    } else if (/^items\/[A-Z0-9]{8}\/children$/.test(path)) rows = children[path.split("/")[1]] || [];
    else if (/^items\/[A-Z0-9]{8}\/file$/.test(path)) {
      const data = files[path.split("/")[1]];
      return data ? new Response(data, { headers: { "Content-Type": "application/pdf" } }) : jsonResponse({}, {}, 404);
    } else throw new Error("Fixture refused an unexpected endpoint: " + path);
    if (u.searchParams.has("sort") && u.searchParams.get("sort") !== "dateAdded") {
      throw new Error("Fixture expects a documented Zotero sort field.");
    }
    const query = (u.searchParams.get("q") || "").toLowerCase();
    if (query) rows = rows.filter(row => JSON.stringify([row.data.title, row.data.creators, row.data.date]).toLowerCase().includes(query));
    const start = Number(u.searchParams.get("start") || 0), limit = Number(u.searchParams.get("limit") || 100);
    return jsonResponse(rows.slice(start, start + limit));
  };
  return { fetch, calls, items, children, files };
}

export class FakeApp {
  constructor(options = {}) {
    this.settings = { "Library type": "users", "Library ID": "123", "API key": "", "Options JSON": JSON.stringify(options) };
    this.notes = new Map(); this.alerts = []; this.prompts = []; this.promptAnswers = [];
    this.confirmImport = true; this.writes = 0; this.uploads = []; this.created = 0;
    this.failWrite = false; this.ignoreWrite = false; this.failTag = false; this.failUpload = false;
    this.selection = ""; this.selectionAvailable = true;
    this.context = { replaceSelection: async text => {
      if (!this.selectionAvailable) return false;
      this.selection = text; return true;
    } };
  }
  async alert(text, options) {
    this.alerts.push(text);
    return options?.actions ? (this.confirmImport ? (options.actions[0].value ?? 0) : -1) : -1;
  }
  async prompt(text, options) {
    this.prompts.push({ text, options });
    if (!this.promptAnswers.length) throw new Error("Fixture has no prompt answer.");
    return this.promptAnswers.shift();
  }
  async setSetting(key, value) { this.settings[key] = value; }
  async filterNotes({ tag }) {
    return [...this.notes.values()].filter(note => note.tags.includes(tag)).map(note => ({ uuid: note.uuid }));
  }
  async createNote(name, tags) {
    const uuid = "local-" + (++this.created);
    this.notes.set(uuid, { uuid, name, tags: [...tags], body: "" });
    return uuid;
  }
  async getNoteContent({ uuid }) {
    if (!this.notes.has(uuid)) throw new Error("Fixture note missing.");
    return this.notes.get(uuid).body;
  }
  async addNoteTag({ uuid }, tag) {
    if (this.failTag) return false;
    const note = this.notes.get(uuid);
    if (!note) throw new Error("Fixture note missing.");
    if (!note.tags.includes(tag)) note.tags.push(tag);
    return true;
  }
  async insertNoteContent({ uuid }, content, { atEnd }) {
    if (this.failWrite) throw new Error("Fixture note is read-only.");
    if (this.ignoreWrite) return;
    const note = this.notes.get(uuid);
    note.body = atEnd ? note.body + content : content + note.body;
    this.writes++;
  }
  async attachNoteMedia({ uuid }, dataURL) {
    if (this.failUpload) throw new Error("Fixture upload failure.");
    if (!this.notes.has(uuid) || !/^data:application\/pdf;base64,/.test(dataURL)) throw new Error("Invalid fixture upload.");
    this.uploads.push({ uuid, dataURL });
    return `https://images.amplenote.com/fixture-${this.uploads.length}.pdf`;
  }
}

export const pdf = { key: "PDFD0001", version: 1, data: { key: "PDFD0001", version: 1,
  itemType: "attachment", parentItem: "ITEM0001", title: "Fixture PDF", contentType: "application/pdf", linkMode: "imported_file" } };
export const note = { key: "NOTE0001", version: 1, data: { key: "NOTE0001", version: 1,
  itemType: "note", parentItem: "ITEM0001", note: "<p>A <b>synthetic</b> note.</p>" } };
export const annotation = { key: "ANNO0001", version: 1, data: { key: "ANNO0001", version: 1,
  itemType: "annotation", parentItem: "PDFD0001", annotationType: "highlight", annotationPageLabel: "3",
  annotationText: "A highlighted sentence.", annotationComment: "A synthetic comment." } };
