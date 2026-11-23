import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, parse } from "node:path";
import { RacpError } from "@pi-desktop/agent-host";
import { loadProjectInstructions } from "@pi-desktop/agent-runtime";
import { collectWorkspaceDiff, getWorkspaceFileIndex, isChatRefOutsideRoots, listDir, readOpenableFile, readOpenableImage, resolveChatFileRef, resolveExternalChatRef } from "@pi-desktop/host-runtime";
import type { RacpHostOperations } from "@pi-desktop/racp";

/** Owner previews may name an explicit absolute file; project discovery stays contained. */
export function createWorkspaceFiles(): NonNullable<RacpHostOperations["workspaceFiles"]> {
  return { async read(input) {
    if (!isAbsolute(input.path) || /[\u0000-\u001f]/.test(input.path)) throw new RacpError("INVALID_ARGUMENT", "invalid workspace root");
    const root = await realpath(input.path).catch(() => undefined);
    if (!root || !(await stat(root)).isDirectory()) throw new RacpError("REMOTE_PATH_NOT_FOUND", "workspace directory is unavailable");
    const ref = input.ref ?? "";
    // The filesystem root is only a read root for an explicit absolute preview.
    // Relative paths, listing, search, instructions and tools stay in the project.
    const previewRoots = isAbsolute(ref) ? [parse(ref).root] : [];
    try {
      switch (input.operation) {
        case "list": return { entries: await listDir(root, ref) };
        case "read": {
          if (isAbsolute(ref)) await realpath(ref);
          return await readOpenableFile(ref, root, previewRoots, input.mimeType);
        }
        case "image": return await readOpenableImage(ref, root, previewRoots, input.mimeType);
        case "index": return await getWorkspaceFileIndex(root);
        case "diff": return await collectWorkspaceDiff(root);
        case "instructions": return (await loadProjectInstructions(root)) ?? { entries: [] };
        case "resolve": {
          const roots = { project: [{ path: root, name: basename(root), primary: true }] };
          if (await isChatRefOutsideRoots(ref, roots)) return await resolveExternalChatRef(ref);
          return { match: await resolveChatFileRef(ref, roots) };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/escapes workspace root|outside allowed roots|not openable/.test(message)) throw new RacpError("REMOTE_PATH_FORBIDDEN", message);
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") throw new RacpError("REMOTE_PATH_NOT_FOUND", "file is unavailable");
      if (code === "EACCES" || code === "EPERM") throw new RacpError("REMOTE_PATH_FORBIDDEN", "file access is denied");
      if (/not a file/.test(message)) throw new RacpError("INVALID_ARGUMENT", "not a regular file");
      throw error;
    }
  } };
}
