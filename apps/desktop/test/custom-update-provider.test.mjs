import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { CUSTOM_UPDATE_FEED } = await import("../electron/main/custom-update.ts");
const require = createRequire(new URL("../package.json", import.meta.url));
const { LocalUpdateProvider } = await import("../electron/main/local-update-provider.ts");
const updaterRequire = createRequire(require.resolve("electron-updater/package.json"));
const semver = updaterRequire("semver");
const prefix = "/Coder42Y/pi-desktop-local-access/releases";

function fixture(platform, version = "0.21.0-local.3", { failLocal = false, metadataVersion = version } = {}) {
  const requested = [];
  const filename = platform === "darwin" ? "local-mac.yml" : "local.yml";
  const metadata = JSON.stringify({ version: metadataVersion, files: [{ url: "synthetic.zip", sha512: "test" }], path: "synthetic.zip", sha512: "test" });
  const tags = ["local-v0.21.0-1", "v0.22.0", "v0.22.0-rc.1", `v${version}`, "v0.21.0-local.1"];
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${tags.map((tag) => `<entry><title>${tag}</title><link href="https://github.com${prefix}/tag/${tag}"/><content>Custom build</content></entry>`).join("")}</feed>`;
  const executor = { request: async (options) => {
    requested.push(options);
    assert.equal(options.hostname, "github.com");
    assert.equal(options.headers?.authorization, undefined);
    assert.equal(options.headers?.Authorization, undefined);
    if (options.path === `${prefix}.atom`) return atom;
    if (options.path === `${prefix}/download/v${version}/${filename}`) {
      if (failLocal) throw new Error("synthetic local metadata unavailable");
      return metadata;
    }
    if (options.path === `${prefix}/download/v${version}/latest-mac.yml`) return metadata;
    throw new Error("Unexpected external request");
  } };
  const updater = { currentVersion: semver.parse("0.21.0-local.2"), channel: "local", allowPrerelease: true };
  const provider = new LocalUpdateProvider({}, updater, { platform, executor });
  return { provider, requested, filename };
}

for (const platform of ["darwin", "win32"]) {
  test(`real ${platform} GitHub provider selects semver local release, ignores legacy/stable/RC, uses anonymous metadata`, async () => {
    const { provider, requested, filename } = fixture(platform);
    const info = await provider.getLatestVersion();
    assert.equal(info.version, "0.21.0-local.3");
    assert.equal(info.tag, "v0.21.0-local.3");
    assert.deepEqual(requested.map((r) => r.path), [`${prefix}.atom`, `${prefix}/download/v0.21.0-local.3/${filename}`]);
    const resolved = provider.resolveFiles(info);
    assert.equal(resolved[0].url.hostname, "github.com");
    assert.equal(resolved[0].url.pathname, `${prefix}/download/v0.21.0-local.3/synthetic.zip`);
  });
}

test("all packaging sources use the same anonymous feed and a valid custom embedded version", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(pkg.build.publish[0], CUSTOM_UPDATE_FEED);
  assert.ok(semver.valid(pkg.build.extraMetadata.version));
  assert.equal(semver.prerelease(pkg.build.extraMetadata.version)[0], "local");
  assert.ok(semver.gt(pkg.build.extraMetadata.version, "0.21.0-local.1"));
});

test("local metadata failure cannot silently fall back to latest metadata", async () => {
  const { provider, requested } = fixture("darwin", "0.21.0-local.3", { failLocal: true });
  await assert.rejects(provider.getLatestVersion());
  assert.ok(requested.every((request) => !request.path.includes("latest-mac.yml")));
});

test("selected local tag must match the manifest version exactly", async () => {
  const { provider } = fixture("darwin", "0.21.0-local.3", { metadataVersion: "0.22.0" });
  await assert.rejects(provider.getLatestVersion(), /version/);
});
