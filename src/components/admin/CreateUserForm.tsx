import { useState } from "react";
import { UserPlus, Loader2, X, Copy, Check } from "lucide-react";
import { adminUsersStore } from "@/stores/adminUsersStore";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";

type Props = {
  onSuccess: () => void;
  onCancel: () => void;
};

export function CreateUserForm({ onSuccess, onCancel }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState("diagnosis_no_substance");
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
    userId: string;
  } | null>(null);

  const createUser = adminUsersStore((s) => s.createUser);
  const isCreating = adminUsersStore((s) => s.isCreating);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("Please enter a valid email address");
      return;
    }
    try {
      const res = await createUser({
        name: name.trim(),
        email: email.trim(),
        mode,
      });
      if (res && res.temp_password && res.user_id) {
        setCreatedCredentials({
          email: res.email,
          password: res.temp_password,
          userId: res.user_id,
        });
      } else {
        onSuccess();
      }
    } catch {
      // Error toasted by mutation
    }
  };

  if (createdCredentials) {
    return (
      <div className="space-y-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="text-sm font-medium text-foreground">
          User created. Share these credentials securely. The user must change the password and complete the intake form on first login.
        </p>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Email:</span>
            <code className="flex-1 rounded bg-muted px-2 py-1 text-sm">
              {createdCredentials.email}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="inline-flex items-center gap-1"
              onClick={() => copyToClipboard(createdCredentials.email, "Email")}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Password:</span>
            <code className="flex-1 rounded bg-muted px-2 py-1 text-sm font-mono">
              {createdCredentials.password}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="inline-flex items-center gap-1"
              onClick={() =>
                copyToClipboard(createdCredentials.password, "Password")
              }
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Assign tests to this user so they can run the assessment. They will complete intake and change password when they first sign in.
        </p>
        <Button
          className="inline-flex items-center gap-1.5"
          onClick={() => {
            setCreatedCredentials(null);
            onSuccess();
          }}
        >
          <Check className="h-4 w-4" />
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          placeholder="User full name"
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          placeholder="user@example.com"
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Mode</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="diagnosis_no_substance">
            Diagnosis (No Substance)
          </option>
          <option value="diagnosis_with_substance">
            Diagnosis (With Substance)
          </option>
          <option value="treatment_efficacy">Treatment Efficacy</option>
        </select>
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          disabled={isCreating}
          className="inline-flex items-center gap-1.5"
          onClick={handleSubmit}
        >
          {isCreating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating…
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4" />
              Create user
            </>
          )}
        </Button>
        <Button
          variant="outline"
          className="inline-flex items-center gap-1.5"
          onClick={onCancel}
        >
          <X className="h-4 w-4" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
