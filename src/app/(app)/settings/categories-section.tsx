"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { createCategoryAction, updateCategoryAction } from "./actions";

export interface CategoryRow {
  id: string;
  name: string;
  nameEs: string | null;
  isActive: boolean;
}

export function CategoriesSection({
  categories,
  canEdit,
}: {
  categories: CategoryRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null); // "new" | id
  const [name, setName] = useState("");
  const [nameEs, setNameEs] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function openNew() {
    setName("");
    setNameEs("");
    setIsActive(true);
    setError(null);
    setEditing("new");
  }

  function openEdit(c: CategoryRow) {
    setName(c.name);
    setNameEs(c.nameEs ?? "");
    setIsActive(c.isActive);
    setError(null);
    setEditing(c.id);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res =
        editing === "new"
          ? await createCategoryAction({ name, nameEs })
          : await updateCategoryAction(editing!, { name, nameEs, isActive });
      if (res.ok) {
        setEditing(null);
        router.refresh();
      } else {
        setError(res.error ?? "Could not save category.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Controlled list used by services, filters and reports. Renaming a
        category updates the services that use it.
      </p>
      <div className="flex flex-wrap gap-2">
        {categories.length === 0 && (
          <span className="text-sm text-muted">No categories yet.</span>
        )}
        {categories.map((c) => (
          <span
            key={c.id}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ${
              c.isActive
                ? "bg-primary/10 text-primary"
                : "bg-border text-muted line-through"
            }`}
          >
            {c.name}
            {c.nameEs ? <span className="opacity-60"> · {c.nameEs}</span> : null}
            {canEdit && (
              <button
                onClick={() => openEdit(c)}
                className="ml-1 text-xs underline-offset-2 hover:underline"
                aria-label={`Edit ${c.name}`}
              >
                edit
              </button>
            )}
          </span>
        ))}
      </div>

      {canEdit && editing === null && (
        <Button variant="secondary" onClick={openNew}>
          Add category
        </Button>
      )}

      {canEdit && editing !== null && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name (EN)</span>
            <input
              className={inputClass}
              placeholder="coaching"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Nombre (ES) — opcional</span>
            <input
              className={inputClass}
              placeholder="coaching"
              value={nameEs}
              onChange={(e) => setNameEs(e.target.value)}
            />
          </label>
          {editing !== "new" && (
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active
            </label>
          )}
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending ? "Saving…" : editing === "new" ? "Add category" : "Save"}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          {error && <p className="w-full text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
