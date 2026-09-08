import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createPlugin } from "../plugin.mjs";
import { ZoteroCore as Core } from "../core.mjs";
import { reference, service, jsonResponse, FakeApp, pdf, note } from "./fixtures.mjs";

// Deterministic clock: tests never sleep or leave a background sync running.
class Clock {
  time = Date.now();
  sequence = 0;
  pending = new Map();
  now = () => this.time;
  schedule = (callback, delay) => {
    const id = ++this.sequence;
    this.pending.set(id, { callback, at: this.time + delay });
    return id;
  };
  unschedule = id => this.pending.delete(id);
  async tick() {
    const next = [...this.pending].sort((a, b) => a[1].at - b[1].at)[0];
    assert.ok(next, "Expected a scheduled callback");
    this.pending.delete(next[0]);
    this.time = Math.max(this.time, next[1].at);
    return next[1].callback();
  }
}

function setup(options = {}, source = {}) {
  const clock = new Clock(), app = new FakeApp(options), s = service(source);
  const plugin = createPlugin({ fetchImpl: s.fetch, now: clock.now,
    schedule: clock.schedule, unschedule: clock.unschedule });
  const run = name => plugin.appOption[name].call(plugin, app);
  return { clock, app, s, plugin, run,
    start: () => run("Start automatic sync in this client"),
    stop: () => run("Stop automatic sync"),
    status: () => plugin._autoStatus(),
    navigate: () => plugin.onNavigate(app, "https://www.amplenote.com/notes") };
}

function gate() {
  let release, entered;
  const wait = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  return { release, started, block: async () => { entered(); await wait; } };
}

test("automatic interval is bounded and does not change rendered revision identity", async () => {
  const config = Core.config({ libraryId: "123" });
  assert.equal(config.autoSyncMinutes, 15);
  for (const invalid of [0, -1, 1.5, "15", 1441, Infinity]) {
    assert.throws(() => Core.config({ libraryId: "123", autoSyncMinutes: invalid }), /autoSyncMinutes/);
  }
  const item = reference();
  assert.equal(await Core.revision(config, item, [], []),
    await Core.revision({ ...config, autoSyncMinutes: 30 }, item, [], []));
});

test("new client and navigation never enable automatic imports implicitly", async () => {
  const h = setup({ autoSyncMinutes: 1 });
  await h.navigate();
  assert.equal(h.s.calls.length, 0);
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.app.notes.size, 0);
  assert.equal(h.status().enabled, false);
});

test("cancelled enable confirmation performs no source requests or writes", async () => {
  const h = setup(); h.app.confirmImport = false;
  assert.equal(await h.start(), null);
  assert.equal(h.s.calls.length, 0);
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.status().enabled, false);
});

test("automatic checks import child changes, preserve manual text, and leave repeats unchanged", async () => {
  const child = structuredClone(note);
  const h = setup({ autoSyncMinutes: 1 }, { children: { ITEM0001: [child] } });
  await h.start();
  const initialAlerts = h.app.alerts.length;
  await h.clock.tick();
  assert.equal(h.app.notes.size, 1);
  assert.equal(h.status().lastRun.created, 1);
  const imported = h.app.notes.get("local-1");
  imported.body += "\nManual observations stay here.\n";
  child.data.note = "<p>Fresh source annotation</p>";
  await h.clock.tick();
  assert.equal(h.status().lastRun.updated, 1);
  assert.ok(imported.body.includes("Fresh source annotation"));
  assert.ok(imported.body.includes("Manual observations stay here."));
  const beforeRepeat = imported.body;
  await h.clock.tick();
  assert.equal(h.status().lastRun.unchanged, 1);
  assert.equal(h.app.writes, 2);
  assert.equal(imported.body, beforeRepeat);
  assert.equal(h.app.alerts.length, initialAlerts, "Successful polls must not open dialogs");
  assert.equal(h.clock.pending.size, 1);
  await h.stop();
});

