#!/usr/bin/env node
/** Explicitly configured real SSH acceptance; never uses an existing Host profile. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { register } from "node:module";
import { basename, resolve } from "node:path";
import { APP_VERSION } from "../packages/shared/dist/index.js";
import { RacpClient, wsClientTransport } from "../packages/racp/dist/index.js";

register(new URL("../apps/desktop/test/helpers/ts-import-hooks.mjs", import.meta.url));
const { createSystemSshTransport } = await import("../apps/desktop/electron/main/remote/ssh-transport.ts");
const { buildBootstrapScript, parseBootstrapOutput, shellQuote: q } = await import("../apps/desktop/electron/main/remote/pi-host-bootstrap-script.ts");
const { piHostArtifactName, piHostArtifactUrls, piHostBundleDir, parseChecksumFile, resolveTarget, versionsMatch } = await import("../apps/desktop/electron/main/remote/pi-host-release.ts");
assert.ok(process.env.PI_SSH_HOST && process.env.PI_SSH_BUNDLE, "Set PI_SSH_HOST and PI_SSH_BUNDLE explicitly");
const archive = resolve(process.env.PI_SSH_BUNDLE);
const transport = createSystemSshTransport({ host: process.env.PI_SSH_HOST,
  user: process.env.PI_SSH_USER, port: Number(process.env.PI_SSH_PORT ?? 22), identityFile: process.env.PI_SSH_IDENTITY });
const exec = async command => {
  const result = await transport.exec(command);
  assert.equal(result.code, 0, "SSH command failed");
  return result.stdout.trim();
};
const client = (url, token) => new RacpClient({ transport: wsClientTransport({ url, token }),
  client: { name: "fork-ssh-release-acceptance", version: APP_VERSION }, requestTimeoutMs: 30000 });
let home, forward, pairing, owner, report;
try {
  const target = resolveTarget(await exec("uname -s && uname -m"));
  assert.ok(target);
  const name = piHostArtifactName(APP_VERSION, target);
  assert.equal(basename(archive), name);
  const digest = parseChecksumFile(await readFile(`${archive}.sha256`, "utf8"), name);
  assert.ok(digest);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  assert.equal(hash.digest("hex"), digest, "CI release archive checksum");
  home = await exec("umask 077; mktemp -d /tmp/pi-fork-ssh-XXXXXXXX");
  assert.match(home, /^\/tmp\/pi-fork-ssh-[A-Za-z0-9]+$/);
  const urls = piHostArtifactUrls(APP_VERSION, target);
  let artifactPath;
  if (process.env.PI_SSH_DOWNLOAD !== "1") {
    artifactPath = `${home}/${name}`;
    const upload = await transport.execWithFile(`umask 077; cat > ${q(artifactPath)}`, archive, { timeoutMs: 600000 });
    assert.equal(upload.code, 0, "verified candidate archive upload");
  }
  const script = buildBootstrapScript({ version: APP_VERSION, artifactUrl: urls.tarball,
    artifactName: name, bundleDir: piHostBundleDir(APP_VERSION, target), expectedSha256: digest,
    artifactPath, port: 0, pairingLifetimeMs: 120000, readyTimeoutSec: 60 });
  const isolated = `HOME=${q(home)} PI_DESKTOP_DATA_DIR=${q(`${home}/.pi-desktop`)} PI_HOST_BIND=127.0.0.1 PI_HOST_BROWSE_ROOT=${q(home)} PI_HOST_NODE=${q(`${home}/.pi-desktop/pi-host/current/bin/node`)} NODE_OPTIONS= NODE_PATH= sh -s`;
  const installed = await transport.execWithInput(isolated, script, { timeoutMs: 600000 });
  assert.equal(installed.code, 0, "isolated production bootstrap failed (tokens withheld)");
  const output = parseBootstrapOutput(installed.stdout);
  assert.ok(output.ready && output.pairing, "bootstrap readiness and pairing");
  assert.ok(versionsMatch(output.ready.version, APP_VERSION));
  assert.equal(output.ready.host, "127.0.0.1");
  const server = createServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  forward = await transport.forward({ localPort: port, remoteHost: "127.0.0.1", remotePort: output.ready.port });
  const url = `ws://127.0.0.1:${forward.localPort}/v1/racp/ws`;
  pairing = client(url, output.pairing.token);
  await pairing.connect();
  const paired = await pairing.request("connection/pair", { deviceLabel: "isolated fork release acceptance" });
  assert.ok(paired.roles.includes("owner"));
  await pairing.close(); pairing = undefined;
  owner = client(url, paired.deviceToken);
  const init = await owner.connect();
  assert.equal(init.server.hostId, output.ready.hostId);
  assert.ok(versionsMatch(init.server.version, APP_VERSION));
  assert.equal(init.capabilities.workspaceTools, true);
  const workspace = `${home}/workspace`, external = `${home}/external.txt`, marker = `${home}/bash.txt`;
  await exec(`mkdir ${q(workspace)}; printf initial > ${q(external)}`);
  let id = 0;
  const tool = (toolName, args, extra = {}) => owner.request("workspace/toolExecute", {
    path: workspace, sessionId: "ssh-release", turnId: "acceptance", toolCallId: `call-${++id}`, toolName, args, ...extra,
  });
  const read = await tool("Read", { path: external });
  assert.equal(read.ok, true); assert.ok(JSON.stringify(read.content).includes("initial"));
  for (const extra of [{}, { allowExternalWrites: false }]) {
    for (const [toolName, args] of [["Write", { path: external, content: "forged", allowExternalWrites: true }],
      ["Bash", { command: `printf forged > ${q(marker)}`, allowExternalWrites: true }]]) {
      const denied = await tool(toolName, args, extra);
      assert.equal(denied.ok, false); assert.equal(denied.errorCode, "TOOL_DENIED");
    }
  }
  assert.equal(await exec(`cat ${q(external)}; test ! -e ${q(marker)}`), "initial");
  await assert.rejects(tool("Write", { path: external, content: "unknown" }, { allowExternalWrites: true, unknownGrant: true }), { code: "INVALID_ARGUMENT" });
  await assert.rejects(tool("Write", { path: external, content: "bad-type" }, { allowExternalWrites: "true" }), { code: "INVALID_ARGUMENT" });
  const written = await tool("Write", { path: external, content: "authorized\n" }, { allowExternalWrites: true });
  assert.equal(written.ok, true, JSON.stringify(written));
  const beforeEdit = await tool("Read", { path: external });
  const edited = await tool("Edit", { path: external, tag: beforeEdit.content.tag, ops: "PUT 1.=1:\n+edited" }, { allowExternalWrites: true });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  const { shell } = await owner.request("workspace/toolShell", {});
  const bash = await tool("Bash", { command: `printf shell-authorized > ${q(marker)}` }, {
    allowExternalWrites: true, expectedCommandShellId: shell.id, expectedCommandShellDialect: shell.dialect,
  });
  assert.equal(bash.ok, true, JSON.stringify(bash));
  assert.equal(await exec(`cat ${q(marker)}`), "shell-authorized");
  assert.equal((await exec(`cat ${q(external)}`)).trim(), "edited");
  await owner.close();
  owner = client(url, paired.deviceToken);
  const reconnected = await owner.connect();
  assert.equal(reconnected.server.hostId, output.ready.hostId);
  assert.equal((await tool("Read", { path: external })).ok, true);
  report = { result: "PASS", version: APP_VERSION, target, archiveSha256: digest,
    source: urls.tarball, mode: artifactPath ? "verified SSH upload" : "release HTTPS download",
    checks: ["bootstrap", "version", "pairing", "tunnel", "external Read", "absent/false/forged grants denied",
      "strict schema", "owner Write/Edit/Bash", "reconnect", "isolated cleanup"] };
} finally {
  await owner?.close(); await pairing?.close(); await forward?.close();
  if (home) {
    await exec(`set -eu; base=${q(home)}; pidfile="$base/.pi-desktop/pi-host/.bootstrap/pi-host.pid";
      if [ -f "$pidfile" ]; then
        pid=$(cat "$pidfile");
        case "$(ps -p "$pid" -o command= || true)" in
          *"$base/"*pi-host.js*)
            kill "$pid"; waited=0;
            while kill -0 "$pid" 2>/dev/null; do
              case "$(ps -p "$pid" -o stat= || true)" in *Z*) break;; esac;
              [ "$waited" -lt 100 ] || exit 1;
              sleep 0.1; waited=$((waited + 1));
            done;;
        esac;
      fi;
      rm -rf -- "$base"`);
  }
  transport.dispose();
}
console.log(JSON.stringify(report, null, 2));
