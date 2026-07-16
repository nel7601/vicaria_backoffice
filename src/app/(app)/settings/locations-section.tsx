"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { locationSchema, type LocationInput } from "@/lib/schemas/settings";
import { createLocationAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export interface LocationRow {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
}

export function LocationsSection({
  locations,
  canEdit,
}: {
  locations: LocationRow[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LocationInput>({
    resolver: zodResolver(locationSchema),
    defaultValues: { timezone: "America/Toronto" },
  });

  function onSubmit(values: LocationInput) {
    setMessage(null);
    startTransition(async () => {
      const res = await createLocationAction(values);
      if (res.ok) {
        reset({ name: "", address: "", phone: "", timezone: "America/Toronto" });
        setMessage("Location added.");
      } else {
        setMessage(res.error ?? "Failed.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-md border border-border">
        {locations.length === 0 && (
          <li className="p-3 text-sm text-muted">No locations yet.</li>
        )}
        {locations.map((l) => (
          <li key={l.id} className="flex items-center justify-between p-3 text-sm">
            <div>
              <div className="font-medium">{l.name}</div>
              <div className="text-xs text-muted">
                {[l.address, l.phone, l.timezone].filter(Boolean).join(" · ")}
              </div>
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
          <Field label="Name" htmlFor="loc-name" error={errors.name?.message}>
            <Input id="loc-name" {...register("name")} />
          </Field>
          <Field label="Phone" htmlFor="loc-phone">
            <Input id="loc-phone" {...register("phone")} />
          </Field>
          <Field label="Address" htmlFor="loc-address">
            <Input id="loc-address" {...register("address")} />
          </Field>
          <Field label="Timezone" htmlFor="loc-tz">
            <Input id="loc-tz" {...register("timezone")} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? "Adding…" : "Add location"}
            </Button>
            {message && <span className="ml-3 text-sm text-muted">{message}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