test("an empty automatic selection succeeds quietly and schedules another check", async () => {
  const h = setup({}, { items: [] });
  await h.start();
  const alerts = h.app.alerts.length;
  await h.clock.tick();
  assert.equal(h.status().lastRun.selected, 0);
  assert.equal(h.status().lastRun.failed, 0);
  assert.equal(h.app.alerts.length, alerts);
  assert.equal(h.clock.pending.size, 1);
  await h.stop();
});

test("repeated start and frequent navigation do not add timers or postpone the deadline", async () => {
  const h = setup({ autoSyncMinutes: 5 });
  await h.start(); await h.clock.tick();
  const due = h.status().nextAt, calls = h.s.calls.length;
  await h.start();
  h.clock.time += 60000;
  await h.navigate(); await h.navigate();
  assert.equal(h.clock.pending.size, 1);
  assert.equal(h.status().nextAt, due);
  assert.equal(h.s.calls.length, calls);
  await h.stop();
});

test("navigation after throttling catches up once instead of replaying missed intervals", async () => {
  const h = setup({ autoSyncMinutes: 1 });
  await h.start(); await h.clock.tick();
  h.clock.time += 10 * 60000;
  await h.navigate(); await h.navigate();
  assert.equal(h.clock.pending.size, 1);
  assert.equal(h.status().nextAt, h.clock.time);
  const calls = h.s.calls.length;
  await h.clock.tick();
  assert.equal(h.s.calls.length, calls + 2);
  assert.equal(h.clock.pending.size, 1);
  assert.equal(h.status().nextAt, h.clock.time + 60000);
  await h.stop();
});

test("stopping invalidates even a callback already queued by the runtime", async () => {
  const h = setup();
  await h.start();
  const queued = [...h.clock.pending.values()][0].callback;
  await h.stop();
  await queued(); await h.navigate();
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.s.calls.length, 0);
  assert.equal(h.status().state, "stopped");
});

test("stop during metadata reads prevents every note mutation", async () => {
  const g = gate();
  const h = setup({}, { items: [reference(), reference("ITEM0002")],
    intercept: async u => { if (u.pathname.endsWith("/children")) await g.block(); } });
  await h.start(); const running = h.clock.tick(); await g.started;
  await h.stop(); g.release(); await running;
  assert.equal(h.app.notes.size, 0);
  assert.equal(h.status().lastRun.cancelled, true);
  assert.equal(h.status().lastRun.notAttempted, 2);
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.status().state, "stopped");
});

test("stop during a file download prevents note creation and upload", async () => {
  const g = gate();
  const h = setup({ copyAttachments: true }, { children: { ITEM0001: [pdf] },
    files: { PDFD0001: new Uint8Array([1, 2, 3]) },
    intercept: async u => { if (u.pathname.endsWith("/file")) await g.block(); } });
  await h.start(); const running = h.clock.tick(); await g.started;
  await h.stop(); g.release(); await running;
  assert.equal(h.app.notes.size, 0);
  assert.equal(h.app.uploads.length, 0);
  assert.equal(h.status().lastRun.cancelled, true);
  assert.equal(h.status().lastRun.failed, 0);
  assert.equal(h.clock.pending.size, 0);
});

test("stop during a write completes the current reference and leaves subsequent references untouched", async () => {
  const h = setup({}, { items: [reference(), reference("ITEM0002")] });
  const g = gate(), write = h.app.insertNoteContent.bind(h.app);
  h.app.insertNoteContent = async (...args) => { await g.block(); return write(...args); };
  await h.start(); const running = h.clock.tick(); await g.started;
  const stopping = await h.stop();
  assert.equal(stopping.state, "stopping");
  g.release(); await running;
  assert.equal(h.app.notes.size, 1);
  assert.equal(h.app.writes, 1);
  assert.ok(h.app.notes.get("local-1").body.includes("Sample research"));
  assert.equal(h.status().lastRun.created, 1);
  assert.equal(h.status().lastRun.notAttempted, 1);
  assert.equal(h.status().lastRun.cancelled, true);
  assert.equal(h.status().state, "stopped");
  assert.equal(h.clock.pending.size, 0);
});

test("opening configuration disarms automatic sync even when editing is cancelled", async () => {
  const h = setup();
  await h.start(); h.app.promptAnswers = [null];
  await h.run("Configure");
  assert.equal(h.status().enabled, false);
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.s.calls.length, 0);
  assert.equal(await h.run("Preview selection"), 1);
});

