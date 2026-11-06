import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { piHostArtifactUrls, versionsMatch } = await import("../electron/main/remote/pi-host-release.ts");
const root = new URL("../../../", import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const source = path => readFileSync(new URL(path, root), "utf8");
const version = json("apps/desktop/package.json").build.extraMetadata.version;

test("SSH downloads both Linux bundles and checksums from the fork at the full packaged version", () => {
  for (const arch of ["x64", "arm64"]) {
    const base = `https://github.com/Coder42Y/pi-desktop-local-access/releases/download/v${version}`;
    const name = `pi-host-${version}-linux-${arch}.tar.gz`;
    assert.deepEqual(piHostArtifactUrls(version, { platform: "linux", arch }), {
      tarball: `${base}/${name}`, checksum: `${base}/${name}.sha256`,
    });
  }
  assert.equal(versionsMatch("0.21.0", version), false);
  assert.equal(versionsMatch("0.21.0-local.2", version), false);
  assert.equal(versionsMatch(version, version), true);
});

test("desktop metadata, runtime protocol, pi-host and native Host share one fork release version", () => {
  assert.match(version, /^\d+\.\d+\.\d+-local\.\d+$/);
  for (const path of ["package.json", "apps/desktop/package.json", "apps/pi-host/package.json", "packages/shared/package.json"]) {
    assert.equal(json(path).version, version, path);
  }
  assert.equal(source("packages/shared/src/protocol.ts").match(/export const APP_VERSION = "([^"]+)"/)[1], version);
  assert.equal(source("Cargo.toml").match(/\[workspace.package\][\s\S]*?version = "([^"]+)"/)[1], version);
});
