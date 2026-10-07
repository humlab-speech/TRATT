/**
 * Origin of the page embedding us in an iframe, or `undefined` when we are
 * top-level or the embedder cannot be determined (no `ancestorOrigins`, no
 * referrer).
 */
export function parentOrigin(): string | undefined {
  const ancestor = window.location.ancestorOrigins?.[0];
  if (ancestor && ancestor !== 'null') {
    return ancestor;
  }
  try {
    return document.referrer ? new URL(document.referrer).origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sends `message` to the embedding page, addressed to its origin only — never
 * `'*'`, which would hand transcripts to any page that frames this app.
 * Fails closed (logs, sends nothing) when the embedder is unknown.
 */
export function postToParent(message: unknown): boolean {
  const origin = parentOrigin();
  if (!origin || window.parent === window) {
    console.error('postToParent: embedding origin unknown, message not sent');
    return false;
  }
  window.parent.postMessage(message, origin);
  return true;
}
