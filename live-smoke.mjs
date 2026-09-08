// One unauthenticated, read-only request to the public example in Zotero's docs.
// No user credentials, account registration, note writes, or automatic retries.
import { mkdir, writeFile } from "node:fs/promises";
import { ZoteroCore as Core } from "./core.mjs";

const root = new URL("./", import.meta.url);
const path = "collections/9KH9TNSJ/items/top";
const report = { attemptedAt: new Date().toISOString(),
  documentation: "https://www.zotero.org/support/dev/web_api/v3/basics#example_get_requests_and_responses",
  endpoint: "https://api.zotero.org/users/475425/" + path,
  maximumRecordsRequested: 1, authenticated: false, automaticRetries: 0,
  fullIntegrationVerified: false, verified: false };
try {
  const client = new Core.Client({ libraryId: "475425" });
  const rows = await client.request(path, { format: "json", include: "data,bib,citation", style: "apa",
    locale: "en-US", sort: "dateAdded", direction: "asc", limit: 1 });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("The documented public example did not return one reference.");
  const item = rows[0]; Core.itemKey(item);
  if (!item.data || typeof item.bib !== "string" || typeof item.citation !== "string") throw new Error("The public response lacks expected metadata or formatted output.");
  const digest = await Core.revision(client.config, item, [], []);
  const markdown = Core.render(client.config, item, [], [], {}, digest);
  report.verified = markdown.includes(Core.MARKER + digest);
  report.returnedRecordCount = rows.length;
  report.hasFormattedCitation = !!Core.htmlToMarkdown(item.citation);
  report.hasBibliography = !!Core.htmlToMarkdown(item.bib);
  report.libraryVersion = client.libraryVersion;
  report.scope = "One public metadata request, citation/bibliography decoding and local rendering. No private authentication, attachments, or Amplenote execution tested.";
} catch (error) {
  report.error = error instanceof Error ? error.message : "Public example check failed.";
  process.exitCode = 1;
}
await mkdir(new URL("evidence/", root), { recursive: true });
await writeFile(new URL("evidence/live-smoke.json", root), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
