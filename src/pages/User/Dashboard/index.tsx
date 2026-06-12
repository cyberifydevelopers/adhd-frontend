import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Play,
  CheckCircle2,
  Clock,
  CircleDashed,
  Pill,
  Lock,
  LayoutGrid,
  ClipboardList,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DashboardLiveAdaptiveHud } from "@/components/DashboardLiveAdaptiveHud";
import { getTaskPath, getTaskDisplayName } from "@/config/tasks";
import { resolveActiveBatteryId } from "@/lib/assignmentBattery";
import { useMyAssignments } from "@/hooks/useMyAssignments";
import type { Assignment } from "@/services/usersMeService";

const LOGIN_PATH = "/login";

type DashboardTab = "assessments" | "upcoming" | "battery";

const statusStyles: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  pending: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  upcoming: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
};

const statusBorders: Record<string, string> = {
  completed: "border-l-emerald-500",
  in_progress: "border-l-amber-500",
  pending: "border-l-slate-400 dark:border-l-slate-600",
  upcoming: "border-l-indigo-500",
};

const statusIcons: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2,
  in_progress: Clock,
  pending: CircleDashed,
  upcoming: Clock,
};

function normalizeStatus(status: string): string {
  return status === "in_progress" ? "pending" : status;
}

function buildAssignmentKey(assignment: Assignment, index: number): string {
  return assignment.assignment_id ?? `${assignment.test_name}-${index}`;
}

function getAssignmentStatusMeta(status: string) {
  const normalizedStatus = normalizeStatus(status);
  return {
    normalizedStatus,
    canStart: normalizedStatus === "pending",
    StatusIcon: statusIcons[normalizedStatus] ?? CircleDashed,
    statusBadgeClassName: statusStyles[normalizedStatus] ?? statusStyles.pending,
    statusBorderClassName: statusBorders[normalizedStatus] ?? statusBorders.pending,
  };
}

function tabButtonClass(active: boolean): string {
  return `inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? "border-primary/50 bg-primary/10 text-primary shadow-sm"
      : "border-border bg-card text-foreground hover:bg-muted"
  }`;
}