test("settings changed through the host pause before source requests", async () => {
  const h = setup();
  await h.start(); h.app.settings["Library ID"] = "456";
  await h.navigate();
  assert.equal(h.status().state, "paused");
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.s.calls.length, 0);
  assert.ok(h.status().error.includes("Settings changed"));
});

test("navigation compares refreshed settings without assuming app.settings updates synchronously", async () => {
  const h = setup();
  h.app.context.refreshSettings = async () => ({ ...h.app.settings, "Library ID": "456" });
  await h.start(); await h.navigate();
  assert.equal(h.app.settings["Library ID"], "123");
  assert.equal(h.status().state, "paused");
  assert.equal(h.s.calls.length, 0);
  assert.equal(h.app.notes.size, 0);
});

test("timer polls do not reuse context-only methods after the originating action ends", async () => {
  const h = setup();
  let contextCalls = 0;
  h.app.context.refreshSettings = async () => { contextCalls++; throw new Error("Invalid context call"); };
  await h.start(); await h.clock.tick();
  assert.equal(contextCalls, 0);
  assert.equal(h.app.notes.size, 1);
  assert.equal(h.status().lastRun.created, 1);
  assert.equal(h.status().state, "waiting");
  await h.stop();
});

test("settings changed during a pending metadata request prevent writes", async () => {
  const g = gate();
  const h = setup({}, { intercept: async u => { if (u.pathname.endsWith("/children")) await g.block(); } });
  await h.start(); const running = h.clock.tick(); await g.started;
  h.app.settings["Options JSON"] = '{"tags":["different"]}';
  g.release(); await running;
  assert.equal(h.status().state, "paused");
  assert.equal(h.app.notes.size, 0);
  assert.equal(h.clock.pending.size, 0);
});

test("automatic snapshot drift pauses before writing and does not retry on navigation", async () => {
  const h = setup({}, { intercept: u => u.pathname.endsWith("/children")
    ? jsonResponse([], { "Last-Modified-Version": "43" }) : null });
  await h.start(); await h.clock.tick();
  assert.equal(h.app.notes.size, 0);
  assert.equal(h.status().state, "paused");
  assert.ok(h.status().error.includes("changed during sync"));
  const calls = h.s.calls.length;
  await h.navigate();
  assert.equal(h.s.calls.length, calls);
  assert.equal(h.clock.pending.size, 0);
});

test("rate limiting pauses the driver after one request with no automatic retry", async () => {
  const h = setup({}, { intercept: () => jsonResponse({}, { "Retry-After": "60" }, 429) });
  await h.start(); await h.clock.tick();
  assert.equal(h.s.calls.length, 1);
  assert.equal(h.status().state, "paused");
  assert.equal(h.clock.pending.size, 0);
  await h.navigate();
  assert.equal(h.s.calls.length, 1);
  assert.equal(h.app.alerts.filter(x => x.includes("sync paused")).length, 1);
});

test("automatic errors redact the API key from alerts and returned status", async () => {
  const key = "synthetic-private-api-key";
  const h = setup({}, { intercept: () => { throw new Error("Request failed for " + key); } });
  h.app.settings["API key"] = key;
  await h.start(); await h.clock.tick();
  const status = await h.run("Show automatic sync status");
  assert.equal(status.state, "paused");
  assert.ok(!JSON.stringify(status).includes(key));
  assert.ok(!h.app.alerts.join(" ").includes(key));
  assert.ok(status.error.includes("[redacted]"));
});

test("a failed host alert cannot leave a retrying timer or locked plugin", async () => {
  const h = setup({}, { intercept: () => jsonResponse({}, {}, 503) });
  await h.start();
  h.app.alert = async () => { throw new Error("Host context closed"); };
  await h.clock.tick();
  assert.equal(h.status().state, "paused");
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.plugin._busy, false);
  assert.equal(h.status().running, false);
});

