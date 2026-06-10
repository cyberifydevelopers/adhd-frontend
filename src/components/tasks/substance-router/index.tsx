import { useEffect, useState } from "react";
import { TaskLayout } from "../TaskLayout";
import { BackToDashboardButton } from "@/components/BackToDashboardButton";

import SubstanceDDTask from "../substance-dd";
import PsychomotorSpeedTask from "../psychomotor-speed";
import SetShiftingMiniTask from "../set-shifting-mini";
import WMDistractionTask from "../wm-distraction";

type SubstanceFlags = Record<string, boolean>;

const SUBSTANCE_MODULE_MAP: { substance: string; component: React.ComponentType }[] = [
  { substance: "stimulants", component: SubstanceDDTask },
  { substance: "opioids", component: PsychomotorSpeedTask },
  { substance: "alcohol", component: SetShiftingMiniTask },
  { substance: "cannabis", component: WMDistractionTask },
];

const MAX_MODULES = 2;

export default function SubstanceRouter() {
  const [flags, setFlags] = useState<SubstanceFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentModuleIdx] = useState(0);
  const [completedModules] = useState<string[]>([]);

  useEffect(() => {
    setFlags({});
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <TaskLayout title="Substance Modules">
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="animate-pulse text-muted-foreground">Loading substance information…</p>
        </div>
      </TaskLayout>
    );
  }

  const activeModules = SUBSTANCE_MODULE_MAP
    .filter((m) => flags?.[m.substance])
    .slice(0, MAX_MODULES);

  if (activeModules.length === 0) {
    return (
      <TaskLayout title="Substance Modules">
        <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm">
          <h2 className="text-xl font-semibold">No Substance Modules Required</h2>
          <p className="text-muted-foreground">
            No substance-specific modules are flagged for this assessment.
          </p>
          <BackToDashboardButton />
        </div>
      </TaskLayout>
    );
  }

  if (currentModuleIdx >= activeModules.length) {
    return (
      <TaskLayout title="Substance Modules">
        <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-border bg-card p-8 shadow-sm">
          <h2 className="text-xl font-semibold">All substance modules complete</h2>
          <p className="text-muted-foreground">
            Completed: {completedModules.join(", ")}
          </p>
          <BackToDashboardButton />
        </div>
      </TaskLayout>
    );
  }

  const CurrentModule = activeModules[currentModuleIdx].component;
  return <CurrentModule />;
}
