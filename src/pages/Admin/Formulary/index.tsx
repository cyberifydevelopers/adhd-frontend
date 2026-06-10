import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminUsersService } from "@/services";
import { toast } from "@/lib/toast";

type FormularyItem = { id: string; name: string; common_strengths: string[] };

export default function AdminFormulary() {
  const [items, setItems] = useState<FormularyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newStrengths, setNewStrengths] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  const load = () => {
    setLoading(true);
    adminUsersService
      .getFormulary("", pageSize, page)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [page, pageSize]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      await adminUsersService.createFormularyItem({
        name: newName.trim(),
        common_strengths: newStrengths.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
      });
      toast.success("Added");
      setNewName("");
      setNewStrengths("");
      setShowAdd(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await adminUsersService.deleteFormularyItem(id);
      toast.success("Deleted");
      setDeleteConfirm(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleUpdate = async (id: string, name: string, strengths: string[]) => {
    try {
      await adminUsersService.updateFormularyItem(id, { name, common_strengths: strengths });
      toast.success("Updated");
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <DashboardLayout title="Medication Formulary">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to Admin
          </Link>
          {!showAdd && (
            <Button size="sm" onClick={() => setShowAdd(true)}>
              Add medication
            </Button>
          )}
        </div>

        {showAdd && (
          <div className="rounded-xl border border-border/60 bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Add medication</h3>
            <div className="space-y-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (e.g. Methylphenidate ER)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={newStrengths}
                onChange={(e) => setNewStrengths(e.target.value)}
                placeholder="Strengths (comma-separated, e.g. 18mg, 27mg)"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAdd} disabled={!newName.trim()}>
                  Add
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setNewName(""); setNewStrengths(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

        <section className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Formulary list
          </h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No medications in formulary.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="pb-3 font-medium">ID</th>
                    <th className="pb-3 font-medium">Name</th>
                    <th className="pb-3 font-medium">Strengths</th>
                    <th className="pb-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id} className="border-b border-border/60">
                      {editingId === item.id ? (
                        <td colSpan={4} className="py-3">
                          <FormularyEditRow
                            item={item}
                            onSave={(name, strengths) => handleUpdate(item.id, name, strengths)}
                            onCancel={() => setEditingId(null)}
                          />
                        </td>
                      ) : (
                        <>
                          <td className="py-3">{(page - 1) * pageSize + index + 1}</td>
                          <td className="py-3 font-medium">{item.name}</td>
                          <td className="py-3 text-muted-foreground">
                            {item.common_strengths?.length
                              ? item.common_strengths.join(", ")
                              : "—"}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => setEditingId(item.id)} title="Edit">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-rose-500/60 text-rose-600 hover:bg-rose-500/10"
                                onClick={() => setDeleteConfirm({ id: item.id, name: item.name })}
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {total > 0 && (
            <div className="mt-4">
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </div>
          )}
        </section>
      </div>
      {deleteConfirm && (
        <ConfirmDialog
          open={!!deleteConfirm}
          onOpenChange={(open) => !open && setDeleteConfirm(null)}
          title="Delete medication"
          description={`Delete ${deleteConfirm.name} from the formulary?`}
          onConfirm={() => handleDelete(deleteConfirm.id)}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="destructive"
        />
      )}
    </DashboardLayout>
  );
}

function FormularyEditRow({
  item,
  onSave,
  onCancel,
}: {
  item: FormularyItem;
  onSave: (name: string, strengths: string[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [strengths, setStrengths] = useState(item.common_strengths?.join(", ") ?? "");
  return (
    <div className="flex w-full flex-1 flex-wrap items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-[160px] flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
      />
      <input
        type="text"
        value={strengths}
        onChange={(e) => setStrengths(e.target.value)}
        placeholder="Strengths"
        className="min-w-[120px] rounded border border-border bg-background px-2 py-1 text-sm"
      />
      <Button
        size="sm"
        onClick={() => onSave(name, strengths.split(/[,;]/).map((s) => s.trim()).filter(Boolean))}
      >
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
