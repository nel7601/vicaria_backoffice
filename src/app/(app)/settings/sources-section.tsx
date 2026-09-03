"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import {
  createAcquisitionSourceAction,
  deleteAcquisitionSourceAction,
  setAcquisitionSourceArchivedAction,
  updateAcquisitionSourceAction,
} from "./actions";
import { deleteBtnClass, editBtnClass } from "./services-section";

export interface SourceRow {
  id: string;
  name: string;
  nameEs: string | null;
  isActive: boolean;
}

/**
 * How patients found Vicaria. A controlled list rather than a free-text box:
 * "Google", "google" and "Google ads" typed into three appointments are one
 * channel to the business and three rows to a report.
 */
export function SourcesSection({
  sources,
  canEdit,
}: {
  sources: SourceRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null); // "new" | id
  const [name, setName] = useState("");
  const [nameEs, setNameEs] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  function openNew() {
    setName("");
    setNameEs("");
    setIsActive(true);
    setError(null);
    setEditing("new");
  }

  function openEdit(s: SourceRow) {
    setName(s.name);
    setNameEs(s.nameEs ?? "");
    setIsActive(s.isActive);
    setError(null);
    setEditing(s.id);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res =
        editing === "new"
          ? await createAcquisitionSourceAction({ name, nameEs })
          : await updateAcquisitionSourceAction(editing!, {
              name,
              nameEs,
              isActive,
            });
      if (res.ok) {
        setEditing(null);
        router.refresh();
      } else {
        setError(res.error ?? "Could not save the source.");
      }
    });
  }

  function setArchived(s: SourceRow, archive: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setAcquisitionSourceArchivedAction(s.id, archive);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not update the source.");
    });
  }

  function remove(s: SourceRow) {
    if (
      !window.confirm(
        `Delete source "${s.name}"? If any patient came from it, it can only be archived.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAcquisitionSourceAction(s.id);
      if (res.ok) router.refresh();
      else setError(res.error ?? "Could not delete the source.");
    });
  }

  const archivedCount = sources.filter((s) => !s.isActive).length;
  const shown = showArchived ? sources : sources.filter((s) => s.isActive);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Where patients heard about Vicaria. Offered when creating or editing a
        patient, and counted by the MKT-01 report. Renaming one updates every
        patient already attributed to it.
      </p>
      <div className="flex flex-wrap gap-2">
        {shown.length === 0 && (
          <span className="text-sm text-muted">No sources yet.</span>
        )}
        {shown.map((s) => (
          <span
            key={s.id}
            className={`inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm ${
              s.isActive ? "" : "opacity-60"
            }`}
          >
            <span className={s.isActive ? "text-primary" : "text-muted line-through"}>
              {s.name}
              {s.nameEs ? <span className="opacity-60"> · {s.nameEs}</span> : null}
            </span>
            {canEdit && (
              <span className="flex gap-1">
                <button
                  onClick={() => openEdit(s)}
                  className={editBtnClass}
                  aria-label={`Edit ${s.name}`}
                >
                  Edit
                </button>
                <button
                  onClick={() => setArchived(s, s.isActive)}
                  disabled={pending}
                  className={editBtnClass}
                  aria-label={`${s.isActive ? "Archive" : "Unarchive"} ${s.name}`}
                >
                  {s.isActive ? "Archive" : "Unarchive"}
                </button>
                <button
                  onClick={() => remove(s)}
                  disabled={pending}
                  className={deleteBtnClass}
                  aria-label={`Delete ${s.name}`}
                >
                  Delete
                </button>
              </span>
            )}
          </span>
        ))}
      </div>

      {archivedCount > 0 && (
        <button
          onClick={() => setShowArchived((v) => !v)}
          className="text-sm text-primary hover:underline"
        >
          {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
        </button>
      )}

      {error && editing === null && <p className="text-sm text-danger">{error}</p>}

      {canEdit && editing === null && (
        <Button variant="secondary" onClick={openNew}>
          Add source
        </Button>
      )}

      {canEdit && editing !== null && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name (EN)</span>
            <input
              className={inputClass}
              placeholder="Referral"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Name (ES) — optional</span>
            <input
              className={inputClass}
              placeholder="Recomendación"
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
            {pending ? "Saving…" : editing === "new" ? "Add source" : "Save"}
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
