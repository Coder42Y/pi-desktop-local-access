"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { uploadFile, validateConfig } = require("./transfer.cjs");
const CHUNK_BYTES = 44 * 1024;
const active = (job) => job && ["receiving", "uploading"].includes(job.state);

function metadata(files) {
  if (!Array.isArray(files) || !files.length || files.length > 20) throw new Error("Paste 1–20 files at a time.");
  return files.map((file) => {
    const name = file?.name;
    if (typeof name !== "string" || !name || name.length > 255 || /[\\/\x00-\x1f\x7f]/.test(name) || [".", "..", ".partial"].includes(name)) throw new Error("Invalid pasted file name.");
    if (/^\.env|\.(pem|key|p12|pfx)$/i.test(name)) throw new Error("Credential file names are not accepted.");
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 2 * 1024 ** 3) throw new Error("Pasted files must be at most 2 GiB each.");
    return { name, size: file.size, received: 0 };
  });
}

function createPasteStore(deps) {
  let job = null, disposed = false;
  let serial = Promise.resolve();
  const workers = new Set();
  let lastSweep = Date.now();
  const locked = (fn) => { const result = serial.then(fn); serial = result.catch(() => {}); return result; };
  const find = (id) => { if (!job || job.id !== id) throw new Error("Paste job not found."); return job; };
  const snapshot = () => job && ({ id: job.id, sessionId: job.sessionId, state: job.state, target: job.config.target,
    total: job.files.reduce((n, file) => n + file.size, 0), received: job.files.reduce((n, file) => n + file.received, 0),
    sent: job.sent, files: job.files.map(({ name, size }) => ({ name, size })), results: [...job.results], error: job.error || null });
  const cleanup = async (current) => { if (current.directory) await fs.rm(current.directory, { recursive: true, force: true }); };
  const sweep = async () => {
    await fs.mkdir(deps.dataPath, { recursive: true });
    for (const entry of await fs.readdir(deps.dataPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^paste-[a-zA-Z0-9]{6,}$/.test(entry.name)) continue;
      const directory = path.join(deps.dataPath, entry.name);
      if (directory === job?.directory) continue;
      const info = await fs.stat(directory).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 24 * 3600000) await fs.rm(directory, { recursive: true, force: true });
    }
  };
  const ready = sweep();
  void ready.catch(() => {});
  const begin = (input) => locked(async () => {
    await ready;
    if (disposed) throw new Error("SSH Upload was unloaded.");
    if (active(job)) throw new Error("Another paste upload is active.");
    const files = metadata(input.files);
    const session = await deps.getSession();
    if (!session?.sessionId || session.sessionId !== input.sessionId) throw new Error("Session changed before paste upload started.");
    const saved = deps.getConfig(session);
    if (!saved?.target) throw new Error("Configure and save an SSH target first.");
    const config = validateConfig(saved);
    await fs.mkdir(deps.dataPath, { recursive: true });
    const directory = await fs.mkdtemp(path.join(deps.dataPath, "paste-"));
    const current = { id: randomUUID(), sessionId: session.sessionId, configurationKey: session.configurationKey, config, directory, files, state: "receiving", results: [], sent: 0, abort: new AbortController(), updated: Date.now() };
    try {
      for (const [i, file] of files.entries()) {
        file.path = path.join(directory, `${i}.part`);
        await fs.writeFile(file.path, "", { flag: "wx", mode: 0o600 });
      }
    } catch (error) { await cleanup(current); throw error; }
    job = current;
    return snapshot();
  });
  const chunk = (input) => locked(async () => {
    const current = find(input.id);
    if (disposed || current.state !== "receiving") throw new Error("Paste job is not receiving data.");
    const file = current.files[input.index];
    if (!Number.isInteger(input.index) || !file) throw new Error("Invalid pasted file index.");
    if (input.offset !== file.received) throw new Error("Pasted file offset is out of order.");
    if (typeof input.data !== "string" || input.data.length > 60076 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw new Error("Invalid paste chunk.");
    const bytes = Buffer.from(input.data, "base64");
    if (!bytes.length || bytes.length > CHUNK_BYTES || file.received + bytes.length > file.size) throw new Error("Paste chunk exceeds the file or chunk size.");
    await fs.appendFile(file.path, bytes);
    file.received += bytes.length;
    current.updated = Date.now();
    return { received: file.received };
  });
  const finish = (id) => locked(async () => {
    const current = find(id);
    if (disposed || current.state !== "receiving") throw new Error("Paste job cannot be finalized.");
    if (current.files.some((file) => file.received !== file.size)) throw new Error("Pasted file is incomplete.");
    const session = await deps.getSession();
    if (session?.sessionId !== current.sessionId) throw new Error("Session changed before upload; return and paste again.");
    if (current.configurationKey && session.configurationKey !== current.configurationKey) throw Object.assign(new Error("SSH configuration changed before paste upload."), { code: "SSH_CONFIGURATION_CHANGED" });
    current.state = "uploading";
    current.work = (async () => {
      let completed = 0;
      try {
        for (const file of current.files) {
          if (current.abort.signal.aborted) return;
          const result = await (deps.uploadFile || uploadFile)(file, current.config, { signal: current.abort.signal, onProgress(bytes) { current.sent = completed + bytes; } });
          current.results.push(result);
          completed += file.size;
        }
        if (!current.abort.signal.aborted) current.state = "done";
      } catch (error) { if (!current.abort.signal.aborted) { current.state = "error"; current.error = error.message; } }
      finally { await cleanup(current).catch(() => {}); }
    })();
    workers.add(current.work);
    void current.work.finally(() => workers.delete(current.work));
    return snapshot();
  });
  const cancel = (id) => locked(async () => {
    const current = find(id);
    if (active(current)) { current.state = "cancelled"; current.abort.abort(); }
    if (!current.work) await cleanup(current);
    return snapshot();
  });
  const timer = setInterval(() => {
    if (job?.state === "receiving" && Date.now() - job.updated > 120000) void cancel(job.id).catch(() => {});
    if (Date.now() - lastSweep > 30 * 60000) { lastSweep = Date.now(); void sweep().catch(() => {}); }
  }, 30000);
  timer.unref?.();
  return { ready, begin, chunk, finish, cancel, poll(id) { find(id); return snapshot(); }, current: snapshot,
    async dispose() { disposed = true; clearInterval(timer); if (job) await cancel(job.id); await Promise.allSettled([...workers]); },
  };
}
module.exports = { createPasteStore, CHUNK_BYTES };
