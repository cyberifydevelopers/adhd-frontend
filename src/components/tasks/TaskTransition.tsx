import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/authStore";
import { getTaskDisplayName, getTaskPath } from "@/config/tasks";
import { findNextPendingTaskInActiveBattery } from "@/lib/assignmentBattery";
import { useMyAssignments } from "@/hooks/useMyAssignments";

type Props = {
  completedTask: string;
  nextTask?: string | null;
};

function isRunnableAssignmentStatus(status?: string): boolean {
  const normalizedStatus = (status || "").toLowerCase();
  return normalizedStatus === "pending" || normalizedStatus === "in_progress";
}

export function TaskTransition({ completedTask, nextTask }: Props) {
  const navigate = useNavigate();
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const { assignments, serverActiveBatteryId } = useMyAssignments();

  const resolvedNextTask = useMemo(() => {
    if (!nextTask) return null;
    const suggested = assignments.find((a) => a.test_name === nextTask);
    if (suggested && isRunnableAssignmentStatus(suggested.status)) {
      return nextTask;
    }
    return null;
  }, [assignments, nextTask]);

  const fallbackNextTask = useMemo(() => {
    const name = findNextPendingTaskInActiveBattery(assignments, serverActiveBatteryId);
    return name && getTaskPath(name) ? name : null;
  }, [assignments, serverActiveBatteryId]);

  /** Prefer CAT `next_task` when valid; otherwise next pending task in the active battery. */
  const effectiveNextTask = resolvedNextTask ?? fallbackNextTask;

  const handleNext = () => {
    if (!effectiveNextTask) return;
    const path = getTaskPath(effectiveNextTask);
    if (!path) return;
    navigate(path);
  };

  const handleDashboard = async () => {
    await fetchMe();
    navigate("/user");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm animate-fade-in">
      <h2 className="text-xl font-semibold text-foreground">
        {getTaskDisplayName(completedTask)} complete
      </h2>
      <p className="text-muted-foreground">
        Thank you. Your results have been saved.
      </p>
      {effectiveNextTask && (
        <p className="text-sm text-muted-foreground">
          Your next assessment is{" "}
          <span className="font-medium text-foreground">
            {getTaskDisplayName(effectiveNextTask)}
          </span>
          .
        </p>
      )}
      <div className="flex flex-wrap gap-3 pt-2">
        {effectiveNextTask && (
          <Button variant="primary" size="md" onClick={handleNext}>
            <span className="inline-flex items-center gap-2">
              Next task
              <ArrowRight className="h-4 w-4" />
            </span>
          </Button>
        )}
        <Button variant="outline" size="md" onClick={handleDashboard}>
          <span className="inline-flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4" />
            Back to dashboard
          </span>
        </Button>
      </div>
    </div>
  );
}
