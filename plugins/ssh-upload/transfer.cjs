"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

function validateConfig(input = {}) {
  const target = String(input.target || "").trim();
  if (!/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*|\[[a-fA-F0-9:]+\])$/.test(target)) {
    throw new Error("SSH target must be a config alias or user@hostname (not a command or URL).");
  }
  const port = input.port === "" || input.port == null ? null : Number(input.port);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("SSH port must be 1–65535.");
  const directory = String(input.directory || "~/.pi-desktop/uploads").trim().replace(/\/+$/, "") || "/";
  if ((!directory.startsWith("/") && !directory.startsWith("~/")) || /[\x00-\x1f\x7f]/.test(directory) || directory.split("/").includes("..")) {
    throw new Error("Remote directory must be absolute or start with ~/ and contain no .. or control characters.");
  }
  let identity = String(input.identity || "").trim();
  if (identity.startsWith("~/")) identity = path.join(require("node:os").homedir(), identity.slice(2));
  if (identity && (!path.isAbsolute(identity) || /[\x00-\x1f\x7f]/.test(identity))) throw new Error("Identity file must be an absolute path.");
  const result = { target, port, directory, identity };
  if (input.workspaceRoot) {
    const root = String(input.workspaceRoot);
    if (!root.startsWith("/") || /[\x00-\x1f\x7f]/.test(root) || root.split("/").includes("..")) throw new Error("Invalid remote workspace root.");
    result.workspaceRoot = path.posix.normalize(root);
    const relative = path.posix.relative(result.workspaceRoot, directory);
    if (!directory.startsWith("/") || relative === ".." || relative.startsWith("../")) throw new Error("Upload directory must be inside the remote workspace.");
  }
  return result;
}

function sshArgs(config, command) {
  const args = ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-o", "ClearAllForwardings=yes", "-o", "PermitLocalCommand=no"];
  if (config.port) args.push("-p", String(config.port));
  if (config.identity) args.push("-i", config.identity);
  return [...args, "--", config.target, command];
}
const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;

function remoteCommand(config, name, id) {
  const base = config.directory.startsWith("~/") ? `"$HOME"/${quote(config.directory.slice(2))}` : quote(config.directory);
  // A private, fresh directory prevents overwrites and keeps incomplete bytes hidden.
  return [
    "set -eu", "umask 077", `base=${base}`, 'mkdir -p "$base"',
    ...(config.workspaceRoot ? [
      `root=$(cd ${quote(config.workspaceRoot)} && pwd -P)`, 'root=${root%/}',
      'base=$(cd "$base" && pwd -P)',
      'case "$base/" in "$root/"*) ;; *) echo "Upload path is outside remote workspace" >&2; exit 1 ;; esac',
    ] : []),
    `dir="$base"/${quote(`pi-upload-${id}`)}`, 'mkdir "$dir"',
    'part="$dir/.partial"', `dest="$dir"/${quote(name)}`,
    "trap 'rm -f \"$part\"; rmdir \"$dir\" 2>/dev/null || :' 0",
    "trap 'exit 1' HUP INT TERM",
    'if command -v sha256sum >/dev/null 2>&1; then hasher=sha256sum; elif command -v shasum >/dev/null 2>&1; then hasher=shasum; else echo "Remote needs sha256sum or shasum" >&2; exit 1; fi',
    'cat > "$part"',
    'if [ "$hasher" = sha256sum ]; then digest=$(sha256sum < "$part"); else digest=$(shasum -a 256 < "$part"); fi',
    'digest=${digest%% *}',
    'mv "$part" "$dest"',
    'printf "PI_UPLOAD_V1\\n%s\\n%s\\n" "$dest" "$digest"',
  ].join("; ");
}

function sshEnvironment() {
  const env = { ...process.env };
  // The plugin host intentionally strips SSH_AUTH_SOCK. Recover only the socket location.
  if (!env.SSH_AUTH_SOCK && process.platform === "darwin") {
    const result = spawnSync("/bin/launchctl", ["getenv", "SSH_AUTH_SOCK"], { encoding: "utf8", timeout: 1000 });
    const socket = result.stdout?.trim();
    if (socket?.startsWith("/")) env.SSH_AUTH_SOCK = socket;
  }
  return env;
}

