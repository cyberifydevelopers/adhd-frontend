import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { Eye, ClipboardList, KeyRound, Loader2, Trash2, UserMinus, UserPlus } from "lucide-react";
import type { UserListItem, UsersListFilters } from "@/services";
import { adminUsersService } from "@/services";
import { adminUsersStore } from "@/stores/adminUsersStore";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AssignTestsModal } from "./AssignTestsModal";
import { toast } from "@/lib/toast";

type CredentialsModal = { email: string; password: string; userName: string };

export function UsersList() {
  const navigate = useNavigate();
  const listData = adminUsersStore((s) => s.listData);
  const isLoadingList = adminUsersStore((s) => s.isLoadingList);
  const sendingUserId = adminUsersStore((s) => s.sendingUserId);
  const fetchList = adminUsersStore((s) => s.fetchList);
  const sendCredentials = adminUsersStore((s) => s.sendCredentials);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ userId: string; name: string } | null>(null);
  const [deactivateConfirm, setDeactivateConfirm] = useState<{ userId: string; name: string } | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<{
    userId: string;
    userName: string;
    userMode: string | null;
  } | null>(null);
  const [credentialsModal, setCredentialsModal] = useState<CredentialsModal | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters: UsersListFilters = {
    search: debouncedSearch || undefined,
    mode: modeFilter || undefined,
    is_active: statusFilter === "" ? undefined : statusFilter === "true",
    created_after: dateFrom || undefined,
    created_before: dateTo || undefined,
  };

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, modeFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchList(page, pageSize, filters);
  }, [page, pageSize, debouncedSearch, modeFilter, statusFilter, dateFrom, dateTo, fetchList]);

  const users = listData?.users ?? [];

  const hasActiveFilters =
    !!filters.search || filters.mode !== undefined || filters.is_active !== undefined || !!filters.created_after || !!filters.created_before;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-HTTPS contexts
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleSendCredentials = async (userId: string, _userEmail: string, userName: string) => {
    const res = await sendCredentials(userId);
    if (res?.temp_password && res?.email) {
      setCredentialsModal({
        email: res.email,
        password: res.temp_password,
        userName,
      });
    }
  };

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setDebouncedSearch("");
    setModeFilter("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
  }, []);

  useEffect(() => {
    if (credentialsModal?.password) {
      copyToClipboard(credentialsModal.password, "Password").catch(() => {});
    }
  }, [credentialsModal?.password]);

  if (isLoadingList && !listData) return <div className="text-muted-foreground">Loading users…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search name or email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
        />
        <select
          value={modeFilter}
          onChange={(e) => setModeFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
        >
          <option value="">All modes</option>
          <option value="diagnosis_no_substance">Diagnosis (No Substance)</option>
          <option value="diagnosis_with_substance">Diagnosis (With Substance)</option>
          <option value="treatment_efficacy">Treatment Efficacy</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
        >
          <option value="">All statuses</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <input
          type="date"
          placeholder="From"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
        />
        <input
          type="date"
          placeholder="To"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
        />
        {hasActiveFilters && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>
      {users.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-muted-foreground">
          {hasActiveFilters ? "No users match your filters." : "No users yet. Create one to get started."}
        </div>
      ) : (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="pb-3 font-medium">ID</th>
            <th className="pb-3 font-medium">Name</th>
            <th className="pb-3 font-medium">Email</th>
            <th className="pb-3 font-medium">Mode</th>
            <th className="pb-3 font-medium">Status</th>
            <th className="pb-3 font-medium">Tasks</th>
            <th className="pb-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u: UserListItem, index: number) => (
            <tr key={u.user_id} className="border-b border-border/60">
              <td className="py-3">
                {index + 1}
              </td>
              <td className="py-3">
                <Link to={`/admin/users/${u.user_id}`} className="font-medium text-primary hover:underline">
                  {u.name}
                </Link>
              </td>
              <td className="py-3">{u.email}</td>
              <td className="py-3 text-muted-foreground">{u.mode ?? "—"}</td>
              <td className="py-3">
                <span className={u.is_active ? "text-emerald-600" : "text-muted-foreground"}>
                  {u.is_active ? "Active" : "Inactive"}
                </span>
              </td>
              <td className="py-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                    {u.pending_count} pending
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                    {u.completed_count} completed
                  </span>
                </div>
              </td>
              <td className="py-3 text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/admin/users/${u.user_id}`)}
                    title="View details"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setAssignModal({
                        userId: u.user_id,
                        userName: u.name,
                        userMode: u.mode,
                      })
                    }
                    title="Assign tests"
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sendingUserId === u.user_id}
                    onClick={() => handleSendCredentials(u.user_id, u.email, u.name)}
                    title="Reset & copy password"
                  >
                    {sendingUserId === u.user_id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <KeyRound className="h-3.5 w-3.5" />}
                  </Button>
                  {u.is_active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-amber-500/60 text-amber-600 hover:bg-amber-500/10"
                      disabled={deactivatingId === u.user_id}
                      title="Deactivate user"
                      onClick={() => setDeactivateConfirm({ userId: u.user_id, name: u.name })}
                    >
                      {deactivatingId === u.user_id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <UserMinus className="h-3.5 w-3.5" />}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-emerald-500/60 text-emerald-600 hover:bg-emerald-500/10"
                      disabled={activatingId === u.user_id}
                      title="Activate user"
                      onClick={async () => {
                        setActivatingId(u.user_id);
                        try {
                          await adminUsersService.updateUser(u.user_id, { is_active: true });
                          toast.success("User activated");
                          fetchList(page, pageSize, filters);
                        } catch {
                          toast.error("Failed to activate user");
                        } finally {
                          setActivatingId(null);
                        }
                      }}
                    >
                      {activatingId === u.user_id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <UserPlus className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-rose-500/60 text-rose-600 hover:bg-rose-500/10"
                    disabled={deletingId === u.user_id}
                    title="Delete user"
                    onClick={() => setDeleteConfirm({ userId: u.user_id, name: u.name })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      )}
      {listData && listData.total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={listData.total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      )}
      {assignModal && (
        <AssignTestsModal
          userId={assignModal.userId}
          userName={assignModal.userName}
          userMode={assignModal.userMode}
          onClose={() => setAssignModal(null)}
          onSuccess={() => fetchList(page, pageSize, filters)}
        />
      )}
      {deleteConfirm && (
        <ConfirmDialog
          open={!!deleteConfirm}
          onOpenChange={(open) => !open && setDeleteConfirm(null)}
          title="Delete user"
          description={`Permanently delete ${deleteConfirm.name} and all their data? This action cannot be undone.`}
          onConfirm={async () => {
            if (!deleteConfirm) return;
            setDeletingId(deleteConfirm.userId);
            try {
              await adminUsersService.deleteUser(deleteConfirm.userId);
              toast.success("User deleted");
              fetchList(page, pageSize, filters);
            } catch {
              toast.error("Failed to delete user");
            } finally {
              setDeletingId(null);
            }
          }}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="destructive"
        />
      )}
      {deactivateConfirm && (
        <ConfirmDialog
          open={!!deactivateConfirm}
          onOpenChange={(open) => !open && setDeactivateConfirm(null)}
          title="Deactivate user"
          description={`Deactivate ${deactivateConfirm.name}? They will no longer be able to log in until reactivated.`}
          onConfirm={async () => {
            if (!deactivateConfirm) return;
            setDeactivatingId(deactivateConfirm.userId);
            try {
              await adminUsersService.updateUser(deactivateConfirm.userId, { is_active: false });
              toast.success("User deactivated");
              fetchList(page, pageSize, filters);
            } catch {
              toast.error("Failed to deactivate user");
            } finally {
              setDeactivatingId(null);
              setDeactivateConfirm(null);
            }
          }}
          confirmLabel="Deactivate"
          cancelLabel="Cancel"
          variant="destructive"
        />
      )}
      {credentialsModal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
            <h3 className="mb-2 text-lg font-semibold">Credentials for {credentialsModal.userName}</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              New password generated. Copy and share securely with the user.
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-16 text-sm text-muted-foreground">Email:</span>
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-sm">
                  {credentialsModal.email}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(credentialsModal.email, "Email")}
                >
                  Copy
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 text-sm text-muted-foreground">Password:</span>
                <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-sm">
                  {credentialsModal.password}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(credentialsModal.password, "Password")}
                >
                  Copy
                </Button>
              </div>
            </div>
            <Button className="mt-4" onClick={() => setCredentialsModal(null)}>
              Done
            </Button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
