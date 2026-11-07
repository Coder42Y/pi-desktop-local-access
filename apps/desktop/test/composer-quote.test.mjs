import assert from "node:assert/strict";
import test from "node:test";
import { locateInlinePromptPaths } from "@pi-desktop/shared";
import { quotePrompt } from "../src/features/chat/composer/quote-prompt.ts";

test("every excerpt line is quoted, including blanks and slash commands", () => {
  assert.equal(
    quotePrompt("Which step is required?", ["first line\r\n\r\n/compact", "another excerpt"]),
    "Which step is required?\n\n> first line\n>\n> /compact\n\n> another excerpt",
  );
});

test("quote-only submissions are valid and ordinary requests keep their text", () => {
  assert.equal(quotePrompt("", ["excerpt"]), "> excerpt");
  assert.equal(quotePrompt("ordinary request", []), "ordinary request");
});

test("a quoted draft's leading slash is literal text", () => {
  assert.equal(quotePrompt("/mcp:example explain", ["excerpt"]), "\\/mcp:example explain\n\n> excerpt");
});

test("an inline attachment belongs to the request even if the quote names its path", () => {
  const request = "Explain @diagram.png please";
  const content = quotePrompt(request, ["Is this @diagram.png?"]);
  assert.deepEqual(locateInlinePromptPaths(content, ["diagram.png"]), [{ start: 8, end: 20 }]);
});
