"use client";

import { useEffect } from "react";
import { installReferenceReveals } from "./reveal";

// Wires the scroll entrances once the page is mounted. The hero entrance is
// pure CSS from the first paint, so it never waits for this script.
export function LandingMotion({ rootId }: { rootId: string }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    return installReferenceReveals(root);
  }, [rootId]);

  return null;
}
