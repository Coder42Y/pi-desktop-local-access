/** Ignore explicitly quoted lines when resolving prompt actions, preserving source offsets. */
export function maskPromptQuoteLines(content: string): string {
  return content.replace(/^[ \t]*>[^\r\n]*/gm, (line) => " ".repeat(line.length));
}
