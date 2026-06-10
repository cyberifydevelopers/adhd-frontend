import { useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { DashboardLayout } from "@/components/DashboardLayout";
import { UsersList } from "@/components/admin/UsersList";
import { CreateUserForm } from "@/components/admin/CreateUserForm";
import { Button } from "@/components/ui/Button";

const ADMIN_ROLES = ["admin", "superadmin"];

export default function AdminUsers() {
  const me = useAuthStore((s) => s.me);
  const [showCreateForm, setShowCreateForm] = useState(false);

  if (!me) return null;

  const isAdmin = ADMIN_ROLES.includes(me.role);

  return (
    <DashboardLayout
      title="Users"
      breadcrumbs={[
        { label: "Dashboard", href: "/admin" },
        { label: "Users" },
      ]}
    >
      <div className="space-y-6">
        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm animate-fade-in-up">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">All Users</h2>
            {isAdmin && !showCreateForm && (
              <Button size="sm" onClick={() => setShowCreateForm(true)}>
                Create user
              </Button>
            )}
          </div>
          {showCreateForm && isAdmin ? (
            <CreateUserForm
              onSuccess={() => setShowCreateForm(false)}
              onCancel={() => setShowCreateForm(false)}
            />
          ) : (
            <UsersList />
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