test("partial automatic failure keeps accurate counts and requires an explicit restart", async () => {
  const h = setup({}, { items: [reference(), reference("ITEM0002"), reference("ITEM0003")] });
  const write = h.app.insertNoteContent.bind(h.app);
  h.app.insertNoteContent = async (...args) => {
    if (args[0].uuid === "local-2") throw new Error("Second note write refused");
    return write(...args);
  };
  await h.start(); await h.clock.tick();
  const failed = h.status();
  assert.equal(failed.state, "paused");
  assert.equal(failed.lastRun.created, 1);
  assert.equal(failed.lastRun.failed, 1);
  assert.equal(failed.lastRun.notAttempted, 1);
  assert.equal(h.app.notes.size, 2);
  assert.equal(h.clock.pending.size, 0);
  h.app.insertNoteContent = write;
  await h.start(); await h.clock.tick();
  assert.equal(h.status().lastRun.unchanged, 1);
  assert.equal(h.status().lastRun.updated, 1);
  assert.equal(h.status().lastRun.created, 1);
  assert.equal(h.app.notes.size, 3);
  await h.stop();
});

test("a due automatic check defers quietly while a manual action owns the lock", async () => {
  const g = gate(); let block = true;
  const h = setup({}, { intercept: async () => { if (block) await g.block(); } });
  await h.start();
  const manual = h.run("Preview selection"); await g.started;
  const alerts = h.app.alerts.length;
  await h.clock.tick();
  assert.equal(h.s.calls.length, 1);
  assert.equal(h.app.alerts.length, alerts);
  assert.equal(h.clock.pending.size, 1);
  assert.equal(h.status().nextAt, h.clock.time + 30000);
  block = false; g.release(); await manual;
  await h.clock.tick();
  assert.equal(h.app.notes.size, 1);
  await h.stop();
});

test("stop during the enable prompt invalidates a late affirmative response", async () => {
  const h = setup(), g = gate();
  const alert = h.app.alert.bind(h.app);
  h.app.alert = async (text, options) => {
    if (options?.actions?.[0]?.value === "start-auto") { await g.block(); return "start-auto"; }
    return alert(text, options);
  };
  const enabling = h.start(); await g.started;
  await h.stop(); g.release();
  assert.equal(await enabling, null);
  assert.equal(h.status().enabled, false);
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.s.calls.length, 0);
});

test("configuration changes during enable confirmation cannot widen the accepted scope", async () => {
  const h = setup(), g = gate();
  h.app.alert = async (_text, options) => {
    if (options?.actions?.[0]?.value === "start-auto") { await g.block(); return "start-auto"; }
    return -1;
  };
  const enabling = h.start(); await g.started;
  h.app.settings["Options JSON"] = '{"copyAttachments":true}';
  g.release(); await enabling;
  assert.equal(h.status().enabled, false);
  assert.equal(h.clock.pending.size, 0);
  assert.equal(h.s.calls.length, 0);
});

test("the generated bundle exposes navigation and executes the automatic import path", async () => {
  const source = await readFile(new URL("../dist/plugin.js", import.meta.url), "utf8");
  const clock = new Clock(), app = new FakeApp(), s = service();
  const context = { fetch: s.fetch, URL, Response, AbortController,
    setTimeout: clock.schedule, clearTimeout: clock.unschedule,
    TextEncoder, crypto: globalThis.crypto, btoa };
  const plugin = vm.runInNewContext("(" + source + ")", context, { timeout: 1000 });
  await plugin.onNavigate.call(plugin, app, "https://www.amplenote.com/notes");
  assert.equal(s.calls.length, 0);
  const run = name => plugin.appOption[name].call(plugin, app);
  await run("Start automatic sync in this client");
  await clock.tick();
  assert.equal(app.notes.size, 1);
  assert.equal(app.writes, 1);
  assert.equal(clock.pending.size, 1);
  await run("Stop automatic sync");
  assert.equal(clock.pending.size, 0);
  const fresh = vm.runInNewContext("(" + source + ")", context, { timeout: 1000 });
  await fresh.onNavigate.call(fresh, app, "https://www.amplenote.com/notes");
  assert.equal(clock.pending.size, 0, "Reloaded plugin must not inherit an active client session");
});
