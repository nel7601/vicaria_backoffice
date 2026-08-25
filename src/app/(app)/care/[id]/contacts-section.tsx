"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { addCareContactAction } from "../actions";

export interface ContactRow {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  canApprove: boolean;
}

export function ContactsSection({
  agreementId,
  contacts,
  canEdit,
}: {
  agreementId: string;
  contacts: ContactRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    relationship: "",
    phone: "",
    email: "",
    isPrimary: contacts.length === 0,
    canApprove: false,
    notes: "",
  });

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await addCareContactAction(agreementId, form);
      if (res.ok) {
        setOpen(false);
        setForm({
          name: "",
          relationship: "",
          phone: "",
          email: "",
          isPrimary: false,
          canApprove: false,
          notes: "",
        });
        router.refresh();
      } else {
        setError(res.error ?? "Could not add contact.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {contacts.length === 0 && (
          <li className="p-3 text-sm text-muted">
            No family contacts yet. Add the primary contact who arranges care.
          </li>
        )}
        {contacts.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
          >
            <div>
              <div className="font-medium">
                {c.name}
                {c.relationship ? (
                  <span className="text-muted"> · {c.relationship}</span>
                ) : null}
              </div>
              <div className="text-xs text-muted">
                {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <div className="flex gap-2 text-xs">
              {c.isPrimary && (
                <span className="rounded-full bg-primary-soft px-2 py-0.5 text-primary-hover">
                  primary
                </span>
              )}
              {c.canApprove && (
                <span className="rounded-full bg-success-soft px-2 py-0.5 text-success">
                  can approve changes
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {canEdit && !open && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add contact
        </Button>
      )}

      {canEdit && open && (
        <div className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name</span>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Relationship</span>
            <input
              className={inputClass}
              placeholder="daughter, son, spouse…"
              value={form.relationship}
              onChange={(e) =>
                setForm((f) => ({ ...f, relationship: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Phone</span>
            <input
              className={inputClass}
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Email</span>
            <input
              type="email"
              className={inputClass}
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <div className="flex items-center gap-4 text-sm sm:col-span-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isPrimary}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isPrimary: e.target.checked }))
                }
              />
              Primary contact
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.canApprove}
                onChange={(e) =>
                  setForm((f) => ({ ...f, canApprove: e.target.checked }))
                }
              />
              Can approve schedule changes
            </label>
          </div>
          {error && <p className="text-sm text-danger sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={submit} disabled={pending || !form.name.trim()}>
              {pending ? "Saving…" : "Add contact"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
