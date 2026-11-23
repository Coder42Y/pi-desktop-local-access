import { catalogs, resolveLocale } from "@pi-desktop/i18n";

/** Fixed public source. Never accept credentials or a renderer-supplied feed. */
export const CUSTOM_UPDATE_FEED = {
  provider: "github",
  owner: "Coder42Y",
  repo: "pi-desktop-local-access",
  channel: "local",
  private: false,
} as const;

export const CUSTOM_RELEASES_URL =
  `https://github.com/${CUSTOM_UPDATE_FEED.owner}/${CUSTOM_UPDATE_FEED.repo}/releases`;

const diagnosticCodes = new Set([
  "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
  "ERR_UPDATER_INVALID_RELEASE_FEED",
  "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
  "ERR_UPDATER_INVALID_UPDATE_INFO",
  "ERR_UPDATER_INVALID_VERSION",
  "ERR_UPDATER_CHECKSUM_MISMATCH",
  "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
  "UPDATE_CHECK_TIMEOUT",
  "ENOTFOUND",
  "ECONNRESET",
  "ETIMEDOUT",
]);

/** Whitelist categories, not arbitrary error messages, headers, URLs or stacks. */
export function safeUpdateDiagnostic(error: unknown): string {
  if (typeof error !== "object" || error === null) return "UPDATE_FAILURE";
  const code = "code" in error ? error.code : undefined;
  return typeof code === "string" && diagnosticCodes.has(code)
    ? code
    : "UPDATE_FAILURE";
}

export function updateFailureMessage(locale?: string | null, action = false): string {
  const messages = catalogs[resolveLocale(locale)].updates;
  return action ? messages.actionFailed : messages.checkFailed;
}

export function updateGuardMessage(locale: string | null | undefined, guard: "disabled" | "unsupported"): string {
  const messages = catalogs[resolveLocale(locale)].updates;
  return guard === "disabled" ? messages.devDisabled : messages.automaticUnsupported;
}
