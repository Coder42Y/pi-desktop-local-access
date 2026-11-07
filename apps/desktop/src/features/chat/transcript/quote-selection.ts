import { texClipboardPayload } from "../../../lib/selection-tex";

function replyBody(node: Node): Element | null {
  return (node instanceof Element ? node : node.parentElement)
    ?.closest(".assistant-turn-fragment > .prose-chat") ?? null;
}

/** Both endpoints must belong to the same rendered model reply fragment. */
export function selectedReplyExcerpt(turn: HTMLElement, target: EventTarget): string {
  const selection = turn.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode || selection.isCollapsed || !(target instanceof Node)) return "";
  const body = replyBody(selection.anchorNode);
  if (!body || !turn.contains(body) || body !== replyBody(selection.focusNode)) return "";
  if (!body.contains(target) || !selection.getRangeAt(0).intersectsNode(target)) return "";
  const excerpt = texClipboardPayload(selection) ?? selection.toString();
  return excerpt.trim() ? excerpt : "";
}
