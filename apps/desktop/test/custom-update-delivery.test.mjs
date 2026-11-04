import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
register(new URL("./helpers/updater-module-stubs.mjs", import.meta.url));
const { AppUpdaterController, RELEASES_URL, AUTO_CHECK_TIMEOUT_MS, MANUAL_CHECK_TIMEOUT_MS } = await import("../electron/main/updater.ts");

class FeedUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  allowDowngrade = false;
  logger = null;
  feed = null;
  downloads = 0;
  installs = 0;
  failure = null;
  emitFailure = true;
  set channel(value) { this.selectedChannel = value; this.allowDowngrade = true; }
  get channel() { return this.selectedChannel; }
  setFeedURL(feed) { this.feed = feed; }
  async checkForUpdates() {
    this.emit("checking-for-update");
    if (this.failure) {
      if (this.emitFailure) this.emit("error", this.failure);
      throw this.failure;
    }
    const updateInfo = { version: "0.21.0-local.3", files: [], path: "", sha512: "", releaseDate: "2026-11-03" };
    this.emit("update-available", updateInfo);
    if (this.autoDownload) this.downloads++;
    return { updateInfo };
  }
  async downloadUpdate() { this.downloads++; throw this.failure; }
  quitAndInstall() { this.installs++; }
}

function setup({ platform = "darwin", locale = "en", settings = {} } = {}) {
  const updater = new FeedUpdater();
  const logs = [];
  const sent = [];
  const controller = new AppUpdaterController({
    logger: { app: (...args) => logs.push(args) },
    send: (...args) => sent.push(args),
    getLocale: () => locale,
    currentVersion: "0.21.0-local.2",
    platform, isPackaged: true, autoUpdater: updater,
    readUpdateSettings: async () => settings,
  });
  return { controller, updater, logs, sent };
}

const privateDetail = "HTTP 404\nSet-Cookie: synthetic-private-cookie\nAuthorization: Bearer synthetic-private-token\nhttps://user:password@example.test/?token=synthetic-query";

test("macOS check -> available -> custom releases stays manual despite restored automatic", async () => {
  const { controller, updater, sent } = setup({ settings: { updatePreference: "automatic" } });
  try {
    const state = await controller.check({ manual: true });
    assert.equal(state.mode, "manual");
    assert.equal(state.automaticSupported, false);
    assert.equal(state.preference, "manual");
    assert.equal(state.status, "available");
    assert.equal(state.availableVersion, "0.21.0-local.3");
    assert.equal(updater.downloads, 0);
    assert.equal(updater.autoInstallOnAppQuit, false);
    controller.setPreference("automatic");
    assert.equal(controller.getState().mode, "manual");
    await assert.rejects(controller.download(), /supported/);
    assert.throws(() => controller.install(), /try again/);
    await controller.openReleases();
    assert.equal(RELEASES_URL, "https://github.com/Coder42Y/pi-desktop-local-access/releases");
    assert.equal(sent.at(-1)[1].releasesUrl, RELEASES_URL);
    assert.equal(updater.installs, 0);
  } finally { controller.dispose(); }
});

test("discovery pins the anonymous custom local channel and explicitly forbids downgrade", () => {
  const { controller, updater } = setup();
  try {
    assert.equal(updater.feed.provider, "custom");
    assert.equal(updater.feed.updateProvider.name, "LocalUpdateProvider");
    assert.equal(updater.channel, "local");
    assert.equal(updater.allowPrerelease, true);
    assert.equal(updater.allowDowngrade, false);
  } finally { controller.dispose(); }
});

for (const emitFailure of [true, false]) {
  test(`manual failure is sanitized across IPC/state/logs and retry succeeds (event=${emitFailure})`, async () => {
    const { controller, updater, logs, sent } = setup({ locale: "zh-CN" });
    try {
      updater.failure = new Error(privateDetail);
      updater.emitFailure = emitFailure;
      let rejected;
      try { await controller.check({ manual: true }); } catch (error) { rejected = error; }
      assert.ok(rejected instanceof Error);
      assert.equal(controller.getState().status, "error");
      assert.match(controller.getState().error, /请重试/);
      const exposed = JSON.stringify({ logs, sent, state: controller.getState(), error: String(rejected) });
      assert.doesNotMatch(exposed, /synthetic-|Set-Cookie|Authorization|example\.test|password/);
      updater.failure = null;
      const state = await controller.check({ manual: true });
      assert.equal(state.status, "available");
      assert.equal(state.error, undefined);
    } finally { controller.dispose(); }
  });
}

test("all third-party diagnostic levels drop arbitrary transport content", () => {
  const { controller, updater, logs } = setup();
  try {
    for (const level of ["info", "warn", "error", "debug"]) updater.logger[level](privateDetail);
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-|Set-Cookie|Authorization|example\.test|password/);
    assert.ok(logs.length >= 4);
  } finally { controller.dispose(); }
});

test("download rejection is sanitized on supported targets", async () => {
  const { controller, updater, logs } = setup({ platform: "win32", settings: { updatePreference: "automatic" } });
  try {
    updater.failure = new Error(privateDetail);
    await assert.rejects(controller.download(), (error) => !String(error).includes("synthetic-") && error.message.includes("try again"));
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-/);
  } finally { controller.dispose(); }
});

for (const manual of [true, false]) {
  test(`timeout exits checking without exposing transport data (manual=${manual})`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { controller, updater } = setup();
    let started;
    const checkStarted = new Promise((resolve) => { started = resolve; });
    updater.checkForUpdates = () => {
      updater.emit("checking-for-update");
      started();
      return new Promise(() => {});
    };
    try {
      const pending = controller.check({ manual });
      const result = manual
        ? assert.rejects(pending, /Please try again/)
        : pending;
      await checkStarted;
      t.mock.timers.tick(manual ? MANUAL_CHECK_TIMEOUT_MS : AUTO_CHECK_TIMEOUT_MS);
      await result;
      assert.equal(controller.getState().status, manual ? "error" : "idle");
      if (!manual) assert.equal(controller.getState().error, undefined);
    } finally { controller.dispose(); }
  });
}

test("release-page OS errors are sanitized and localized", async () => {
  const { shell } = await import("./helpers/updater-electron-stub.mjs");
  const { controller, logs } = setup({ locale: "zh-CN" });
  shell.failure = new Error(privateDetail);
  try {
    await assert.rejects(controller.openReleases(), /请重试/);
    assert.equal(shell.opened.at(-1), RELEASES_URL);
    assert.doesNotMatch(JSON.stringify(logs), /synthetic-|Set-Cookie/);
  } finally { shell.failure = null; controller.dispose(); }
});
