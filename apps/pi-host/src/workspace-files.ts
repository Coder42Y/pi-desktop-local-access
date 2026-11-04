import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, parse } from "node:path";
import { RacpError } from "@pi-desktop/agent-host";
import { loadProjectInstructions } from "@pi-desktop/agent-runtime";
import { collectWorkspaceDiff, getWorkspaceFileIndex, isChatRefOutsideRoots, listDir, readOpenableFile, readOpenableImage, resolveChatFileRef } from "@pi-desktop/host-runtime";
import type { RacpHostOperations } from "@pi-desktop/racp";

/** Owner UI previews may name external absolute files; project discovery stays contained. */
export function createWorkspaceFiles(): NonNullable<RacpHostOperations["workspaceFiles"]> {
  return { async read(input) {
    if (!isAbsolute(input.path) || /[\u0000-\u001f]/.test(input.path)) throw new RacpError("INVALID_ARGUMENT", "invalid workspace root");
    const root = await realpath(input.path).catch(() => undefined);
    if (!root || !(await stat(root)).isDirectory()) throw new RacpError("REMOTE_PATH_NOT_FOUND", "workspace directory is unavailable");
    const ref = input.ref ?? "";
    // Extra containment is for explicit file viewing only, never relative paths,
    // project enumeration, instructions, plugins or the model's tool runner.
    const previewRoots = isAbsolute(ref) ? [parse(ref).root] : [];
    try {
      switch (input.operation) {
        case "list": return { entries: await listDir(root, ref) };
        case "read": {
          // Distinguish a missing absolute target from a rejected relative path.
          if (isAbsolute(ref)) await realpath(ref);
          return await readOpenableFile(ref, root, previewRoots, input.mimeType);
        }
        case "image": return await readOpenableImage(ref, root, previewRoots, input.mimeType);
        case "index": return await getWorkspaceFileIndex(root);
        case "diff": return await collectWorkspaceDiff(root);
        case "instructions": return (await loadProjectInstructions(root)) ?? { entries: [] };
        case "resolve": {
          const roots = {
            project: [{ path: root, name: basename(root), primary: true }],
            containment: [{ kind: "workspace" as const, path: parse(root).root }],
          };
          if (await isChatRefOutsideRoots(ref, roots)) return { match: null, reason: "outside-allowed-roots" };
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
