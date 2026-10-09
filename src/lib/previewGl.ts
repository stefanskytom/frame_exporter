/**
 * Cap concurrent WebGL contexts used by animation previews.
 * WKWebView / Safari typically allow only ~8–16 contexts process-wide;
 * measureJobFrameSize and export also consume contexts.
 */
const MAX_PREVIEW_GL = 4;

let active = 0;
const waitQueue: Array<() => void> = [];

export async function acquirePreviewGlSlot(): Promise<() => void> {
  if (active >= MAX_PREVIEW_GL) {
    await new Promise<void>((resolve) => {
      waitQueue.push(resolve);
    });
  }
  active += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active = Math.max(0, active - 1);
    const next = waitQueue.shift();
    next?.();
  };
}

export const PREVIEW_SIZE = 168;
