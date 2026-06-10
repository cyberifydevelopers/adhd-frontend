import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── Context ── */
type DropdownCtx = { open: boolean; setOpen: (v: boolean) => void; triggerRef: React.RefObject<HTMLDivElement> };
const Ctx = createContext<DropdownCtx>({ open: false, setOpen: () => {}, triggerRef: { current: null } });

/* ── Root ── */
export function DropdownMenu({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <Ctx.Provider value={{ open, setOpen, triggerRef }}>
      <div ref={containerRef} className={cn("relative", className)}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

/* ── Trigger ── */
export function DropdownTrigger({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen, triggerRef } = useContext(Ctx);
  return (
    <div
      ref={triggerRef}
      role="button"
      tabIndex={0}
      className={cn("cursor-pointer select-none", className)}
      onClick={() => setOpen(!open)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); } }}
    >
      {children}
    </div>
  );
}

/* ── Content ── */
export function DropdownContent({ children, className, align = "end" }: { children: ReactNode; className?: string; align?: "start" | "end" }) {
  const { open } = useContext(Ctx);
  if (!open) return null;
  return (
    <div
      className={cn(
        "absolute top-full z-50 mt-2 min-w-[12rem] origin-top-right",
        "rounded-xl border border-border/60 bg-card p-1 shadow-xl shadow-black/10",
        "animate-fade-in",
        align === "end" ? "right-0" : "left-0",
        className
      )}
    >
      {children}
    </div>
  );
}

/* ── Item ── */
export function DropdownItem({
  children,
  className,
  onClick,
  icon: Icon,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const { setOpen } = useContext(Ctx);
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        "text-foreground hover:bg-accent hover:text-accent-foreground",
        className
      )}
      onClick={() => {
        onClick?.();
        setOpen(false);
      }}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

/* ── Divider ── */
export function DropdownDivider() {
  return <div className="my-1 h-px bg-border/60" />;
}
