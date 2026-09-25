"use client";

import { useEffect } from "react";

/**
 * Runs `load` now and every `intervalMs` while the page is visible. Each run aborts the
 * previous one; hiding the page, a new `load` (e.g. another selection), disabling or
 * unmounting stops the timer and cancels the request in flight.
 */
export function useVisiblePolling(
  load: (signal: AbortSignal) => Promise<void>,
  intervalMs = 15_000,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | null = null;
    let timer: number | null = null;
    const stop = (): void => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      controller?.abort();
      controller = null;
    };
    const run = (): void => {
      controller?.abort();
      controller = new AbortController();
      void load(controller.signal).catch(() => undefined);
    };
    const start = (): void => {
      stop();
      if (document.visibilityState !== "visible") return;
      run();
      timer = window.setInterval(run, intervalMs);
    };
    const onVisibility = (): void =>
      document.visibilityState === "visible" ? start() : stop();
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [load, intervalMs, enabled]);
}
