import type { ReactNode } from "react";

type Props = {
  /** Shown above the main slot; omit to keep the slot empty (alignment is preserved). */
  direction?: "forward" | "backward" | null;
  children: ReactNode;
};

/**
 * Shared frame for the digit, entry and feedback screens so the direction word and the
 * digit / entry box sit at the same position as the screens change.
 */
export function DigitSpanScreen({ direction, children }: Props) {
  return (
    <div className="flex h-[360px] flex-col items-center justify-center gap-6 px-4">
      <p className="flex h-8 items-center text-2xl font-semibold uppercase tracking-widest text-muted-foreground">
        {direction ?? ""}
      </p>
      <div className="flex h-20 w-full items-center justify-center">{children}</div>
      {/* Mirrors the direction row so the main slot stays vertically centred */}
      <div className="h-8" aria-hidden />
    </div>
  );
}
