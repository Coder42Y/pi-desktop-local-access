import { describe, expect, it } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import * as Value from "typebox/value";
import { sessionToolDescriptions, sessionToolParameters } from "./session-tools.js";

const valid = (name: string, args: unknown) => Value.Check(
  Type.Object(sessionToolParameters[name]!, { additionalProperties: false }), args,
);

describe("workspace session tool contracts", () => {
  it("offers discovery, bounded history, directed messages and bound reports", () => {
    expect(Object.keys(sessionToolParameters).sort()).toEqual([
      "SendMessage", "SessionList", "SessionRead", "SessionReport", "SessionSpawn",
    ]);
    expect(valid("SessionList", {})).toBe(true);
    expect(valid("SessionRead", { sessionId: "B", limit: 20, before: 42 })).toBe(true);
    expect(valid("SendMessage", { sessionId: "B", content: "Review the change" })).toBe(true);
    expect(valid("SessionSpawn", { task: "Check tests" })).toBe(true);
    expect(valid("SessionReport", { state: "waiting_input", content: "Which API?" })).toBe(true);
  });

  it("rejects forged source identities, unbounded reads and arbitrary report targets", () => {
    expect(valid("SendMessage", { sessionId: "B", content: "x", sourceSessionId: "A" })).toBe(false);
    expect(valid("SessionRead", { sessionId: "B", limit: 51 })).toBe(false);
    expect(valid("SessionRead", { sessionId: "B", before: -1 })).toBe(false);
    expect(valid("SessionReport", { state: "completed", content: "Done" })).toBe(false);
    expect(valid("SessionReport", { state: "phase_completed", content: "Done", sessionId: "C" })).toBe(false);
    expect(valid("SendMessage", { sessionId: "B", content: "x".repeat(64001) })).toBe(false);
  });

  it("explains workspace scope, data provenance and explicit completion subscriptions", () => {
    expect(sessionToolDescriptions.SessionRead).toMatch(/not.*authorization/i);
    expect(sessionToolDescriptions.SendMessage).toMatch(/explicitly/i);
    expect(sessionToolDescriptions.SendMessage).toMatch(/default.*false/i);
    expect(sessionToolDescriptions.SendMessage).toMatch(/queue/i);
    expect(sessionToolDescriptions.SessionReport).toMatch(/bound/i);
    expect(sessionToolDescriptions.SessionReport).toMatch(/not.*approval/i);
    expect(sessionToolDescriptions.SessionSpawn).toMatch(/user/i);
  });
});


it("accepts live current-title lookup without requiring a cached session ID", () => {
  expect(valid("SessionList", { name: "接口排查" })).toBe(true);
  expect(valid("SessionRead", { sessionName: "接口排查" })).toBe(true);
  expect(valid("SendMessage", { sessionName: "接口排查", content: "Review" })).toBe(true);
  expect(valid("SessionList", { name: "" })).toBe(false);
  expect(valid("SessionRead", { sessionName: "x".repeat(81) })).toBe(false);
  expect(sessionToolDescriptions.SessionList).toMatch(/current|latest/i);
  expect(sessionToolDescriptions.SendMessage).toMatch(/ambiguous|duplicate/i);
  expect(sessionToolDescriptions.SessionSpawn).toMatch(/not.*found|missing/i);
});
