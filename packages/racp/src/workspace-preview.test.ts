import { expect, it } from "vitest";
import { OWNER_TOKEN, VIEWER_TOKEN, harness } from "./test-harness.js";

it("serves session preview only to an owner and validates the request", async () => {
  const calls: unknown[] = [];
  const h = await harness({ operations: { workspace: { async list() { return { entries: [] }; },
    async read() { return { kind: "text", content: "project", size: 7 }; },
    async diff() { return { repo: false, clean: true, files: [] }; },
    async preview(input) { calls.push(input); return { kind: "text", content: "synthetic external preview", size: 26 }; },
  } } });
  const owner = await h.connect(OWNER_TOKEN); const viewer = await h.connect(VIEWER_TOKEN);
  const input = { sessionId: "s1", operation: "read", ref: "/outside/note.md" };
  try {
    expect(await owner.client.request("workspace/preview", input)).toMatchObject({ kind: "text", content: "synthetic external preview" });
    await expect(viewer.client.request("workspace/preview", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.client.request("workspace/preview", { ...input, operation: "write" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(owner.client.request("workspace/preview", { ...input, path: "/" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(calls).toEqual([input]);
    expect(await viewer.client.request("workspace/read", { sessionId: "s1", path: "README.md" })).toMatchObject({ kind: "text" });
  } finally { await owner.client.close(); await viewer.client.close(); h.server.close(); }
});

it("an unsupported Host rejects preview instead of falling back to project or local reads", async () => {
  const h = await harness(); const { client } = await h.connect(OWNER_TOKEN);
  try { await expect(client.request("workspace/preview", { sessionId: "s1", operation: "resolve", ref: "/outside/note.md" })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" }); }
  finally { await client.close(); h.server.close(); }
});
