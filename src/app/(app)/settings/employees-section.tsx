"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { employeeSchema, type EmployeeInput } from "@/lib/schemas/settings";
import { ROLES } from "@/lib/auth/rbac";
import {
  createEmployeeAction,
  deleteEmployeeAction,
  setEmployeeArchivedAction,
  updateEmployeeAction,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/field";
import { deleteBtnClass, editBtnClass } from "./services-section";

export interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  isPractitioner: boolean;
  isCaregiver: boolean;
  email: string;
  isActive: boolean;
  /** All roles held by this employee (one row per employee). */
  roles: string[];
}

export function EmployeesSection({
  employees,
  canEdit,
}: {
  employees: EmployeeRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({
    firstName: "",
    lastName: "",
    title: "",
    isPractitioner: false,
    isCaregiver: false,
    isActive: true,
    roles: [] as string[],
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  function openEdit(e: EmployeeRow) {
    setEdit({
      firstName: e.firstName,
      lastName: e.lastName,
      title: e.title ?? "",
      isPractitioner: e.isPractitioner,
      isCaregiver: e.isCaregiver,
      isActive: e.isActive,
      roles: [...e.roles],
    });
    setEditError(null);
    setEditingId(e.id);
  }

  function toggleRole(role: string) {
    setEdit((s) => ({
      ...s,
      roles: s.roles.includes(role)
        ? s.roles.filter((r) => r !== role)
        : [...s.roles, role],
    }));
  }

  function saveEdit() {
    if (!editingId) return;
    setEditError(null);
    startTransition(async () => {
      const res = await updateEmployeeAction(editingId, edit);
      if (res.ok) {
        setEditingId(null);
        router.refresh();
      } else {
        setEditError(res.error ?? "Could not save employee.");
      }
    });
  }

  function setArchived(e: EmployeeRow, archive: boolean) {
    setDeleteError(null);
    startTransition(async () => {
      const res = await setEmployeeArchivedAction(e.id, archive);
      if (res.ok) router.refresh();
      else setDeleteError(res.error ?? "Could not update employee.");
    });
  }

  function remove(e: EmployeeRow) {
    if (
      !window.confirm(
        `Delete employee "${e.firstName} ${e.lastName}"? If they have any history (appointments, notes, payments…), they can only be deactivated.`,
      )
    )
      return;
    setDeleteError(null);
    startTransition(async () => {
      const res = await deleteEmployeeAction(e.id);
      if (res.ok) router.refresh();
      else setDeleteError(res.error ?? "Could not delete employee.");
    });
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EmployeeInput>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { role: "reception", isPractitioner: false, isCaregiver: false },
  });

  function onSubmit(values: EmployeeInput) {
    setMessage(null);
    startTransition(async () => {
      const res = await createEmployeeAction(values);
      if (res.ok) {
        // Clear every input so the form is ready for the next employee.
        reset({
          firstName: "",
          lastName: "",
          email: "",
          title: "",
          role: "reception",
          isPractitioner: false,
          isCaregiver: false,
        });
        setMessage("Employee created.");
      } else {
        setMessage(res.error ?? "Failed.");
      }
    });
  }

  const active = employees.filter((e) => e.isActive);
  const archived = employees.filter((e) => !e.isActive);

  const renderRow = (e: EmployeeRow) => (
    <li key={e.id} className="flex items-center justify-between p-3 text-sm">
      <div className={e.isActive ? "" : "opacity-60"}>
        <div className="font-medium">
          {e.firstName} {e.lastName}
          {e.title ? <span className="text-muted"> · {e.title}</span> : null}
        </div>
        <div className="text-xs text-muted">{e.email}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {e.roles.map((r) => (
          <span key={r} className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
            {r}
          </span>
        ))}
        {e.isPractitioner && (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-success">
            sees patients
          </span>
        )}
        {e.isCaregiver && (
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-primary-hover">
            caregiver
          </span>
        )}
        {!e.isActive && (
          <span className="rounded-full bg-border px-2 py-0.5 text-muted">
            archived
          </span>
        )}
        {canEdit && (
          <span className="flex gap-1.5">
            {e.isActive && (
              <button onClick={() => openEdit(e)} className={editBtnClass}>
                Edit
              </button>
            )}
            <button
              onClick={() => setArchived(e, e.isActive)}
              disabled={pending}
              className={editBtnClass}
            >
              {e.isActive ? "Archive" : "Unarchive"}
            </button>
            <button
              onClick={() => remove(e)}
              disabled={pending}
              className={deleteBtnClass}
            >
              Delete
            </button>
          </span>
        )}
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {active.length === 0 && (
          <li className="p-3 text-sm text-muted">No active employees.</li>
        )}
        {active.map(renderRow)}
      </ul>

      {archived.length > 0 && (
        <button
          onClick={() => setShowArchived((v) => !v)}
          className="text-sm text-primary hover:underline"
        >
          {showArchived
            ? "Hide archived"
            : `Show archived (${archived.length})`}
        </button>
      )}
      {showArchived && archived.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {archived.map(renderRow)}
        </ul>
      )}

      {deleteError && !editingId && (
        <p className="text-sm text-danger">{deleteError}</p>
      )}

      {canEdit && editingId && (
        <div className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-2">
          <div className="text-sm font-semibold sm:col-span-2">Edit employee</div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">First name</span>
            <input
              className={inputClass}
              value={edit.firstName}
              onChange={(e) => setEdit((s) => ({ ...s, firstName: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Last name</span>
            <input
              className={inputClass}
              value={edit.lastName}
              onChange={(e) => setEdit((s) => ({ ...s, lastName: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Title</span>
            <input
              className={inputClass}
              value={edit.title}
              onChange={(e) => setEdit((s) => ({ ...s, title: e.target.value }))}
            />
          </label>
          <div className="flex items-end gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={edit.isPractitioner}
                onChange={(e) =>
                  setEdit((s) => ({ ...s, isPractitioner: e.target.checked }))
                }
              />
              Practitioner
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={edit.isCaregiver}
                onChange={(e) =>
                  setEdit((s) => ({ ...s, isCaregiver: e.target.checked }))
                }
              />
              Caregiver
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={edit.isActive}
                onChange={(e) =>
                  setEdit((s) => ({ ...s, isActive: e.target.checked }))
                }
              />
              Active
            </label>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium">Roles</legend>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              {ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={edit.roles.includes(r)}
                    onChange={() => toggleRole(r)}
                  />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs text-muted sm:col-span-2">
            Deactivating blocks the account&apos;s access. Role changes apply to
            the person&apos;s next sign-in and are audited.
          </p>
          {editError && (
            <p className="text-sm text-danger sm:col-span-2">{editError}</p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={saveEdit} disabled={pending || !edit.firstName || !edit.lastName}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="ghost" onClick={() => setEditingId(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canEdit && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          noValidate
        >
          <Field label="First name" htmlFor="emp-first" error={errors.firstName?.message}>
            <Input id="emp-first" {...register("firstName")} />
          </Field>
          <Field label="Last name" htmlFor="emp-last" error={errors.lastName?.message}>
            <Input id="emp-last" {...register("lastName")} />
          </Field>
          <Field label="Email" htmlFor="emp-email" error={errors.email?.message}>
            <Input id="emp-email" type="email" {...register("email")} />
          </Field>
          <Field label="Title" htmlFor="emp-title">
            <Input id="emp-title" {...register("title")} />
          </Field>
          <Field label="Role" htmlFor="emp-role" error={errors.role?.message}>
            <select id="emp-role" className={inputClass} {...register("role")}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register("isPractitioner")} />
              Is practitioner
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...register("isCaregiver")} />
              Is caregiver (home care)
            </label>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? "Creating…" : "Create employee"}
            </Button>
            {message && <span className="ml-3 text-sm text-muted">{message}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
