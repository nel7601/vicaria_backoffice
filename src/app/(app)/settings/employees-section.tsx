"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { employeeSchema, type EmployeeInput } from "@/lib/schemas/settings";
import { ROLES } from "@/lib/auth/rbac";
import { createEmployeeAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input, inputClass } from "@/components/ui/field";

export interface EmployeeRow {
  id: string;
  firstName: string;
  lastName: string;
  title: string | null;
  isPractitioner: boolean;
  email: string;
  isActive: boolean;
  role: string | null;
}

export function EmployeesSection({
  employees,
  canEdit,
}: {
  employees: EmployeeRow[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EmployeeInput>({
    resolver: zodResolver(employeeSchema),
    defaultValues: { role: "reception", isPractitioner: false },
  });

  function onSubmit(values: EmployeeInput) {
    setMessage(null);
    startTransition(async () => {
      const res = await createEmployeeAction(values);
      if (res.ok) {
        reset({ role: "reception", isPractitioner: false });
        setMessage("Employee created.");
      } else {
        setMessage(res.error ?? "Failed.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {employees.length === 0 && (
          <li className="p-3 text-sm text-muted">No employees yet.</li>
        )}
        {employees.map((e) => (
          <li key={e.id} className="flex items-center justify-between p-3 text-sm">
            <div>
              <div className="font-medium">
                {e.firstName} {e.lastName}
                {e.title ? (
                  <span className="text-muted"> · {e.title}</span>
                ) : null}
              </div>
              <div className="text-xs text-muted">{e.email}</div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {e.role && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                  {e.role}
                </span>
              )}
              {!e.isActive && (
                <span className="rounded-full bg-danger/10 px-2 py-0.5 text-danger">
                  inactive
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

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
