import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, RefreshCw, Search, Trash2, X } from "lucide-react";
import { adminCatConfigService, adminUsersService } from "@/services";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/lib/toast";
import { getTaskDisplayName } from "@/config/tasks";

const AVAILABLE_TESTS = [
  "cpt",
  "sst",
  "digit_span",
  "time_estimation",
  "simple_rt",
  "choice_rt",
  "flanker",
  "task_switching",
  "delay_discounting",
  "psychomotor_speed",
  "set_shifting_mini",
  "wm_distraction",
  "substance_dd",
] as const;

type Props = {
  userId: string;
  userName: string;
  /** Participant mode — CAT Trial Bounds weights seed session weights; clinician can override per battery. */
  userMode?: string | null;
  onClose: () => void;
  onSuccess: () => void;
};

function normalizeTestName(testName: string): string {
  return testName.trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function clampSessionWeight(x: number): number {
  return Math.min(1, Math.max(0.1, x));
}

/** Map stored normalized shares (sum 1) to editable 0.1–1 session inputs */
function sharesToSessionInputs(sharesInOrder: number[]): number[] {
  if (sharesInOrder.length === 0) return [];
  const min = Math.min(...sharesInOrder);
  const max = Math.max(...sharesInOrder);
  if (max - min < 1e-9) return sharesInOrder.map(() => 1);
  return sharesInOrder.map((s) => clampSessionWeight(0.1 + 0.9 * (s - min) / (max - min)));
}

export function AssignTestsModal({ userId, userName, userMode = null, onClose, onSuccess }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<string[]>([]);
  const [batteryMode, setBatteryMode] = useState<"new" | "existing">("new");
  const [batteryTitle, setBatteryTitle] = useState("Battery");
  const [selectedBatteryId, setSelectedBatteryId] = useState("");
  const [availableBatteries, setAvailableBatteries] = useState<
    {
      battery_id: string;
      title: string;
      status: string;
      created_at: string;
      total_tests: number;
      completed_tests: number;
      pending_tests: number;
      items: { test_name: string; item_order: number; weight: number; status: string }[];
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [assignmentsById, setAssignmentsById] = useState<Record<string, { assignment_id: string; status: string }>>({});
  const [allAssignments, setAllAssignments] = useState<Awaited<ReturnType<typeof adminUsersService.getAssignments>>>([]);
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [activatingBattery, setActivatingBattery] = useState(false);
  const [deleteBatteryConfirm, setDeleteBatteryConfirm] = useState<string | null>(null);
  const [catTaskWeights, setCatTaskWeights] = useState<Record<string, number>>({});
  const [sessionWeights, setSessionWeights] = useState<Record<string, number>>({});
  const [testFilter, setTestFilter] = useState("");
  const sessionWeightCtxRef = useRef<string>("");
  /** When battery list/statuses change from server, keep the highlighted row aligned with `in_progress` (activate / refetch). */
  const batteryStatusSigRef = useRef("");

  const assignmentStatusForSelectedBattery = (testId: string): string | undefined => {
    const normalized = normalizeTestName(testId);
    if (selectedBatteryId) {
      return allAssignments.find(
        (a) =>
          a.battery_id === selectedBatteryId &&
          normalizeTestName(a.test_name) === normalized,
      )?.status;
    }
    return allAssignments.find(
      (a) => normalizeTestName(a.test_name) === normalized,
    )?.status;
  };

  const mapBatteries = (batteries: Awaited<ReturnType<typeof adminUsersService.getBatteries>>) =>
    batteries.map((b) => ({
      battery_id: b.battery_id,
      title: b.title,
      status: b.status,
      created_at: b.created_at,
      total_tests: b.total_tests ?? (b.items?.length ?? 0),
      completed_tests: b.completed_tests ?? (b.items ?? []).filter((it) => it.status === "completed").length,
      pending_tests:
        b.pending_tests ?? (b.items ?? []).filter((it) => it.status !== "completed").length,
      items: (b.items ?? []).map((it) => ({
        test_name: normalizeTestName(it.test_name),
        item_order: it.item_order,
        weight: it.weight,
        status: it.status,
      })),
    }));

  const activeBattery = availableBatteries.find((b) => b.status === "in_progress")
    ?? availableBatteries
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .find((b) => b.status !== "completed");

  useEffect(() => {
    const mode = (userMode && userMode.trim()) || "diagnosis_no_substance";
    adminCatConfigService
      .getConfig(mode)
      .then((c) => setCatTaskWeights(c.task_weights || {}))
      .catch(() => setCatTaskWeights({}));
  }, [userMode, userId]);

  useEffect(() => {
    Promise.all([
      adminUsersService.getAssignments(userId),
      adminUsersService.getBatteries(userId),
    ])
      .then(([assignments, batteries]) => {
        const ids = new Set(assignments.map((a) => normalizeTestName(a.test_name)));
        const ord =
          assignments.length > 0
            ? assignments.sort((a, b) => a.test_order - b.test_order).map((a) => normalizeTestName(a.test_name))
            : [];
        const byId: Record<string, { assignment_id: string; status: string }> = {};
        for (const a of assignments) {
          byId[normalizeTestName(a.test_name)] = { assignment_id: a.assignment_id, status: a.status };
        }
        setAvailableBatteries(mapBatteries(batteries));
        setAllAssignments(assignments);
        setAssignmentsById(byId);
        setSelected(ids);
        setOrder(ord);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Failed to load assignments");
        setLoading(false);
      });
  }, [userId]);

  useEffect(() => {
    if (batteryMode !== "existing" || !selectedBatteryId) return;
    const selectedBattery = availableBatteries.find((b) => b.battery_id === selectedBatteryId);
    if (!selectedBattery) return;
    const ordered = [...selectedBattery.items]
      .sort((a, b) => a.item_order - b.item_order)
      .map((it) => it.test_name);
    setSelected(new Set(ordered));
    setOrder(ordered);
  }, [batteryMode, selectedBatteryId, availableBatteries]);

  useEffect(() => {
    if (batteryMode !== "existing" || loading || availableBatteries.length === 0) return;
    const sig = availableBatteries
      .map((b) => `${b.battery_id}:${b.status}`)
      .sort()
      .join("|");
    if (sig === batteryStatusSigRef.current) return;
    batteryStatusSigRef.current = sig;
    const active = availableBatteries.find((b) => b.status === "in_progress");
    const oldestOpen = [...availableBatteries].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ).find((b) => b.status !== "completed");
    const pick = active ?? oldestOpen;
    if (pick) setSelectedBatteryId(pick.battery_id);
  }, [batteryMode, loading, availableBatteries]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setOrder((o) => o.filter((x) => x !== id));
      } else {
        next.add(id);
        setOrder((o) => (o.includes(id) ? o : [...o, id]));
      }
      return next;
    });
  };

  const moveInOrder = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= order.length) return;
    setOrder((prev) => {
      const arr = [...prev];
      const [removed] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, removed);
      return arr;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const orderedSelected = Array.from(new Set(order.filter((id) => selected.has(id))));
      const assignments = orderedSelected.map((id, i) => ({
        test: id,
        order: i + 1,
        weight: clampSessionWeight(sessionWeights[id] ?? catTaskWeights[id] ?? 1),
      }));
      if (batteryMode === "new") {
        await adminUsersService.createAssignments(userId, assignments, batteryTitle.trim() || "Battery");
      } else {
        await adminUsersService.updateAssignments(
          userId,
          assignments,
          undefined,
          selectedBatteryId || undefined,
        );
      }
      toast.success("Assignments updated");
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(", ")
            : err instanceof Error
              ? err.message
              : "Failed to save";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleActivateBattery = async (batteryId?: string) => {
    const targetBatteryId = batteryId || selectedBatteryId;
    if (!targetBatteryId) return;
    setActivatingBattery(true);
    try {
      await adminUsersService.activateBattery(userId, targetBatteryId);
      toast.success("Battery activated");
      const batteries = await adminUsersService.getBatteries(userId);
      setAvailableBatteries(mapBatteries(batteries));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to activate battery");
    } finally {
      setActivatingBattery(false);
    }
  };

  const handleDeleteBattery = async (batteryId: string) => {
    setSaving(true);
    try {
      await adminUsersService.deleteBattery(userId, batteryId);
      toast.success("Battery deleted");
      const batteries = await adminUsersService.getBatteries(userId);
      setAvailableBatteries(mapBatteries(batteries));
      if (selectedBatteryId === batteryId) {
        setSelectedBatteryId("");
      }
      setDeleteBatteryConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete battery");
    } finally {
      setSaving(false);
    }
  };

  const handleReassign = async (testName: string) => {
    const normalized = normalizeTestName(testName);
    const a = allAssignments.find(
      (x) =>
        normalizeTestName(x.test_name) === normalized
        && (selectedBatteryId ? x.battery_id === selectedBatteryId : true),
    ) ?? assignmentsById[normalized];
    if (!a) return;
    setSaving(true);
    try {
      await adminUsersService.reassignAssignment(userId, a.assignment_id);
      toast.success("Test reassigned");
      const [assignments, batteries] = await Promise.all([
        adminUsersService.getAssignments(userId),
        adminUsersService.getBatteries(userId),
      ]);

      const byId: Record<string, { assignment_id: string; status: string }> = {};
      for (const assignment of assignments) {
        byId[normalizeTestName(assignment.test_name)] = {
          assignment_id: assignment.assignment_id,
          status: assignment.status,
        };
      }

      setAllAssignments(assignments);
      setAssignmentsById(byId);
      setAvailableBatteries(mapBatteries(batteries));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reassign");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAssignment = async (testName: string) => {
    const normalized = normalizeTestName(testName);
    const a = allAssignments.find(
      (x) =>
        normalizeTestName(x.test_name) === normalized
        && (selectedBatteryId ? x.battery_id === selectedBatteryId : true),
    ) ?? assignmentsById[normalized];
    if (!a || a.status === "completed") return;
    setSaving(true);
    try {
      await adminUsersService.deleteAssignment(userId, a.assignment_id);
      toast.success("Assignment removed");
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(testName);
        return next;
      });
      setOrder((o) => o.filter((x) => x !== testName));
      setAssignmentsById((prev) => {
        const next = { ...prev };
        delete next[testName];
        return next;
      });
      setRemoveConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setSaving(false);
    }
  };

  const orderedSelectedUnique = Array.from(new Set(order.filter((id) => selected.has(id))));

  useEffect(() => {
    const ctx = `${batteryMode}|${selectedBatteryId}`;
    const ctxChanged = ctx !== sessionWeightCtxRef.current;
    if (ctxChanged) sessionWeightCtxRef.current = ctx;

    setSessionWeights((prev) => {
      const b =
        batteryMode === "existing"
          ? availableBatteries.find((x) => x.battery_id === selectedBatteryId)
          : undefined;
      let fromBattery: Record<string, number> | null = null;
      if (b && orderedSelectedUnique.length) {
        const shares = orderedSelectedUnique.map((id) => {
          const it = b.items.find((x) => x.test_name === id);
          return it?.weight ?? 0;
        });
        if (shares.every((s) => s > 0)) {
          const arr = sharesToSessionInputs(shares);
          fromBattery = Object.fromEntries(orderedSelectedUnique.map((id, i) => [id, arr[i]!]));
        }
      }

      const next: Record<string, number> = { ...prev };
      for (const id of orderedSelectedUnique) {
        if (
          !ctxChanged
          && prev[id] != null
          && Number.isFinite(prev[id])
          && prev[id]! >= 0.1
          && prev[id]! <= 1
        ) {
          next[id] = clampSessionWeight(prev[id]!);
          continue;
        }
        if (fromBattery?.[id] != null) {
          next[id] = fromBattery[id]!;
        } else {
          const w = catTaskWeights[id];
          next[id] = typeof w === "number" && w >= 0.1 && w <= 1 ? w : 1;
        }
      }
      for (const k of Object.keys(next)) {
        if (!orderedSelectedUnique.includes(k)) delete next[k];
      }
      return next;
    });
  }, [orderedSelectedUnique, catTaskWeights, batteryMode, selectedBatteryId, availableBatteries]);

  const sessionWeightPercentPreview = useMemo(() => {
    const ids = orderedSelectedUnique;
    const weights = ids.map((id) => clampSessionWeight(sessionWeights[id] ?? 1));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    return ids.map((id, i) => ({ id, pct: (weights[i]! / sum) * 100 }));
  }, [orderedSelectedUnique, sessionWeights]);

  const filteredTests = useMemo(() => {
    const q = testFilter.trim().toLowerCase();
    if (!q) return AVAILABLE_TESTS;
    return AVAILABLE_TESTS.filter((id) => {
      const label = getTaskDisplayName(id).toLowerCase();
      return label.includes(q) || id.replace(/_/g, " ").includes(q) || id.includes(q);
    });
  }, [testFilter]);
  const filteredSelectedTests = useMemo(
    () => filteredTests.filter((id) => selected.has(id)),
    [filteredTests, selected],
  );
  const filteredUnselectedTests = useMemo(
    () => filteredTests.filter((id) => !selected.has(id)),
    [filteredTests, selected],
  );

  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of filteredTests) next.add(id);
      return next;
    });
    setOrder((o) => {
      const tail = [...o];
      for (const id of filteredTests) if (!tail.includes(id)) tail.push(id);
      return tail;
    });
  };

  const clearAllFiltered = () => {
    const toRemove = new Set<string>(filteredTests);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of filteredTests) next.delete(id);
      return next;
    });
    setOrder((o) => o.filter((id) => !toRemove.has(id)));
  };

  if (loading) {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
        <div className="rounded-xl border border-border bg-card px-8 py-6 text-center text-sm text-muted-foreground shadow-lg">
          Loading assignments…
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/50 hover:bg-black/55"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-tests-modal-title"
        className="relative flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[min(92vh,900px)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-border/70 bg-card px-4 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 id="assign-tests-modal-title" className="text-lg font-semibold leading-tight sm:text-xl">
                Assign tests to {userName}
              </h3>
              <p className="text-sm text-muted-foreground">
                Follow the steps below: select tests, arrange order, adjust session emphasis, then save to a battery.
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-9 w-9 shrink-0 rounded-full p-0" title="Close" onClick={onClose}>
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-4 py-4 sm:px-6 sm:py-5">
          {/* 1 — Battery */}
          <section className="mb-6 rounded-xl border border-border/70 bg-muted/20 p-3 sm:p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Step 1: Choose Battery</h4>
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant={batteryMode === "new" ? "primary" : "outline"}
                onClick={() => setBatteryMode("new")}
              >
                Create new battery
              </Button>
              <Button
                type="button"
                variant={batteryMode === "existing" ? "primary" : "outline"}
                onClick={() => setBatteryMode("existing")}
              >
                Edit existing battery
              </Button>
            </div>
            {batteryMode === "existing" ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Select a battery row to edit. Use icons to activate or delete a battery.</p>
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-background/80 p-2">
                  {availableBatteries.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">No batteries yet — create a new one.</p>
                  ) : (
                    availableBatteries.map((b) => (
                      <div
                        key={b.battery_id}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-2 text-xs sm:text-sm ${
                          selectedBatteryId === b.battery_id
                            ? "border-primary/50 bg-primary/8"
                            : "border-border/50 bg-card"
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left"
                          onClick={() => setSelectedBatteryId(b.battery_id)}
                        >
                          <span className="font-medium">{b.title}</span>
                          {b.status === "in_progress" ? (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400"> · Active</span>
                          ) : null}{" "}
                          <span className="text-muted-foreground">({b.status})</span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground sm:inline sm:mt-0 sm:before:mx-2 sm:before:content-['·']">
                            {b.completed_tests}/{b.total_tests} done, {b.pending_tests} pending
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-emerald-600"
                            title="Set active"
                            onClick={() => void handleActivateBattery(b.battery_id)}
                            disabled={activatingBattery || b.status === "completed"}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-rose-500"
                            title="Delete battery"
                            onClick={() => setDeleteBatteryConfirm(b.battery_id)}
                            disabled={saving}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="battery-title-input">
                  New battery title
                </label>
                <input
                  id="battery-title-input"
                  type="text"
                  value={batteryTitle}
                  onChange={(e) => setBatteryTitle(e.target.value)}
                  placeholder="e.g. Baseline cognitive battery"
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
                />
              </div>
            )}
            {activeBattery && (
              <p className="mt-3 text-xs text-muted-foreground">
                Current active battery on user: <span className="font-medium text-foreground">{activeBattery.title}</span>
              </p>
            )}
          </section>

          {/* 2 — Tests */}
          <section className="mb-6 rounded-xl border border-border/70 bg-muted/20 p-3 sm:p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Step 2: Choose Tests</h4>
                <p className="text-xs text-muted-foreground">
                  {selected.size} of {AVAILABLE_TESTS.length} selected — scroll this panel if the list is long.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={selectAllFiltered} disabled={filteredTests.length === 0}>
                  Select all{testFilter.trim() ? " (filtered)" : ""}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={clearAllFiltered} disabled={filteredTests.length === 0}>
                  Clear{testFilter.trim() ? " (filtered)" : ""}
                </Button>
              </div>
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={testFilter}
                onChange={(e) => setTestFilter(e.target.value)}
                placeholder="Search tests…"
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none ring-primary/30 focus-visible:ring-2"
                autoComplete="off"
              />
            </div>
            {filteredTests.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 bg-background px-3 py-6 text-center text-sm text-muted-foreground">
                No tests match “{testFilter.trim()}”. Clear the search to see all tests.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/50 bg-background/80 p-2 sm:p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Selected ({filteredSelectedTests.length})
                  </p>
                  <div className="max-h-[min(44vh,340px)] space-y-2 overflow-y-auto">
                    {filteredSelectedTests.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
                        No selected tests in this filter.
                      </p>
                    ) : (
                      filteredSelectedTests.map((id) => (
                        <label
                          key={`sel-${id}`}
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-3 text-sm shadow-sm transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/35"
                        >
                          <input
                            type="checkbox"
                            checked={true}
                            onChange={() => toggle(id)}
                            className="h-4 w-4 shrink-0 rounded border-border"
                          />
                          <span className="leading-snug">{getTaskDisplayName(id)}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/80 p-2 sm:p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Available ({filteredUnselectedTests.length})
                  </p>
                  <div className="max-h-[min(44vh,340px)] space-y-2 overflow-y-auto">
                    {filteredUnselectedTests.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
                        No unselected tests in this filter.
                      </p>
                    ) : (
                      filteredUnselectedTests.map((id) => (
                        <label
                          key={`unsel-${id}`}
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-3 text-sm shadow-sm transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/35"
                        >
                          <input
                            type="checkbox"
                            checked={false}
                            onChange={() => toggle(id)}
                            className="h-4 w-4 shrink-0 rounded border-border"
                          />
                          <span className="leading-snug">{getTaskDisplayName(id)}</span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* 3 — Order */}
          <section className="mb-6 rounded-xl border border-border/70 bg-muted/20 p-3 sm:p-4">
            <h4 className="mb-2 text-sm font-semibold text-foreground">Step 3: Set Run Order</h4>
            <p className="mb-3 text-xs text-muted-foreground">Drag rows to reorder. Use trash to remove. Completed tests can be reassigned with refresh.</p>
            <div className="max-h-[min(40vh,320px)] space-y-2 overflow-y-auto rounded-lg border border-border/50 bg-background/80 p-2">
              {orderedSelectedUnique.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                  Pick at least one test above. Order appears here after you select.
                </p>
              ) : (
                orderedSelectedUnique.map((id, idx) => {
                  const selectedBattery = availableBatteries.find((b) => b.battery_id === selectedBatteryId);
                  const batteryItemStatus = selectedBattery?.items.find((it) => it.test_name === id)?.status;
                  const assignmentStatus = assignmentStatusForSelectedBattery(id);
                  const isCompleted = batteryItemStatus === "completed" || assignmentStatus === "completed";
                  const hasSavedAssignment = Boolean(assignmentsById[id]);
                  const canRemove = !isCompleted;
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(idx));
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number(e.dataTransfer.getData("text/plain"));
                        if (!Number.isNaN(from) && from !== idx) moveInOrder(from, idx);
                      }}
                      className="flex cursor-grab items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-sm shadow-sm active:cursor-grabbing"
                    >
                      <span className="shrink-0 select-none text-muted-foreground tabular-nums">{idx + 1}.</span>
                      <span className="text-muted-foreground">⋮⋮</span>
                      <span className="min-w-0 flex-1 font-medium leading-snug">
                        {getTaskDisplayName(id)}
                        {isCompleted && (
                          <span className="ml-2 inline-block rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-xs font-normal text-emerald-800 dark:text-emerald-400">
                            completed
                          </span>
                        )}
                      </span>
                      {isCompleted && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 p-0 text-amber-600 hover:bg-amber-500/15"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReassign(id);
                          }}
                          disabled={saving}
                          title="Reassign test"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}
                      {canRemove && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 shrink-0 p-0 text-rose-500 hover:bg-rose-500/15"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasSavedAssignment) {
                              setRemoveConfirm(id);
                              return;
                            }
                            setSelected((prev) => {
                              const next = new Set(prev);
                              next.delete(id);
                              return next;
                            });
                            setOrder((o) => o.filter((x) => x !== id));
                          }}
                          disabled={saving}
                          title={hasSavedAssignment ? "Remove assignment" : "Remove from selected"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Session weights — clinician adjusts discussion emphasis (defaults from CAT Trial Bounds) */}
          <section className="mb-6 rounded-xl border border-primary/25 bg-primary/[0.04] p-3 sm:p-4">
            <h4 className="mb-1 text-sm font-semibold text-foreground">Step 4: Session Weights (This Battery)</h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Defaults come from CAT config (or saved battery mix). Adjust 0.1–1 per test; values are normalized to 100% on save.
            </p>
            {orderedSelectedUnique.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-sm text-muted-foreground">
                Select tests and set run order first.
              </p>
            ) : (
              <div className="max-h-[min(44vh,360px)] space-y-2 overflow-y-auto rounded-lg border border-border/50 bg-background/90 p-2 sm:p-3">
                {orderedSelectedUnique.map((id) => (
                  <div
                    key={`sw-${id}`}
                    className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{getTaskDisplayName(id)}</span>
                    <div className="flex shrink-0 items-center gap-2 sm:w-[220px]">
                      <label className="sr-only" htmlFor={`sw-${id}`}>
                        Relative weight for {getTaskDisplayName(id)}
                      </label>
                      <span className="text-xs text-muted-foreground">Weight</span>
                      <input
                        id={`sw-${id}`}
                        type="number"
                        min={0.1}
                        max={1}
                        step={0.1}
                        value={sessionWeights[id] ?? ""}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          const c = Number.isFinite(v) ? clampSessionWeight(v) : 1;
                          setSessionWeights((w) => ({ ...w, [id]: c }));
                        }}
                        className="h-9 w-24 rounded-md border border-border bg-background px-2 text-sm tabular-nums"
                      />
                      <span className="min-w-[4.5rem] text-right text-xs tabular-nums text-muted-foreground">
                        {sessionWeightPercentPreview.find((r) => r.id === id)?.pct.toFixed(1) ?? "—"}% of session
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border/70 bg-muted/25 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <div className="text-center text-xs text-muted-foreground sm:mr-auto sm:text-left">
            {selected.size === 0 ? "Choose at least one test to continue." : null}
            {selected.size === 0 && batteryMode === "existing" && !selectedBatteryId ? " " : null}
            {batteryMode === "existing" && !selectedBatteryId ? "Select a battery row to update existing assignments." : null}
          </div>
          <div className="flex justify-end gap-2">
          <Button
            onClick={handleSave}
            disabled={saving || selected.size === 0 || (batteryMode === "existing" && !selectedBatteryId)}
          >
            {saving ? "Saving…" : batteryMode === "new" ? "Create Battery & Save" : "Save Changes"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={removeConfirm != null}
        onOpenChange={(open) => !open && setRemoveConfirm(null)}
        title="Remove assignment"
        description={`Remove ${removeConfirm ? getTaskDisplayName(removeConfirm) : ""} from assignments?`}
        onConfirm={async () => { if (removeConfirm) await handleRemoveAssignment(removeConfirm); }}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="destructive"
      />
      <ConfirmDialog
        open={deleteBatteryConfirm != null}
        onOpenChange={(open) => !open && setDeleteBatteryConfirm(null)}
        title="Delete battery"
        description="Delete this battery and its pending assignments?"
        onConfirm={async () => {
          if (deleteBatteryConfirm) await handleDeleteBattery(deleteBatteryConfirm);
        }}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
      />
    </div>,
    document.body,
  );
}
