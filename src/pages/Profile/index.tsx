import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { usersMeService, adminUsersService } from "@/services";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function ProfilePage() {
  const { me, fetchMe } = useAuthStore();
  const [name, setName] = useState(me?.name ?? "");
  const [saving, setSaving] = useState(false);

  if (!me) return null;

  const isAdmin = me.role !== "user";
  const basePath = isAdmin ? "/admin" : "/user";

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name cannot be empty");
      return;
    }
    setSaving(true);
    try {
      if (isAdmin && me.admin_id) {
        await adminUsersService.updateUser(me.admin_id, { name: name.trim() });
      } else {
        // TODO: Backend needs PATCH /users/me/profile endpoint
        await usersMeService.updateProfile({ name: name.trim() });
      }
      await fetchMe();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout
      title="Profile"
      breadcrumbs={[
        { label: "Dashboard", href: basePath },
        { label: "Profile" },
      ]}
    >
      <div className="mx-auto max-w-lg space-y-6">
        <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm animate-fade-in-up">
          {/* Avatar & role */}
          <div className="mb-6 flex flex-col items-center gap-3">
            <div
              className={cn(
                "flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold",
                "bg-primary text-primary-foreground"
              )}
            >
              {getInitials(me.name || me.email)}
            </div>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                me.role === "superadmin"
                  ? "bg-primary/15 text-primary"
                  : me.role === "admin"
                    ? "bg-info/15 text-info"
                    : me.role === "clinician"
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground"
              )}
            >
              {me.role}
            </span>
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                value={me.email}
                readOnly
                className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground cursor-not-allowed"
              />
            </div>
          </div>

          <div className="mt-6">
            <Button
              disabled={saving || name.trim() === me.name}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save changes
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
