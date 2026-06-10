import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  ClipboardCheck,
  Activity,
  Pill,
  Settings2,
  Download,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { adminUsersStore } from "@/stores/adminUsersStore";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { adminExportService } from "@/services";

const ADMIN_ROLES = ["admin", "superadmin"];
const STAFF_ROLES = ["admin", "superadmin", "clinician"];
const LOGIN_PATH = "/login";
const USERS_PATH = "/admin/users";

const overviewCards = [
  {
    label: "Assignments",
    getValue: (stats: ReturnType<typeof adminUsersStore.getState>["statsData"]) =>
      stats ? `${stats.completed_assignments}/${stats.total_assignments}` : "—",
    description: "Completed / total",
    icon: ClipboardCheck,
    colorClassName: "text-emerald-600 dark:text-emerald-400",
    backgroundClassName: "bg-emerald-500/10",
  },
  {
    label: "Sessions",
    getValue: (stats: ReturnType<typeof adminUsersStore.getState>["statsData"]) =>
      stats?.total_sessions ?? "—",
    description: "Assessment sessions",
    icon: Activity,
    colorClassName: "text-violet-600 dark:text-violet-400",
    backgroundClassName: "bg-violet-500/10",
  },
] as const;

const quickActionCards = [
  {
    to: "/admin/formulary",
    label: "Formulary",
    description: "Edit medication list",
    icon: Pill,
    colorClassName: "text-emerald-600 dark:text-emerald-400",
    backgroundClassName: "bg-emerald-500/10",
  },
  {
    to: "/admin/cat-config",
    label: "CAT Config",
    description: "LLM routing, anchors, thresholds",
    icon: Settings2,
    colorClassName: "text-amber-600 dark:text-amber-400",
    backgroundClassName: "bg-amber-500/10",
  },
] as const;

export default function AdminDashboard() {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.me);

  const stats = adminUsersStore((s) => s.statsData);
  const fetchStats = adminUsersStore((s) => s.fetchStats);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);
  const isAdmin = me ? ADMIN_ROLES.includes(me.role) : false;

  useEffect(() => {
    if (me && !STAFF_ROLES.includes(me.role)) {
      navigate(LOGIN_PATH, { replace: true });
    }
  }, [me?.role, navigate]);

  if (!me) return null;

  return (
    <DashboardLayout title="Admin Portal">
      <div className="space-y-8">
        {/* Overview */}
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Overview
        </h3>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Users card — clickable link to /admin/users */}
          <Link
            to={USERS_PATH}
            className="group rounded-xl border border-border/60 bg-card p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/30 animate-fade-in-up stagger-1"
          >
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 transition-transform duration-200 group-hover:scale-110">
                <Users className="h-4.5 w-4.5 text-blue-600 dark:text-blue-400" />
              </div>
              <p className="text-2xl font-bold text-foreground">{stats?.total_users ?? "—"}</p>
            </div>
            <p className="font-medium text-foreground">Users</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Manage participants</p>
          </Link>

          {overviewCards.map((card, i) => (
            <div
              key={card.label}
              className={`rounded-xl border border-border/60 bg-card p-5 shadow-sm transition-all duration-200 hover:shadow-md animate-fade-in-up stagger-${i + 2}`}
            >
              <div className="mb-3 flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.backgroundClassName}`}>
                  <card.icon className={`h-4.5 w-4.5 ${card.colorClassName}`} />
                </div>
                <p className="text-2xl font-bold text-foreground">{card.getValue(stats)}</p>
              </div>
              <p className="font-medium text-foreground">{card.label}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{card.description}</p>
            </div>
          ))}
        </div>

        {isAdmin && (
          <>
            {/* Quick Actions */}
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Quick Actions
            </h3>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {quickActionCards.map((card, i) => (
                <Link
                  key={card.to}
                  to={card.to}
                  className={`group rounded-xl border border-border/60 bg-card p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/30 animate-fade-in-up stagger-${i + 1}`}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.backgroundClassName} transition-transform duration-200 group-hover:scale-110`}>
                      <card.icon className={`h-4.5 w-4.5 ${card.colorClassName}`} />
                    </div>
                  </div>
                  <p className="font-medium text-foreground">{card.label}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{card.description}</p>
                </Link>
              ))}

              <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm animate-fade-in-up stagger-5">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-500/10">
                    <Download className="h-4.5 w-4.5 text-slate-600 dark:text-slate-400" />
                  </div>
                </div>
                <p className="font-medium text-foreground">De-identified export</p>
                <p className="mt-0.5 text-sm text-muted-foreground">No PII, session metrics only</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => adminExportService.downloadDeidentified("json")}>
                    JSON
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => adminExportService.downloadDeidentified("csv")}>
                    CSV
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
