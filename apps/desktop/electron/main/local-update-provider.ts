import type { AppUpdater } from "electron-updater";
import { GitHubProvider } from "electron-updater/out/providers/GitHubProvider.js";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import { CUSTOM_UPDATE_FEED } from "./custom-update";

/** GitHub's transport with a strict local-only channel and tag/manifest binding. */
export class LocalUpdateProvider extends GitHubProvider {
  constructor(_options: unknown, updater: AppUpdater, runtime: ProviderRuntimeOptions) {
    super(CUSTOM_UPDATE_FEED, updater, runtime);
  }

  protected getDefaultChannelName(): string {
    // GitHubProvider retries its default channel on manifest errors. Keep even
    // that retry on local; never accept latest.yml from another channel.
    return this.getCustomChannelName(CUSTOM_UPDATE_FEED.channel);
  }

  async getLatestVersion(): Promise<Awaited<ReturnType<GitHubProvider["getLatestVersion"]>>> {
    const info = await super.getLatestVersion();
    if (
      !/^\d+\.\d+\.\d+-local\.(0|[1-9]\d*)$/.test(info.version) ||
      info.tag !== `v${info.version}`
    ) {
      throw Object.assign(new Error("Custom update tag/version mismatch"), {
        code: "ERR_UPDATER_INVALID_VERSION",
      });
    }
    return info;
  }
}