export default function UserDashboard() {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.me);
  const { assignments, serverActiveBatteryId } = useMyAssignments(!!me && me.role === "user");
  const [activeTab, setActiveTab] = useState<DashboardTab>("assessments");

  useEffect(() => {
    if (me && me.role !== "user") {
      navigate(LOGIN_PATH, { replace: true });
    }
  }, [me?.role, navigate]);

  if (!me) return null;

  const sortedAssignments = [...assignments].sort((a, b) => a.test_order - b.test_order);
  const upcomingAssignments = sortedAssignments.filter((a) => a.status === "upcoming");

  const activeBatteryId = resolveActiveBatteryId(sortedAssignments, serverActiveBatteryId);

  const visibleAssignments = activeBatteryId
    ? sortedAssignments.filter((a) => a.battery_id === activeBatteryId)
    : [];
  const activeBatteryTitle =
    visibleAssignments.find((a) => a.battery_id === activeBatteryId)?.battery_title
    ?? "No Active Battery";
  const completedCount = visibleAssignments.filter((a) => a.status === "completed").length;
  const upcomingCount = upcomingAssignments.length;
  const totalCount = visibleAssignments.length;
  const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const allActiveBatteryDone =
    totalCount > 0 && completedCount === totalCount && upcomingCount === 0;
  const hasAssignmentsButNothingVisible =
    sortedAssignments.length > 0 && visibleAssignments.length === 0;

  return (
    <DashboardLayout title="My Assessments">
      <DashboardLiveAdaptiveHud />

      {totalCount > 0 && (
        <div className="mb-6 animate-fade-in">
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">Progress</span>
            <span className="text-muted-foreground">{completedCount} of {totalCount} completed</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          to="/user/results"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <BarChart3 className="h-4 w-4" />
          My Results
        </Link>
        <Link
          to="/user/medication"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Pill className="h-4 w-4" />
          Medication
        </Link>
        <Link
          to="/user/intake"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <ClipboardList className="h-4 w-4" />
          Health information
        </Link>
        <button
          type="button"
          onClick={() => setActiveTab("upcoming")}
          className={tabButtonClass(activeTab === "upcoming")}
        >
          <Lock className="h-4 w-4" />
          Upcoming Tasks ({upcomingCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("battery")}
          className={tabButtonClass(activeTab === "battery")}
        >
          <Clock className="h-4 w-4" />
          Active Battery: {activeBatteryTitle}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("assessments")}
          className={tabButtonClass(activeTab === "assessments")}
        >
          <LayoutGrid className="h-4 w-4" />
          Assigned Tests
        </button>
      </div>

      <div className="space-y-6">
        {activeTab === "upcoming" && (
          <section className="animate-fade-in">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Upcoming tasks
            </h2>
            {upcomingAssignments.length === 0 ? (
              <div className="rounded-xl border border-border/60 bg-muted/20 px-6 py-12 text-center">
                <Lock className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="font-medium text-foreground">No upcoming tasks</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Future batteries assigned by your clinician will appear here before they become active.
                </p>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {upcomingAssignments.map((assignment, index) => (
                  <li
                    key={buildAssignmentKey(assignment, index)}
                    className="flex items-center justify-between rounded-xl border border-indigo-300/40 border-l-4 border-l-indigo-500 bg-card p-4 shadow-sm"
                  >
                    <span className="font-medium">{getTaskDisplayName(assignment.test_name)}</span>
                    <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-400">
                      Upcoming
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {activeTab === "battery" && (
          <section className="animate-fade-in space-y-4">
            <div className="rounded-xl border border-amber-300/40 bg-amber-500/5 p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-foreground">{activeBatteryTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">Your current active assessment battery.</p>
              {totalCount > 0 ? (
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Completed</dt>
                    <dd className="text-xl font-semibold text-emerald-600">{completedCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Remaining</dt>
                    <dd className="text-xl font-semibold">{Math.max(0, totalCount - completedCount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Total tasks</dt>
                    <dd className="text-xl font-semibold">{totalCount}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">No tasks in this battery yet.</p>
              )}
              {allActiveBatteryDone && (
                <p className="mt-4 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  All tasks in this battery are complete.
                </p>
              )}
            </div>
          </section>
        )}

        {activeTab === "assessments" && (
          <section className="animate-fade-in">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Assigned tests
            </h2>
            {sortedAssignments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-12 text-center">
                <CircleDashed className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="text-lg font-medium text-muted-foreground">No tests assigned yet</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Contact your administrator to get started.
                </p>
              </div>
            ) : hasAssignmentsButNothingVisible ? (
              <div className="flex min-h-[min(50vh,24rem)] flex-col items-center justify-center rounded-xl border border-border bg-muted/20 px-6 py-16 text-center">
                <CheckCircle2 className="mb-4 h-12 w-12 text-muted-foreground/70" />
                <p className="text-xl font-semibold text-foreground">No new tasks available</p>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  There are no tasks to show for your active battery right now. If you have already
                  completed your assessments, you are all set until more are assigned.
                </p>
              </div>
            ) : (
              <>
                {allActiveBatteryDone && (
                  <div className="mb-6 flex min-h-[min(36vh,14rem)] flex-col items-center justify-center rounded-xl border-2 border-emerald-500/25 bg-emerald-500/[0.06] px-6 py-10 text-center">
                    <CheckCircle2 className="mb-4 h-12 w-12 text-emerald-600 dark:text-emerald-400" />
                    <p className="text-xl font-semibold text-foreground">No new tasks available</p>
                    <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                      You have completed every test in this battery, and nothing else is scheduled for
                      you yet. Check back later or contact your administrator if you expect more
                      assessments.
                    </p>
                  </div>
                )}
                <p className="mb-3 text-xs text-muted-foreground">
                  Tasks selected in Assign Tests are shown here immediately in order.
                </p>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleAssignments.map((assignment, index) => {
                    const taskPath = getTaskPath(assignment.test_name);
                    const key = buildAssignmentKey(assignment, index);
                    const {
                      normalizedStatus,
                      canStart,
                      StatusIcon,
                      statusBadgeClassName,
                      statusBorderClassName,
                    } = getAssignmentStatusMeta(assignment.status);

                    return (
                      <li
                        key={key}
                        className={`flex flex-col justify-between gap-3 rounded-xl border border-border/60 border-l-4 ${statusBorderClassName} bg-card p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 sm:flex-row sm:items-center animate-fade-in-up`}
                      >
                        <span className="font-medium text-foreground">
                          {getTaskDisplayName(assignment.test_name)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClassName}`}>
                            <StatusIcon className="h-3 w-3" />
                            {normalizedStatus === "upcoming" ? "Upcoming task" : normalizedStatus}
                          </span>
                          {canStart && taskPath && (
                            <Link
                              to={taskPath}
                              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-all duration-200 hover:shadow-md hover:shadow-primary/30 hover:-translate-y-0.5"
                            >
                              <Play className="h-3 w-3" />
                              Start
                            </Link>
                          )}
                          {canStart && !taskPath && (
                            <span className="text-xs text-muted-foreground">Coming soon</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
