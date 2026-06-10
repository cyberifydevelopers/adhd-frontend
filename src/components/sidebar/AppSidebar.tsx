import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Brain,
  LayoutDashboard,
  Users,
  Pill,
  Settings2,
  LogOut,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/formulary", label: "Formulary", icon: Pill },
  { to: "/admin/cat-config", label: "CAT Config", icon: Settings2 },
] as const;

const roleBadgeStyles: Record<string, string> = {
  superadmin: "bg-sidebar-primary/15 text-sidebar-primary",
  admin: "bg-info/15 text-info",
  clinician: "bg-success/15 text-success",
};

const LOGIN_PATH = "/login";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function AppSidebar({ onClose }: { onClose?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.me);
  const logout = useAuthStore((s) => s.logout);
  const displayName = me?.name || me?.email || "User";

  if (!me) return null;

  const isActive = (item: (typeof navItems)[number]) =>
    "exact" in item && item.exact
      ? location.pathname === item.to
      : location.pathname.startsWith(item.to);

  const badgeClassName = me.role ? roleBadgeStyles[me.role] : undefined;

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-sidebar-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sidebar-primary/20 to-sidebar-accent/20">
          <Brain className="h-4.5 w-4.5 text-sidebar-primary" />
        </div>
        <span className="text-base font-semibold tracking-tight">ADHD Platform</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="h-4.5 w-4.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-sidebar-border p-3 space-y-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold">
            {getInitials(displayName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium">{me.name || "User"}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">{me.email}</p>
          </div>
          {me.role && me.role !== "user" && badgeClassName && (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                badgeClassName
              )}
            >
              {me.role}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between px-2">
          <ThemeToggle dropUp />
          <button
            type="button"
            onClick={() => {
              logout();
              navigate(LOGIN_PATH, { replace: true });
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
