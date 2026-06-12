import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { useAuthStore } from "@/stores/authStore";
import { usersMeService } from "@/services";
import { toast } from "@/lib/toast";

type FormularyItem = { name: string; common_strengths: string[]; common_forms: string[] };
const DEFAULT_MEDICATION_FORMS = ["Tablet", "Syrup"];
type MedicationEntry = {
  name: string;
  strength: string;
  form: string;
  quantity: string;
  _formulary?: FormularyItem;
};

function YesNoQuestion({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex items-center gap-6 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name={label}
            checked={value === true}
            onChange={() => onChange(true)}
          />
          Yes
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name={label}
            checked={value === false}
            onChange={() => onChange(false)}
          />
          No
        </label>
      </div>
    </fieldset>
  );
}

function TodayMedicineSelect({
  name,
  strength,
  formularyItems,
  onNameChange,
  onStrengthChange,
}: {
  name: string;
  strength: string;
  formularyItems: FormularyItem[];
  onNameChange: (name: string, formulary?: FormularyItem) => void;
  onStrengthChange: (strength: string) => void;
}) {
  const formulary = formularyItems.find((item) => item.name === name);
  const strengths = formulary?.common_strengths ?? [];

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[180px] flex-1">
        <label className="mb-0.5 block text-xs text-muted-foreground">Name</label>
        <select
          value={name}
          onChange={(e) => {
            const selected = formularyItems.find((item) => item.name === e.target.value);
            onNameChange(e.target.value, selected);
          }}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Select medication…</option>
          {formularyItems.map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
          {name && !formularyItems.some((f) => f.name === name) && (
            <option value={name}>{name}</option>
          )}
        </select>
      </div>
      <div className="w-28">
        <label className="mb-0.5 block text-xs text-muted-foreground">Strength</label>
        {strengths.length > 0 ? (
          <select
            value={strength}
            onChange={(e) => onStrengthChange(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Select…</option>
            {strengths.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <input
            type="text"
            value={strength}
            onChange={(e) => onStrengthChange(e.target.value)}
            placeholder="Strength"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        )}
      </div>
    </div>
  );
}

function MedicationRow({
  entry,
  formularyItems,
  onChange,
  onRemove,
}: {
  entry: MedicationEntry;
  formularyItems: FormularyItem[];
  onChange: (e: MedicationEntry) => void;
  onRemove: () => void;
}) {
  const selectMedication = (name: string) => {
    const selected = formularyItems.find((item) => item.name === name);
    if (!selected) {
      onChange({
        ...entry,
        name,
        _formulary: undefined,
      });
      return;
    }

    onChange({
      ...entry,
      name: selected.name,
      strength: selected.common_strengths?.[0] ?? "",
      form: selected.common_forms?.[0] ?? "",
      _formulary: selected,
    });
  };

  const formulary = entry._formulary;
  const forms = Array.from(new Set([...(formulary?.common_forms ?? []), ...DEFAULT_MEDICATION_FORMS]));
  const strengths = formulary?.common_strengths ?? [];

  return (
    <div className="relative flex flex-nowrap items-end gap-2 overflow-x-auto rounded-lg border border-border/60 bg-muted/20 p-2">
      <div className="min-w-[180px] flex-1">
        <label className="mb-0.5 block text-xs text-muted-foreground">Name</label>
        <select
          value={entry.name}
          onChange={(e) => selectMedication(e.target.value)}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Select medication…</option>
          {formularyItems.map((f) => (
            <option key={f.name} value={f.name}>{f.name}</option>
          ))}
          {entry.name && !formularyItems.some((f) => f.name === entry.name) && (
            <option value={entry.name}>{entry.name}</option>
          )}
        </select>
      </div>
      <div className="w-28">
        <label className="mb-0.5 block text-xs text-muted-foreground">Form</label>
        <select
          value={entry.form}
          onChange={(e) => onChange({ ...entry, form: e.target.value })}
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Select…</option>
          {forms.map((f) => <option key={f} value={f}>{f}</option>)}
          {entry.form && !forms.includes(entry.form) && <option value={entry.form}>{entry.form}</option>}
        </select>
      </div>
      <div className="w-28">
        <label className="mb-0.5 block text-xs text-muted-foreground">Strength</label>
        {strengths.length > 0 ? (
          <select
            value={entry.strength}
            onChange={(e) => onChange({ ...entry, strength: e.target.value })}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Select…</option>
            {strengths.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <input
            type="text"
            value={entry.strength}
            onChange={(e) => onChange({ ...entry, strength: e.target.value })}
            placeholder="Strength"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        )}
      </div>
      <div className="w-20">
        <label className="mb-0.5 block text-xs text-muted-foreground">Quantity</label>
        <input
          type="number"
          min={1}
          value={entry.quantity}
          onChange={(e) => onChange({ ...entry, quantity: e.target.value })}
          placeholder="Qty"
          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <Button size="sm" variant="ghost" onClick={onRemove} className="shrink-0 inline-flex items-center gap-1 text-destructive">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function validateDob(dateOfBirth: string): string | null {
  if (!dateOfBirth) return "Date of birth is required";
  const dob = new Date(dateOfBirth);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (dob >= today) return "Date of birth must be in the past";
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  if (age < 5) return "Age must be at least 5 years";
  if (age > 120) return "Age must be less than 120 years";
  return null;
}

export default function UserIntake() {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.me);
  const isReturning = Boolean(me?.has_intake);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [adhdHistory, setAdhdHistory] = useState<boolean>(false);
  const [medicationStatus, setMedicationStatus] = useState<boolean>(false);
  const [medications, setMedications] = useState<MedicationEntry[]>([]);
  const [tookMedicationToday, setTookMedicationToday] = useState<boolean>(false);
  const [medicationTimeTaken, setMedicationTimeTaken] = useState<string>("");
  const [todayMedicineName, setTodayMedicineName] = useState<string>("");
  const [todayMedicineStrength, setTodayMedicineStrength] = useState<string>("");
  const [formularyItems, setFormularyItems] = useState<FormularyItem[]>([]);

  useEffect(() => {
    usersMeService.getFormulary("", 100).then((data) => setFormularyItems(data.items ?? [])).catch(() => setFormularyItems([]));
  }, []);

  useEffect(() => {
    usersMeService
      .getIntake()
      .then((r) => {
        const id = r.intake_data ?? {};
        setDateOfBirth(String((id.date_of_birth as string) ?? "").slice(0, 10));
        setAdhdHistory(Boolean(id.adhd_history));
        setMedicationStatus(Boolean(r.medication_status ?? id.medication_status));
        const meds = r.medications ?? [];
        setMedications(
          meds.map((m) => ({
            name: m.name,
            strength: m.strength ?? "",
            form: m.form ?? "",
            quantity: m.quantity != null ? String(m.quantity) : "",
          }))
        );
        const todayMed = meds.find((m) => m.time_last_taken);
        const firstTimeTaken = todayMed?.time_last_taken ?? null;
        setTookMedicationToday(Boolean(firstTimeTaken));
        setMedicationTimeTaken(firstTimeTaken ? new Date(firstTimeTaken).toTimeString().slice(0, 5) : "");
        setTodayMedicineName(todayMed?.name ?? "");
        setTodayMedicineStrength(todayMed?.strength ?? "");
      })
      .catch(() => toast.error("Failed to load form"))
      .finally(() => setLoading(false));
  }, []);

  const addMedication = () =>
    setMedications((m) => [...m, { name: "", strength: "", form: "", quantity: "" }]);
  const updateMedication = (i: number, entry: MedicationEntry) =>
    setMedications((m) => m.map((x, j) => (j === i ? entry : x)));
  const removeMedication = (i: number) =>
    setMedications((m) => m.filter((_, j) => j !== i));

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const dobError = validateDob(dateOfBirth);
    if (dobError) {
      toast.error(dobError);
      return;
    }
    if (medicationStatus && medications.filter((m) => m.name.trim()).length === 0) {
      toast.error("Please add at least one medication");
      return;
    }
    if (tookMedicationToday && !todayMedicineName.trim()) {
      toast.error("Please select the medication you took today");
      return;
    }
    setSaving(true);
    try {
      await usersMeService.updateIntake({
        date_of_birth: dateOfBirth || undefined,
        adhd_history: adhdHistory,
        medication_status: medicationStatus,
        took_medication_today: tookMedicationToday,
        medications: medicationStatus
          ? medications
              .filter((m) => m.name.trim())
              .map((m) => {
                let time_last_taken: string | undefined;
                const matchesToday =
                  tookMedicationToday &&
                  m.name.trim() === todayMedicineName.trim() &&
                  (!todayMedicineStrength.trim() || m.strength.trim() === todayMedicineStrength.trim());
                if (matchesToday && medicationTimeTaken) {
                  const today = new Date().toISOString().slice(0, 10);
                  time_last_taken = new Date(`${today}T${medicationTimeTaken}`).toISOString();
                }
                return {
                  name: m.name.trim(),
                  strength: m.strength.trim() || undefined,
                  form: m.form.trim() || undefined,
                  quantity: m.quantity ? parseInt(m.quantity, 10) : undefined,
                  time_last_taken,
                };
              })
          : [],
      });
      toast.success(isReturning ? "Health information updated." : "Intake saved. You can now complete your assigned tests.");
      await useAuthStore.getState().fetchMe();
      navigate("/user", { replace: true });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string | { msg: string }[] } } };
      const detail = axiosErr?.response?.data?.detail;
      if (Array.isArray(detail)) {
        toast.error(detail.map((d) => d.msg).join(", "));
      } else if (typeof detail === "string") {
        toast.error(detail);
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout title="Intake">
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Intake">
      <div className="mx-auto max-w-xl space-y-6">
        <p className="text-muted-foreground">
          {isReturning
            ? "Update your health information below. Changes are saved when you submit the form."
            : "Please complete this form before starting your assessments. Your information helps provide accurate results."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Date of birth <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          <YesNoQuestion
            label="Have you ever been diagnosed with ADHD?"
            value={adhdHistory}
            onChange={setAdhdHistory}
          />

          <>
            <YesNoQuestion
              label="Are you taking any medications for ADHD?"
              value={medicationStatus}
              onChange={(v) => {
                setMedicationStatus(v);
                if (!v) {
                  setMedications([]);
                  setTookMedicationToday(false);
                  setMedicationTimeTaken("");
                  setTodayMedicineName("");
                  setTodayMedicineStrength("");
                }
              }}
            />

            {medicationStatus && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm font-medium">Medications</label>
                  <Button type="button" size="sm" variant="ghost" className="inline-flex items-center gap-1" onClick={addMedication}>
                    <Plus className="h-3.5 w-3.5" /> Add medication
                  </Button>
                </div>
                <div className="space-y-2">
                  {medications.map((m, i) => (
                    <MedicationRow
                      key={i}
                      entry={m}
                      formularyItems={formularyItems}
                      onChange={(e) => updateMedication(i, e)}
                      onRemove={() => removeMedication(i)}
                    />
                  ))}
                  {medications.length === 0 && (
                    <p className="text-sm text-muted-foreground">No medications added. Click to add.</p>
                  )}
                </div>
                <div className="mt-3 space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
                  <ToggleSwitch
                    checked={tookMedicationToday}
                    onCheckedChange={(v) => {
                      setTookMedicationToday(v);
                      if (!v) {
                        setMedicationTimeTaken("");
                        setTodayMedicineName("");
                        setTodayMedicineStrength("");
                      }
                    }}
                    label="Did you take any medicine today?"
                  />
                  {tookMedicationToday && (
                    <div className="space-y-2">
                      <TodayMedicineSelect
                        name={todayMedicineName}
                        strength={todayMedicineStrength}
                        formularyItems={formularyItems}
                        onNameChange={(selectedName, selected) => {
                          setTodayMedicineName(selectedName);
                          setTodayMedicineStrength(selected?.common_strengths?.[0] ?? "");
                        }}
                        onStrengthChange={setTodayMedicineStrength}
                      />
                      <div className="w-32">
                        <label className="mb-0.5 block text-xs text-muted-foreground">Time taken</label>
                        <input
                          type="time"
                          value={medicationTimeTaken}
                          onChange={(e) => setMedicationTimeTaken(e.target.value)}
                          className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>

          <Button type="submit" disabled={saving} className="inline-flex items-center gap-1.5">
            {saving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              <><Save className="h-4 w-4" /> {isReturning ? "Save changes" : "Save and continue"}</>
            )}
          </Button>
        </form>
      </div>
    </DashboardLayout>
  );
}
