import { useRef, useEffect, useState, useCallback } from "react";

type Props = {
  /** Exactly this many digits may be entered and submitted */
  digitCount: number;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  /** Fires when user attempts a non-digit key (validity / distraction signal) */
  onInvalidDigitAttempt?: () => void;
};

function sanitizeDigits(raw: string, maxLen: number): string {
  return raw.replace(/\D/g, "").slice(0, maxLen);
}

const NAV_KEYS = new Set([
  "Backspace",
  "Delete",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "Tab",
]);

export function DigitSpanInput({ digitCount, onSubmit, disabled, onInvalidDigitAttempt }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue("");
  }, [digitCount]);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled, digitCount]);

  const flushSubmit = useCallback(
    (next: string) => {
      const safe = sanitizeDigits(next, digitCount);
      if (safe.length !== digitCount || digitCount < 1) return;
      onSubmit(safe);
      setValue("");
    },
    [digitCount, onSubmit],
  );

  const applyChange = useCallback(
    (raw: string) => {
      const safe = sanitizeDigits(raw, digitCount);
      setValue(safe);
      if (safe.length === digitCount) {
        flushSubmit(safe);
      }
    },
    [digitCount, flushSubmit],
  );

  /** Room for monospace + tracking-widest at text-xl so 6–8 digits stay fully visible */
  const widthRem = Math.max(12, 2 + digitCount * 2.35);

  return (
    <div className="mt-6 flex w-full max-w-[calc(100vw-2rem)] flex-col items-center gap-2 px-2">
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        maxLength={digitCount}
        value={value}
        aria-describedby="digit-span-input-hint"
        placeholder={`${digitCount} digit${digitCount === 1 ? "" : "s"}`}
        className="box-border rounded-lg border border-border bg-background px-4 py-3 text-center text-xl font-mono tracking-widest"
        style={{ width: `min(${widthRem}rem, calc(100vw - 2rem))` }}
        onChange={(e) => applyChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            flushSubmit(value);
            return;
          }
          if (NAV_KEYS.has(e.key)) return;
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          // One printable character: digits only at key level (paste still handled in onChange)
          if (e.key.length === 1) {
            if (!/^\d$/.test(e.key)) {
              e.preventDefault();
              onInvalidDigitAttempt?.();
              return;
            }
            const el = e.currentTarget;
            const start = el.selectionStart ?? value.length;
            const end = el.selectionEnd ?? value.length;
            if (start === end && value.length >= digitCount) {
              e.preventDefault();
            }
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const pasted = e.clipboardData.getData("text");
          const el = inputRef.current;
          if (!el) return;
          const start = el.selectionStart ?? value.length;
          const end = el.selectionEnd ?? value.length;
          const merged = `${value.slice(0, start)}${pasted}${value.slice(end)}`;
          applyChange(merged);
        }}
      />
      <p id="digit-span-input-hint" className="max-w-xs text-center text-xs text-muted-foreground">
        Numbers 0–9 only · Enter exactly {digitCount} digit{digitCount === 1 ? "" : "s"} · Submits when full
      </p>
    </div>
  );
}
