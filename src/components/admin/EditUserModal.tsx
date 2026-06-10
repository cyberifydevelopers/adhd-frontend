import { useState } from "react";
import { createPortal } from "react-dom";
import { adminUsersService } from "@/services";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";

type Props = {
  userId: string;
  userName: string;
  initialName: string;
  initialEmail: string;
  initialIsActive: boolean;
  initialMode: string | null;
  onClose: () => void;
  onSuccess: () => void;
};

export function EditUserModal({
  userId,
  initialName,
  initialEmail,
  initialIsActive,
  initialMode,
  onClose,
  onSuccess,
}: Props) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [mode, setMode] = useState(initialMode ?? "diagnosis_no_substance");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminUsersService.updateUser(userId, { name, email, is_active: isActive, mode });
      toast.success("User updated");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
        <h3 className="mb-4 text-lg font-semibold">Edit user</h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="Full name"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="diagnosis_no_substance">Diagnosis (No Substance)</option>
              <option value="diagnosis_with_substance">Diagnosis (With Substance)</option>
              <option value="treatment_efficacy">Treatment Efficacy</option>
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span className="text-sm font-medium">Active</span>
          </label>
        </div>
        <div className="mt-6 flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
