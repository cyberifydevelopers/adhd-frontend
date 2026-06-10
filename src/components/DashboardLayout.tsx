import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Brain, ChevronDown, ChevronRight, LogOut, Settings, User } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import {
  DropdownMenu,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownDivider,
} from "@/components/ui/DropdownMenu";
import { useIsInsideSidebar } from "@/components/sidebar/SidebarLayout";
import { cn } from "@/lib/utils";

type Breadcrumb = { label: string; href?: string };

type DashboardLayoutProps = {
  title: string;
  children: ReactNode;
  breadcrumbs?: Breadcrumb[];
};

type AppRole = "user" | "admin";

const ROLE_ROUTES = {
  user: {
    profile: "/user/profile",
    settings: "/user/settings",
  },
  admin: {
    profile: "/admin/profile",
    settings: "/admin/settings",
  },
} as const;

function hasBreadcrumbs(breadcrumbs?: Breadcrumb[]): breadcrumbs is Breadcrumb[] {
  return Boolean(breadcrumbs && breadcrumbs.length > 0);
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function BreadcrumbNav({ breadcrumbs }: { breadcrumbs: Breadcrumb[] }) {
  return (
    <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground animate-fade-in">
      {breadcrumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3" />}
          {crumb.href ? (
            <Link to={crumb.href} className="hover:text-foreground transition-colors">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function DashboardLayout({ title, children, breadcrumbs }: DashboardLayoutProps) {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.me);
  const logout = useAuthStore((s) => s.logout);
  const insideSidebar = useIsInsideSidebar();

  if (!me) return null;

  const routeKey: AppRole = me.role === "user" ? "user" : "admin";
  const profilePath = ROLE_ROUTES[routeKey].profile;
  const settingsPath = ROLE_ROUTES[routeKey].settings;
  const displayName = me.name || me.email;

  // Admin side: sidebar handles header/nav, so just render page content
  if (insideSidebar) {
    return (
      <div className="min-h-full bg-gradient-to-b from-muted/30 to-background">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {title}
            </h1>
          </div>
          {hasBreadcrumbs(breadcrumbs) && (
            <BreadcrumbNav breadcrumbs={breadcrumbs} />
          )}
          <div className="animate-fade-in">{children}</div>
        </div>
      </div>
    );
  }

  // User side: full header with dropdown menu
  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 shadow-sm">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 shadow-sm shadow-primary/10">
              <Brain className="h-4.5 w-4.5 text-primary" />
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {title}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <DropdownMenu>
              <DropdownTrigger>
                <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/80 px-3 py-1.5 transition-colors hover:bg-accent">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                      "bg-primary text-primary-foreground"
                    )}
                  >
                    {getInitials(displayName)}
                  </div>
                  <span className="hidden text-sm font-medium text-foreground sm:inline">
                    {displayName}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </DropdownTrigger>
              <DropdownContent>
                <DropdownItem icon={User} onClick={() => navigate(profilePath)}>
                  Profile
                </DropdownItem>
                <DropdownItem icon={Settings} onClick={() => navigate(settingsPath)}>
                  Settings
                </DropdownItem>
                <DropdownDivider />
                <DropdownItem
                  icon={LogOut}
                  onClick={() => {
                    logout();
                    navigate("/login", { replace: true });
                  }}
                >
                  Sign out
                </DropdownItem>
              </DropdownContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="h-0.5 bg-gradient-to-r from-primary/60 via-accent/40 to-primary/60" />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {hasBreadcrumbs(breadcrumbs) && (
          <BreadcrumbNav breadcrumbs={breadcrumbs} />
        )}
        <div className="animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
