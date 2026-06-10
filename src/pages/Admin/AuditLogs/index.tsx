import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Pagination } from "@/components/ui/Pagination";
import { adminAuditService, type AuditLogItem } from "@/services";
import { formatDate } from "@/lib/formatDate";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const LOGIN_PATH = "/login";

type AuditLogPageData = {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
};

function emptyAuditResult(pageSize: number) {
  return { items: [], total: 0, page: 1, page_size: pageSize };
}

function renderTarget(log: AuditLogItem): ReactNode {
  if (!log.target_type || !log.target_id) return "—";

  if (log.target_type === "user") {
    return (
      <Link
        to={`/admin/users/${log.target_id}`}
        className="text-primary hover:underline"
      >
        {log.target_id.slice(0, 8)}…
      </Link>
    );
  }

  return `${log.target_type}: ${log.target_id.slice(0, 8)}…`;
}

export default function AdminAuditLogs() {
  const navigate = useNavigate();
  const me = useAuthStore((s) => s.me);
  const [data, setData] = useState<AuditLogPageData | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (me && !ADMIN_ROLES.has(me.role)) {
      navigate(LOGIN_PATH, { replace: true });
    }
  }, [me?.role, navigate]);

  useEffect(() => {
    setLoading(true);
    adminAuditService
      .list(page, pageSize)
      .then(setData)
      .catch(() => setData(emptyAuditResult(pageSize)))
      .finally(() => setLoading(false));
  }, [page, pageSize]);

  if (!me) return null;

  const total = data?.total ?? 0;

  return (
    <DashboardLayout title="Audit Log">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground">Admin actions: user creation, intake updates, assignment changes.</p>
          <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="animate-pulse text-muted-foreground">Loading audit log…</p>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-muted-foreground">
            No audit entries yet. Actions will appear here after you create users, update intake, or modify assignments.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left">
                    <th className="px-4 py-3 font-medium">ID</th>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((log, index: number) => (
                    <tr key={log.id} className="border-b border-border/60">
                      <td className="px-4 py-3">{(page - 1) * pageSize + index + 1}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(log.timestamp)}</td>
                      <td className="px-4 py-3 font-medium">{log.action}</td>
                      <td className="px-4 py-3">{renderTarget(log)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > 0 && (
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
