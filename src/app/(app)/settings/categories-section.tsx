"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { createCategoryAction } from "./actions";

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
  const [name, setName] = useState("");
  const [nameEs, setNameEs] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await createCategoryAction({ name, nameEs });
      if (res.ok) {
        setName("");
        setNameEs("");
        router.refresh();
      } else {
        setError(res.error ?? "Could not create category.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Controlled list used by services, filters and reports.
      </p>
      <div className="flex flex-wrap gap-2">
        {categories.length === 0 && (
          <span className="text-sm text-muted">No categories yet.</span>
        )}
        {categories.map((c) => (
          <span
            key={c.id}
            className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
            title={c.nameEs ?? undefined}
          >
            {c.name}
            {c.nameEs ? (
              <span className="text-primary/60"> · {c.nameEs}</span>
            ) : null}
          </span>
        ))}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
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
          <Button
            variant="secondary"
            onClick={add}
            disabled={pending || !name.trim()}
          >
            {pending ? "Adding…" : "Add category"}
          </Button>
          {error && <p className="w-full text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
