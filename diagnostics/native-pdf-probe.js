{
_probeRunning: false,
appOption: {
  "Validate original PDF upload": async function(app) {
    if (this._probeRunning) return;
    this._probeRunning = true;
    const report = { at: new Date().toISOString(), scope: "Original fixture and native Amplenote APIs only; not a Zotero network test", stages: [] };
    try {
      const matches = await app.filterNotes({tag:"test/zotero-attachment-probe"});
      if (!Array.isArray(matches) || matches.length > 1) throw new Error("Resolve probe-note ambiguity before continuing.");
      let note = matches[0];
      if (!note) {
        note = {uuid:await app.createNote("Zotero native attachment validation",["test/zotero-attachment-probe"])};
        report.stages.push("created note");
        report.noteUUID = note.uuid;
        const url = await app.attachNoteMedia(note,"data:application/pdf;base64,JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChtaW5ld2VmdSkgL0NyZWF0aW9uRGF0ZSAoRDoyMDAwMDEwMTAwMDAwMCswMCcwMCcpIC9DcmVhdG9yIChhbm9ueW1vdXMpIC9LZXl3b3JkcyAoKSAvTW9kRGF0ZSAoRDoyMDAwMDEwMTAwMDAwMCswMCcwMCcpIC9Qcm9kdWNlciAoUmVwb3J0TGFiIFBERiBMaWJyYXJ5IC0gXChvcGVuc291cmNlXCkpIAogIC9TdWJqZWN0ICh1bnNwZWNpZmllZCkgL1RpdGxlIChab3Rlcm8gQnJpZGdlIFBERiBmaXh0dXJlKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyA0IDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKOCAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCA1MjUKPj4Kc3RyZWFtCkdhczFbYV9vaWUmQUBya2hRW0InTC1uZ0JERnMvZUxVSylCLCk9clFNMz9RR0E0ZkYyIjgoVkgvSTM9VS43QGhMUCZLPEsrbjUhS3BiKi9uWGhyVS9KSFNwXVAiXDJqXy0vRS1jU0hYKEAiUDtFTidiY0xqVSQ9QChhL3JJJU00Yy1Da2RVa1JiOzgsUFc3Lm4rISteY111LXMyPE1RaHRGR0pUSmwkQk5kVFJLLjNjSCpJaE88ZEdeK0FRcD4lNWpEKmJvVFdlT3NEIVNtV0dZRltcXl5YaiRwMD4ybGRtb0RFYE9LXSlKUi1Kcj0wWW88O09PVENQTjVubmBbUWpQJUNpZURBXiRZWE4yYlBQUDJsbXRxSStYYC0sblwkNkJoVDImJmxXMUBYIlxbIkc1Z1MmX3QudVw/KF1QMzxWcD82VFtEJUZcNG1bbTkoKStDTlxAa2E7Wlk2Ul1oL2ppTVsiP1ZGWCZQIkMsalljPkgiaj1iO0FSSihcRiJZNlZbI2E5aVQ3V2haXmA3NUtVbiMzTCQnOidkXyNMdSRwNiE/WTdTTEhUKThYbEBiQ2FPK25HNzEnYkZkRF1eQDFfLU5TQE9YMGpVdDVbKGxJU2xaTlNFZEh1ZiZOaiNnJmtFRCpqSylEMDpQZ2Ffaj9LTS42TzInPF9ANTgtQTpuMT9sbklKUDNiNCx+PmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDkKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDYxIDAwMDAwIG4gCjAwMDAwMDAxMDIgMDAwMDAgbiAKMDAwMDAwMDIwOSAwMDAwMCBuIAowMDAwMDAwMzIxIDAwMDAwIG4gCjAwMDAwMDA1MTQgMDAwMDAgbiAKMDAwMDAwMDU4MiAwMDAwMCBuIAowMDAwMDAwODU5IDAwMDAwIG4gCjAwMDAwMDA5MTggMDAwMDAgbiAKdHJhaWxlcgo8PAovSUQgCls8NDM1MGY0YjRmNDE4Y2MwMzBmY2Q3OTM4NTkxMDU1NTU+PDQzNTBmNGI0ZjQxOGNjMDMwZmNkNzkzODU5MTA1NTU1Pl0KJSBSZXBvcnRMYWIgZ2VuZXJhdGVkIFBERiBkb2N1bWVudCAtLSBkaWdlc3QgKG9wZW5zb3VyY2UpCgovSW5mbyA2IDAgUgovUm9vdCA1IDAgUgovU2l6ZSA5Cj4+CnN0YXJ0eHJlZgoxNTMzCiUlRU9GCg==");
        report.stages.push("native upload returned");
        if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("Unexpected native attachment URL.");
        await app.insertNoteContent(note,"# Original PDF attachment fixture\n\n[Open PDF fixture]("+url.replace(/\(/g,"%28").replace(/\)/g,"%29")+")\n",{atEnd:false});
        report.stages.push("inserted PDF link");
      } else {
        report.noteUUID = note.uuid;
        report.stages.push("reused existing probe note without uploading again");
      }
      const attachments = await app.getNoteAttachments(note);
      report.attachmentCount = attachments.length;
      if (attachments.length !== 1) throw new Error("Expected one attachment. Inspect the existing note before any retry.");
      report.attachmentUUID = attachments[0].uuid;
      const url = await app.getAttachmentURL(attachments[0].uuid);
      const proxy = new URL("https://plugins.amplenote.com/cors-proxy");
      proxy.searchParams.set("apiurl",url);
      const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),30000);
      let bytes;
      try {
        const response = await fetch(proxy.href,{credentials:"omit",signal:controller.signal});
        if (!response.ok) throw new Error("Native attachment read failed with HTTP "+response.status);
        bytes = new Uint8Array(await response.arrayBuffer());
      } finally { clearTimeout(timer); }
      report.bytes = bytes.length;
      const hash = await crypto.subtle.digest("SHA-256",bytes);
      report.sha256 = Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("");
      report.exactByteMatch = report.bytes === 1924 && report.sha256 === "b34f9d202c3aa66e479919921033efdd5404e1f1c5d76ce1eefdb98fe6a63e3b";
      if (!report.exactByteMatch) throw new Error("Uploaded PDF bytes differ from the original fixture.");
      report.noteURL = await app.getNoteURL(note);
      report.stages.push("downloaded native attachment and verified exact bytes");
    } catch(error) { report.error = error?.message || String(error); }
    finally { this._probeRunning = false; }
    await app.alert(JSON.stringify(report,null,2));
    return report;
  }
}
}
