#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CUSTOM_UPDATE_PREFLIGHT_ERROR =
  "Custom update release preflight failed. Check local-mac.yml, version, artifact names, sizes and SHA-512.";

const root = fileURLToPath(new URL("..", import.meta.url));
const desktopRequire = createRequire(join(root, "apps/desktop/package.json"));
const updaterRequire = createRequire(desktopRequire.resolve("electron-updater/package.json"));
const { load, JSON_SCHEMA } = updaterRequire("js-yaml");

export async function verifyCustomUpdateRelease(directory, expectedVersion) {
  if (!/^\d+\.\d+\.\d+-local\.(0|[1-9]\d*)$/.test(expectedVersion)) {
    throw new Error("Expected a semver X.Y.Z-local.N custom release version");
  }
  const base = await realpath(directory);
  const manifestPath = join(base, "local-mac.yml");
  if (!(await lstat(manifestPath)).isFile()) throw new Error("Manifest must be a regular file");
  const manifest = load(await readFile(manifestPath, "utf8"), { schema: JSON_SCHEMA });
  if (!manifest || manifest.version !== expectedVersion) throw new Error("Manifest version mismatch");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("Missing manifest files");
  const seen = new Set();
  for (const entry of manifest.files) {
    const name = entry?.url;
    if (typeof name !== "string" || basename(name) !== name || !/^[A-Za-z0-9.-]+$/.test(name)) {
      throw new Error("Unsafe artifact path");
    }
    const validNames = ["arm64", "x64"].flatMap((arch) => [
      `PI-Desktop-${expectedVersion}-${arch}-mac.zip`,
      `PI-Desktop-${expectedVersion}-${arch}.dmg`,
    ]);
    if (!validNames.includes(name) || seen.has(name)) throw new Error("Artifact name/version/architecture mismatch");
    seen.add(name);
    const file = join(base, name);
    const stat = await lstat(file);
    if (!stat.isFile() || dirname(await realpath(file)) !== base) throw new Error("Artifact must be a contained regular file");
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || stat.size !== entry.size) {
      throw new Error("Artifact size mismatch");
    }
    if (typeof entry.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(entry.sha512)) {
      throw new Error("Invalid artifact SHA-512");
    }
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest("base64") !== entry.sha512) throw new Error("Artifact checksum mismatch");
  }
  const primary = manifest.files.find((entry) => entry.url === manifest.path);
  if (!primary || !primary.url.endsWith(".zip") || manifest.sha512 !== primary.sha512) {
    throw new Error("Primary ZIP metadata mismatch");
  }
  return { version: expectedVersion, tag: `v${expectedVersion}`, assets: [...seen, "local-mac.yml"] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(await readFile(join(root, "apps/desktop/package.json"), "utf8"));
  try {
    const result = await verifyCustomUpdateRelease(
      process.argv[2] ?? join(root, "apps/desktop/release"),
      pkg.build.extraMetadata.version,
    );
    console.log(JSON.stringify(result, null, 2));
  } catch {
    // No raw parser/network/path errors in publish logs: YAML may be untrusted.
    console.error(CUSTOM_UPDATE_PREFLIGHT_ERROR);
    process.exitCode = 1;
  }
}
