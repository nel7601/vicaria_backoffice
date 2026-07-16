"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  companySettingsSchema,
  type CompanySettingsInput,
} from "@/lib/schemas/settings";
import { updateCompanySettingsAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function CompanyForm({
  defaults,
  canEdit,
}: {
  defaults: Partial<CompanySettingsInput>;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CompanySettingsInput>({
    resolver: zodResolver(companySettingsSchema),
    defaultValues: {
      timezone: "America/Toronto",
      currency: "CAD",
      invoiceNumberPrefix: "INV-",
      ...defaults,
    },
  });

  function onSubmit(values: CompanySettingsInput) {
    setMessage(null);
    startTransition(async () => {
      const res = await updateCompanySettingsAction(values);
      setMessage(res.ok ? "Saved." : (res.error ?? "Save failed."));
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Legal name" htmlFor="legalName" error={errors.legalName?.message}>
          <Input id="legalName" disabled={!canEdit} {...register("legalName")} />
        </Field>
        <Field label="Operating name" htmlFor="operatingName">
          <Input id="operatingName" disabled={!canEdit} {...register("operatingName")} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" disabled={!canEdit} {...register("email")} />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" disabled={!canEdit} {...register("phone")} />
        </Field>
        <Field label="Website" htmlFor="website" error={errors.website?.message}>
          <Input id="website" disabled={!canEdit} {...register("website")} />
        </Field>
        <Field label="Invoice number prefix" htmlFor="invoiceNumberPrefix">
          <Input id="invoiceNumberPrefix" disabled={!canEdit} {...register("invoiceNumberPrefix")} />
        </Field>
        <Field label="Timezone" htmlFor="timezone">
          <Input id="timezone" disabled={!canEdit} {...register("timezone")} />
        </Field>
        <Field label="Currency" htmlFor="currency" error={errors.currency?.message}>
          <Input id="currency" disabled={!canEdit} {...register("currency")} />
        </Field>
      </div>
      <Field label="Legal footer (EN)" htmlFor="legalFooterEn">
        <Input id="legalFooterEn" disabled={!canEdit} {...register("legalFooterEn")} />
      </Field>
      <Field label="Legal footer (ES)" htmlFor="legalFooterEs">
        <Input id="legalFooterEs" disabled={!canEdit} {...register("legalFooterEs")} />
      </Field>

      {message && <p className="text-sm text-muted">{message}</p>}
      {canEdit && (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save company settings"}
        </Button>
      )}
    </form>
  );
}
