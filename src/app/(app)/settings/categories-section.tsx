"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
} from "./actions";
import { deleteBtnClass, editBtnClass } from "./services-section";

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

  function remove(c: CategoryRow) {
    if (
      !window.confirm(
        `Delete category "${c.name}"? If any service uses it, it can only be archived.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCategoryAction(c.id);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not delete category.");
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
            className={`inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm ${
              c.isActive ? "" : "opacity-60"
            }`}
          >
            <span className={c.isActive ? "text-primary" : "text-muted line-through"}>
              {c.name}
              {c.nameEs ? <span className="opacity-60"> · {c.nameEs}</span> : null}
            </span>
            {canEdit && (
              <span className="flex gap-1">
                <button
                  onClick={() => openEdit(c)}
                  className={editBtnClass}
                  aria-label={`Edit ${c.name}`}
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(c)}
                  disabled={pending}
                  className={deleteBtnClass}
                  aria-label={`Delete ${c.name}`}
                >
                  Delete
                </button>
              </span>
            )}
          </span>
        ))}
      </div>

      {error && editing === null && (
        <p className="text-sm text-danger">{error}</p>
      )}

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