async function localFile(candidate) {
  const absolute = await fsp.realpath(candidate);
  if (absolute.split(path.sep).some((part) => [".ssh", ".aws", ".git", ".gnupg"].includes(part)) || /(?:^|\/)\.env[^/]*$|\.(?:pem|key|p12|pfx)$/i.test(absolute)) {
    throw new Error("Credential files are not accepted by SSH Upload.");
  }
  const info = await fsp.stat(absolute);
  const name = path.basename(absolute);
  if (!info.isFile() || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Select regular files with no control characters in their names.");
  return { path: absolute, name, size: info.size, dev: info.dev, ino: info.ino, mtimeMs: info.mtimeMs };
}

async function uploadFile(file, config, options = {}) {
  config = validateConfig(config);
  if (!file.name || path.basename(file.name) !== file.name || [".", "..", ".partial"].includes(file.name) || /[\x00-\x1f\x7f]/.test(file.name)) throw new Error("Invalid file name.");
  if (options.signal?.aborted) throw new Error("Upload cancelled.");
  const handle = await fsp.open(file.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let child;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== file.size || (file.ino != null && (file.ino !== info.ino || file.dev !== info.dev || file.mtimeMs !== info.mtimeMs))) throw new Error("Selected file changed; please select it again.");
    const args = sshArgs(config, remoteCommand(config, file.name, randomUUID()));
    child = options.spawnSsh ? options.spawnSsh(args) : spawn("/usr/bin/ssh", args, { stdio: ["pipe", "pipe", "pipe"], env: sshEnvironment() });
    let stdout = "", stderr = "", bytes = 0, reason = null;
    const digest = createHash("sha256");
    const stop = (message) => { reason ||= message; child.kill("SIGTERM"); };
    const abort = () => stop("Upload cancelled.");
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => stop("Upload timed out after 60 minutes."), options.timeoutMs || 60 * 60 * 1000);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > 16384) stop("SSH returned too much output.");
    });
    child.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-8192); });
    const closed = new Promise((resolve) => {
      child.once("error", (error) => { reason ||= error.message; resolve(-1); });
      child.once("close", (code) => resolve(code));
    });
    const meter = new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length;
      digest.update(chunk);
      options.onProgress?.(bytes);
      callback(null, chunk);
    } });
    try {
      const source = handle.createReadStream({ autoClose: false });
      const transfer = pipeline(source, meter, child.stdin).catch((error) => { stop(`File stream failed: ${error.message}`); return error; });
      const code = await closed;
      source.destroy();
      const streamError = await transfer;
      if (options.signal?.aborted) throw new Error("Upload cancelled.");
      if (code !== 0 || reason || streamError) throw new Error(stderr.trim() || reason || `SSH exited with code ${code}.`);
      const lines = stdout.trim().split(/\r?\n/);
      const marker = lines.lastIndexOf("PI_UPLOAD_V1");
      const remotePath = lines[marker + 1], remoteHash = lines[marker + 2];
      if (marker < 0 || !remotePath?.startsWith("/") || !/^[a-f0-9]{64}$/.test(remoteHash || "")) throw new Error("Invalid upload acknowledgement from remote server.");
      if (bytes !== file.size || remoteHash !== digest.digest("hex")) throw new Error("Upload checksum mismatch. Remote file must not be used; select and upload again.");
      return { name: file.name, path: remotePath, sha256: remoteHash, size: bytes };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  } finally {
    if (child && child.exitCode == null) child.kill("SIGTERM");
    await handle.close();
  }
}

function parsePickerOutput(output) {
  return output.replace(/\r?\n$/, "").split("\0").filter(Boolean);
}

async function pickFiles(signal) {
  if (process.platform !== "darwin") throw new Error("This plugin currently uses the macOS file picker.");
  const script = 'set picked to choose file with prompt "SSH Upload: select files to send" with multiple selections allowed\nset output to ""\nrepeat with itemRef in picked\nset output to output & (POSIX path of itemRef) & (ASCII character 0)\nend repeat\nreturn output';
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "";
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, 10 * 60 * 1000);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data) => { output += data.toString(); if (output.length > 65536) abort(); });
    child.stderr.on("data", (data) => { error = (error + data.toString()).slice(-4096); });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted || /\(-128\)/.test(error)) return resolve([]);
      if (code !== 0) return reject(new Error(error || "macOS file picker failed."));
      resolve(parsePickerOutput(output));
    });
  });
}

function createController(deps) {
  let job = null;
  const snapshot = () => job && ({ id: job.id, sessionId: job.sessionId, state: job.state,
    files: job.files.map(({ name, size }) => ({ name, size })), results: [...job.results],
    sent: job.sent, total: job.files.reduce((sum, file) => sum + file.size, 0), error: job.error || null });
  const find = (id) => { if (!job || job.id !== id) throw new Error("Upload job not found."); return job; };
  const select = async () => {
    const session = await deps.getSession();
    if (!session?.sessionId) throw new Error("Open a conversation before uploading.");
    if (job && ["selecting", "uploading"].includes(job.state)) throw new Error("An upload job is already active.");
    const selected = { id: randomUUID(), sessionId: session.sessionId, state: "selecting", files: [], results: [], sent: 0, abort: new AbortController() };
    job = selected;
    void (async () => {
      try {
        const paths = await (deps.pickFiles || pickFiles)(selected.abort.signal);
        if (selected.abort.signal.aborted) return;
        if (!paths.length) { selected.state = "cancelled"; return; }
        if (paths.length > 20) throw new Error("Select at most 20 files per upload.");
        selected.files = await Promise.all(paths.map(localFile));
        if (!selected.abort.signal.aborted) selected.state = "selected";
      } catch (error) {
        if (!selected.abort.signal.aborted) { selected.error = error.message; selected.state = "error"; }
      }
    })();
    return snapshot();
  };
  const start = async (id, input) => {
    const current = find(id);
    const session = await deps.getSession();
    if (current.sessionId !== session?.sessionId) throw new Error("Session changed. Return to the original session to upload.");
    if (current.state !== "selected") throw new Error("Upload job has no selected files.");
    const config = validateConfig(input);
    current.state = "uploading";
    void (async () => {
      let completed = 0;
      try {
        for (const file of current.files) {
          if (current.abort.signal.aborted) return;
          const result = await (deps.uploadFile || uploadFile)(file, config, { signal: current.abort.signal, onProgress(count) { current.sent = completed + count; } });
          current.results.push(result);
          completed += file.size;
        }
        if (!current.abort.signal.aborted) current.state = "done";
      } catch (error) {
        if (!current.abort.signal.aborted) { current.error = error.message; current.state = "error"; }
      }
    })();
    return snapshot();
  };
  const cancel = (id) => { const current = find(id); if (["selecting", "selected", "uploading"].includes(current.state)) { current.state = "cancelled"; current.abort.abort(); } return snapshot(); };
  return { select, start, poll(id) { find(id); return snapshot(); }, cancel,
    current: snapshot,
    dispose() { if (job) job.abort.abort(); job = null; },
  };
}
module.exports = { validateConfig, sshArgs, uploadFile, createController, parsePickerOutput };
