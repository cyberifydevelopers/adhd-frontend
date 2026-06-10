import { useLayoutEffect } from "react";

/**
 * Task routes share global Zustand stores. Completing one battery leaves `phase: "complete"`;
 * re-opening the same task for another assignment still mounts the same route, so reset
 * synchronously before paint to avoid flashing the completion card or re-firing save effects.
 */
export function usePrepareTaskFreshRun(checkAndPrepare: () => void) {
  useLayoutEffect(() => {
    checkAndPrepare();
  }, []);
}
