import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md",
  secondary: "bg-muted text-muted-foreground hover:bg-muted/80 hover:shadow-sm",
  outline: "border border-border bg-transparent text-foreground hover:bg-muted/50 hover:border-primary/40 hover:shadow-sm",
  ghost: "text-foreground hover:bg-muted/50",
  destructive: "bg-destructive text-destructive-foreground shadow-md shadow-destructive/20 hover:shadow-lg hover:shadow-destructive/30 hover:-translate-y-0.5 active:translate-y-0 active:shadow-md",
};

const sizes: Record<Size, string> = {
  sm: "rounded-md px-3 py-1.5 text-xs font-medium",
  md: "rounded-lg px-4 py-2 text-sm font-medium",
  lg: "rounded-lg px-6 py-3 font-medium",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn("transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed", variants[variant], sizes[size], className)}
      {...props}
    />
  )
);
Button.displayName = "Button";
