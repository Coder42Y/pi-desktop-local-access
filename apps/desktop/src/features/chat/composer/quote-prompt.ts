/** Keep quotes in the user message, marked separately from the editable request. */
export function quotePrompt(request: string, quotes?: readonly string[]): string {
  if (!quotes?.length) return request;
  const blocks = quotes.map((quote) => quote.replace(/\r\n?/g, "\n")
    .split("\n").map((line) => line ? `> ${line}` : ">").join("\n"));
  // Keep inline attachment markers in the request ahead of identical quoted text.
  // Escape the initial slash so a quoted draft remains a regular prompt.
  const literalRequest = request.startsWith("/") ? `\\${request}` : request;
  return [literalRequest, ...blocks].filter(Boolean).join("\n\n");
}
