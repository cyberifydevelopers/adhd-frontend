import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TaskTrialCardProps = {
  progress?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  contentClassName?: string;
};

export function TaskTrialCard({ progress, children, footer, contentClassName }: TaskTrialCardProps) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
      {progress}
      <div
        className={cn(
          "relative min-h-[320px] rounded-lg border border-border/60 bg-muted/10",
          contentClassName,
        )}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}
