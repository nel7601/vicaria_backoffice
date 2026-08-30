import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import {
  appointments,
  employees,
  followUpTasks,
  invoices,
  patients,
  payments,

} from "@/lib/db/schema";
import {
  changeAppointmentStatus,
  createAppointment,
  rescheduleAppointment,
} from "@/lib/domain/appointments/commands";
import {
  formatPatientNumber,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from "@/lib/domain/patient";
import { nextPatientSequence } from "@/lib/db/queries/patients";
import { zonedInstantUtc } from "@/lib/domain/timezone";
import { defineAction, type ActionContext } from "./catalog";

/**
 * Every write the assistant can propose.
 *
 * Ordered roughly by how much damage a mistake does, which is also the order
 * in which they should be switched on. The financial and clinical ones are
 * marked irreversible: they are included because this is an experiment on test
 * data, and they are the first things to reconsider before real records.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Name a patient the way the person confirming would recognise them. */
async function describePatient(id: string, ctx: ActionContext): Promise<string> {
  const [p] = await getDb()
    .select({
      first: patients.legalFirstName,
      last: patients.legalLastName,
      preferred: patients.preferredName,
    })
    .from(patients)
    .where(
      and(eq(patients.id, id), eq(patients.organizationId, ctx.principal.organizationId)),
    )
    .limit(1);
  if (!p) return "un paciente desconocido";
  const legal = `${p.first} ${p.last}`.trim();
  return p.preferred ? `${p.preferred} (${legal})` : legal;
}

function whenText(at: Date, ctx: ActionContext): string {
  return new Intl.DateTimeFormat(ctx.principal.locale === "es" ? "es-CA" : "en-CA", {
    timeZone: ctx.timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(at);
}

function money(cents: number): string {
  return `${(cents / 100).toFixed(2)} CAD`;
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export const createAppointmentAction = defineAction({
  name: "create_appointment",
  description:
    "Propose booking a new appointment. Needs the patient, the practitioner, the day and " +
    "the 24-hour clinic-local time. Ask if am/pm was ambiguous rather than guessing.",
  resource: "patients_demographic",
  action: "create",
  input: z.object({
    patientId: z.uuid(),
    employeeId: z.uuid(),
    serviceId: z.uuid().optional(),
    day,
    hour: z.int().min(0).max(23),
    minute: z.int().min(0).max(59).default(0),
    durationMinutes: z.int().min(5).max(480).default(60),
  }),

  async prepare(args, ctx) {
    const startAt = zonedInstantUtc(args.day, args.hour, args.minute, ctx.timeZone);
    if (startAt <= ctx.now) {
      return { ok: false, reason: "Esa hora ya pasó. Confirma la fecha con el usuario." };
    }
    const endAt = new Date(startAt.getTime() + args.durationMinutes * 60_000);

    const db = getDb();
    const [staff] = await db
      .select({ first: employees.firstName, last: employees.lastName })
      .from(employees)
      .where(eq(employees.id, args.employeeId))
      .limit(1);
    if (!staff) return { ok: false, reason: "Ese profesional no existe." };

    const who = await describePatient(args.patientId, ctx);
    return {
      ok: true,
      summary:
        `Agendar cita de ${who} con ${staff.first} ${staff.last} ` +
        `el ${whenText(startAt, ctx)} (${args.durationMinutes} min)`,
      arguments: {
        patientId: args.patientId,
        employeeId: args.employeeId,
        serviceId: args.serviceId ?? null,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      },
    };
  },

  async perform(stored, ctx) {
    const result = await createAppointment(
      { principal: ctx.principal, now: ctx.now },
      {
        patientId: String(stored.patientId),
        employeeId: String(stored.employeeId),
        serviceId: (stored.serviceId as string | null) ?? null,
        startAt: new Date(String(stored.startAt)),
        endAt: new Date(String(stored.endAt)),
        modality: "in_person",
      },
    );
    if (!result.ok) return { ok: false, reason: result.error };
    return {
      ok: true,
      result: { appointmentId: result.appointmentId },
      message: "Listo, la cita quedó agendada.",
    };
  },
});

export const cancelAppointmentAction = defineAction({
  name: "cancel_appointment",
  description:
    "Propose cancelling an appointment. A reason is required — it is recorded and shown " +
    "in the appointment's history.",
  resource: "patients_demographic",
  action: "update",
  input: z.object({
    appointmentId: z.uuid(),
    reason: z.string().trim().min(3).max(300),
  }),

  async prepare(args, ctx) {
    const [appt] = await getDb()
      .select({
        startAt: appointments.startAt,
        status: appointments.status,
        patientId: appointments.patientId,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.id, args.appointmentId),
          eq(appointments.organizationId, ctx.principal.organizationId),
        ),
      )
      .limit(1);

    if (!appt) return { ok: false, reason: "Esa cita no existe." };
    if (["cancelled", "completed", "no_show"].includes(appt.status)) {
      return { ok: false, reason: `Esa cita ya está ${appt.status}.` };
    }

    const who = await describePatient(appt.patientId, ctx);
    return {
      ok: true,
      summary: `Cancelar la cita de ${who} del ${whenText(appt.startAt, ctx)}. Motivo: ${args.reason}`,
      arguments: { appointmentId: args.appointmentId, reason: args.reason },
    };
  },

  async perform(stored, ctx) {
    const result = await changeAppointmentStatus(
      { principal: ctx.principal, now: ctx.now },
      {
        appointmentId: String(stored.appointmentId),
        status: "cancelled",
        reason: String(stored.reason),
      },
    );
    if (!result.ok) return { ok: false, reason: result.error };
    return { ok: true, result: { appointmentId: result.appointmentId }, message: "Cita cancelada." };
  },
});

export const changeAppointmentStatusAction = defineAction({
  name: "change_appointment_status",
  description:
    "Propose moving an appointment through its lifecycle: confirmed, checked_in, " +
    "in_progress, completed, or no_show. Transitions are validated; not every jump is legal.",
  resource: "patients_demographic",
  action: "update",
  input: z.object({
    appointmentId: z.uuid(),
    status: z.enum(["confirmed", "checked_in", "in_progress", "completed", "no_show"]),
    reason: z.string().trim().max(300).optional(),
  }),

  async prepare(args, ctx) {
    const [appt] = await getDb()
      .select({
        startAt: appointments.startAt,
        status: appointments.status,
        patientId: appointments.patientId,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.id, args.appointmentId),
          eq(appointments.organizationId, ctx.principal.organizationId),
        ),
      )
      .limit(1);
    if (!appt) return { ok: false, reason: "Esa cita no existe." };

    const who = await describePatient(appt.patientId, ctx);
    return {
      ok: true,
      summary:
        `Marcar la cita de ${who} del ${whenText(appt.startAt, ctx)} ` +
        `como ${args.status} (ahora está ${appt.status})`,
      arguments: {
        appointmentId: args.appointmentId,
        status: args.status,
        reason: args.reason ?? null,
      },
    };
  },

  async perform(stored, ctx) {
    const result = await changeAppointmentStatus(
      { principal: ctx.principal, now: ctx.now },
      {
        appointmentId: String(stored.appointmentId),
        status: stored.status as "confirmed",
        reason: (stored.reason as string | null) ?? undefined,
      },
    );
    if (!result.ok) return { ok: false, reason: result.error };
    return { ok: true, result: { appointmentId: result.appointmentId }, message: "Estado actualizado." };
  },
});

export const rescheduleAction = defineAction({
  name: "reschedule_appointment",
  description:
    "Propose moving an existing appointment to a new day and time. The original is closed " +
    "and a new one created linked to it, so the move stays visible in the history.",
  resource: "patients_demographic",
  action: "update",
  input: z.object({
    appointmentId: z.uuid(),
    day,
    hour: z.int().min(0).max(23),
    minute: z.int().min(0).max(59).default(0),
  }),

  async prepare(args, ctx) {
    const [appt] = await getDb()
      .select({
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        status: appointments.status,
        patientId: appointments.patientId,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.id, args.appointmentId),
          eq(appointments.organizationId, ctx.principal.organizationId),
        ),
      )
      .limit(1);

    if (!appt) return { ok: false, reason: "Esa cita no existe." };
    if (!["scheduled", "confirmed", "checked_in"].includes(appt.status)) {
      return { ok: false, reason: `Esa cita está ${appt.status} y ya no se puede mover.` };
    }

    const startAt = zonedInstantUtc(args.day, args.hour, args.minute, ctx.timeZone);
    if (startAt <= ctx.now) return { ok: false, reason: "Esa hora ya pasó." };
    // The move keeps the original length: the user asked to move it, not to
    // make it longer.
    const endAt = new Date(startAt.getTime() + (appt.endAt.getTime() - appt.startAt.getTime()));

    const who = await describePatient(appt.patientId, ctx);
    return {
      ok: true,
      summary: `Mover la cita de ${who} del ${whenText(appt.startAt, ctx)} al ${whenText(startAt, ctx)}`,
      arguments: {
        appointmentId: args.appointmentId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        patientId: appt.patientId,
      },
    };
  },

  async perform(stored, ctx) {
    const result = await rescheduleAppointment(
      { principal: ctx.principal, now: ctx.now },
      {
        appointmentId: String(stored.appointmentId),
        startAt: new Date(String(stored.startAt)),
        endAt: new Date(String(stored.endAt)),
        reason: "Reprogramada por el asistente",
      },
    );
    if (!result.ok) return { ok: false, reason: result.error };
    return {
      ok: true,
      result: {
        appointmentId: result.appointmentId,
        replacedAppointmentId: result.originalId,
        startAt: result.startAt.toISOString(),
      },
      message: "Listo, la cita quedó movida.",
    };
  },
});

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

export const createTaskAction = defineAction({
  name: "create_follow_up_task",
  description:
    "Propose creating a follow-up task for a patient: call them back, check a result, " +
    "chase a payment. Optionally assigned to someone and due on a date.",
  resource: "patients_demographic",
  action: "create",
  input: z.object({
    patientId: z.uuid(),
    title: z.string().trim().min(3).max(200),
    dueDay: day.optional(),
    assignToMe: z.boolean().default(true),
    priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  }),

  async prepare(args, ctx) {
    const who = await describePatient(args.patientId, ctx);
    const due = args.dueDay
      ? zonedInstantUtc(args.dueDay, 9, 0, ctx.timeZone)
      : null;
    return {
      ok: true,
      summary:
        `Crear tarea "${args.title}" para ${who}` +
        (due ? `, con vencimiento el ${whenText(due, ctx)}` : "") +
        (args.assignToMe ? ", asignada a ti" : ""),
      arguments: {
        patientId: args.patientId,
        title: args.title,
        dueDate: due?.toISOString() ?? null,
        assignedTo: args.assignToMe ? ctx.principal.employeeId : null,
        priority: args.priority,
      },
    };
  },

  async perform(stored, ctx) {
    const [row] = await getDb()
      .insert(followUpTasks)
      .values({
        organizationId: ctx.principal.organizationId,
        patientId: String(stored.patientId),
        title: String(stored.title),
        dueDate: stored.dueDate ? new Date(String(stored.dueDate)) : null,
        assignedTo: (stored.assignedTo as string | null) ?? null,
        priority: stored.priority as "normal",
        status: "open",
      })
      .returning();

    await recordAudit({
      organizationId: ctx.principal.organizationId,
      actorUserId: ctx.principal.dbUserId,
      action: "create",
      entityType: "follow_up_task",
      entityId: row.id,
      after: { title: row.title, source: "assistant" },
    });

    return { ok: true, result: { taskId: row.id }, message: "Tarea creada." };
  },
});

// ---------------------------------------------------------------------------
// Money — irreversible in the accounting sense
// ---------------------------------------------------------------------------

export const recordPaymentAction = defineAction({
  name: "record_payment",
  description:
    "Propose recording a payment received from a patient, optionally applied to an " +
    "invoice. Amounts are in cents. This is a financial record — state the amount and the " +
    "patient back to the user before confirming.",
  resource: "invoices_payments",
  action: "create",
  irreversible: true,
  input: z.object({
    patientId: z.uuid(),
    amountCents: z.int().min(1).max(100_000_00),
    method: z.enum(["cash", "e_transfer", "square_card", "debit", "credit", "other"]),
    invoiceId: z.uuid().optional(),
    reference: z.string().trim().max(120).optional(),
  }),

  async prepare(args, ctx) {
    const who = await describePatient(args.patientId, ctx);

    let against = "";
    if (args.invoiceId) {
      const [inv] = await getDb()
        .select({ number: invoices.invoiceNumber, balance: invoices.balanceCents })
        .from(invoices)
        .where(
          and(
            eq(invoices.id, args.invoiceId),
            eq(invoices.organizationId, ctx.principal.organizationId),
          ),
        )
        .limit(1);
      if (!inv) return { ok: false, reason: "Esa factura no existe." };
      against = `, aplicado a la factura ${inv.number ?? "(borrador)"} (saldo ${money(inv.balance)})`;
    }

    return {
      ok: true,
      summary: `Registrar un pago de ${money(args.amountCents)} de ${who} por ${args.method}${against}`,
      arguments: {
        patientId: args.patientId,
        amountCents: args.amountCents,
        method: args.method,
        invoiceId: args.invoiceId ?? null,
        reference: args.reference ?? null,
      },
    };
  },

  async perform(stored, ctx) {
    const db = getDb();
    const [row] = await db
      .insert(payments)
      .values({
        organizationId: ctx.principal.organizationId,
        patientId: String(stored.patientId),
        amountCents: Number(stored.amountCents),
        method: stored.method as "cash",
        // Recorded as received, not verified: an e-transfer still needs
        // someone to confirm it arrived, and the backoffice has a flow for it.
        status: stored.method === "e_transfer" ? "pending" : "confirmed",
        receivedAt: ctx.now,
        receivedBy: ctx.principal.dbUserId,
        reference: (stored.reference as string | null) ?? null,
      })
      .returning();

    await recordAudit({
      organizationId: ctx.principal.organizationId,
      actorUserId: ctx.principal.dbUserId,
      action: "create",
      entityType: "payment",
      entityId: row.id,
      after: { amountCents: row.amountCents, method: row.method, source: "assistant" },
      reason: "Payment recorded through the assistant",
    });

    return {
      ok: true,
      result: { paymentId: row.id, amountCents: row.amountCents, status: row.status },
      message: `Pago de ${money(row.amountCents)} registrado.`,
    };
  },
});

export const voidInvoiceAction = defineAction({
  name: "void_invoice",
  description:
    "Propose voiding an invoice. This cancels it for accounting purposes and cannot be " +
    "undone; a reason is required and is kept in the audit trail.",
  resource: "invoices_payments",
  action: "update",
  irreversible: true,
  input: z.object({
    invoiceId: z.uuid(),
    reason: z.string().trim().min(3).max(300),
  }),

  async prepare(args, ctx) {
    const [inv] = await getDb()
      .select({
        number: invoices.invoiceNumber,
        status: invoices.status,
        total: invoices.totalCents,
        paid: invoices.paidCents,
        patientId: invoices.patientId,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, args.invoiceId),
          eq(invoices.organizationId, ctx.principal.organizationId),
        ),
      )
      .limit(1);

    if (!inv) return { ok: false, reason: "Esa factura no existe." };
    if (inv.status === "void") return { ok: false, reason: "Esa factura ya está anulada." };
    if (inv.paid > 0) {
      // Voiding something already paid loses the link to the money received.
      return {
        ok: false,
        reason: `Esa factura tiene ${money(inv.paid)} cobrados. Hay que hacer un reembolso o una nota de crédito, no anularla.`,
      };
    }

    const who = await describePatient(inv.patientId, ctx);
    return {
      ok: true,
      summary:
        `ANULAR la factura ${inv.number ?? "(borrador)"} de ${who}, por ${money(inv.total)}. ` +
        `Es irreversible. Motivo: ${args.reason}`,
      arguments: { invoiceId: args.invoiceId, reason: args.reason },
    };
  },

  async perform(stored, ctx) {
    const db = getDb();
    const [row] = await db
      .update(invoices)
      .set({ status: "void", updatedAt: ctx.now })
      .where(
        and(
          eq(invoices.id, String(stored.invoiceId)),
          eq(invoices.organizationId, ctx.principal.organizationId),
        ),
      )
      .returning();

    if (!row) return { ok: false, reason: "Esa factura ya no existe." };

    await recordAudit({
      organizationId: ctx.principal.organizationId,
      actorUserId: ctx.principal.dbUserId,
      action: "void",
      entityType: "invoice",
      entityId: row.id,
      after: { status: "void", source: "assistant" },
      reason: String(stored.reason),
    });

    return { ok: true, result: { invoiceId: row.id }, message: "Factura anulada." };
  },
});

// ---------------------------------------------------------------------------
// Patient records
// ---------------------------------------------------------------------------

/** How a patient is shown back before anything is written about them. */
function contactLine(phone: string | null, email: string | null): string {
  const parts = [phone, email].filter(Boolean);
  return parts.length ? parts.join(" · ") : "sin datos de contacto";
}

export const createPatientAction = defineAction({
  name: "create_patient",
  description:
    "Propose creating a patient record. Needs at least the legal first and last name; " +
    "phone and email are how the clinic reaches them, so ask for one. Search first with " +
    "resolve_patient — someone who called before is already here under some spelling.",
  resource: "patients_demographic",
  action: "create",
  input: z.object({
    legalFirstName: z.string().trim().min(1).max(120),
    legalLastName: z.string().trim().min(1).max(120),
    preferredName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.email().max(255).optional(),
    dateOfBirth: day.optional(),
    preferredLanguage: z.enum(["en", "es"]).default("en"),
  }),

  async prepare(args, ctx) {
    const first = normalizeName(args.legalFirstName);
    const last = normalizeName(args.legalLastName);
    if (!first || !last) return { ok: false, reason: "Faltan el nombre y el apellido." };

    const phone = normalizePhone(args.phone);
    const email = normalizeEmail(args.email);
    if (args.phone && !phone) {
      return { ok: false, reason: "Ese teléfono no parece un número válido." };
    }

    // A duplicate is the ordinary failure here, not a rare one: the same
    // person calls twice and gets typed in twice. Refusing costs a question;
    // a second record splits their history in two.
    const twin = await getDb()
      .select({ id: patients.id, number: patients.patientNumber })
      .from(patients)
      .where(
        and(
          eq(patients.organizationId, ctx.principal.organizationId),
          eq(patients.legalFirstName, first),
          eq(patients.legalLastName, last),
        ),
      )
      .limit(1);
    if (twin.length) {
      return {
        ok: false,
        reason:
          `Ya existe ${first} ${last} (${twin[0].number}). ` +
          "Confirma con el usuario si es la misma persona antes de crear otra ficha.",
      };
    }

    const dob = args.dateOfBirth ? ` · nacido el ${args.dateOfBirth}` : "";
    return {
      ok: true,
      summary:
        `Crear la ficha de ${first} ${last}${dob} — ${contactLine(phone, email)}` +
        `, atención en ${args.preferredLanguage === "es" ? "español" : "inglés"}`,
      arguments: {
        legalFirstName: first,
        legalLastName: last,
        preferredName: normalizeName(args.preferredName),
        phone,
        email,
        dateOfBirth: args.dateOfBirth ?? null,
        preferredLanguage: args.preferredLanguage,
      },
    };
  },

  async perform(stored, ctx) {
    const db = getDb();
    // The sequence is derived from a count, so two records created in the
    // same second can pick the same number. The unique index catches it;
    // this retries rather than handing the user a constraint violation.
    for (let attempt = 0; attempt < 4; attempt++) {
      const seq = await nextPatientSequence(ctx.principal.organizationId);
      try {
        const [row] = await db
          .insert(patients)
          .values({
            organizationId: ctx.principal.organizationId,
            patientNumber: formatPatientNumber(seq + attempt),
            legalFirstName: String(stored.legalFirstName),
            legalLastName: String(stored.legalLastName),
            preferredName: (stored.preferredName as string | null) ?? null,
            phoneE164: (stored.phone as string | null) ?? null,
            email: (stored.email as string | null) ?? null,
            dateOfBirth: (stored.dateOfBirth as string | null) ?? null,
            preferredLanguage: stored.preferredLanguage as "en",
            status: "prospect",
          })
          .returning();

        await recordAudit({
          organizationId: ctx.principal.organizationId,
          actorUserId: ctx.principal.dbUserId,
          action: "create",
          entityType: "patient",
          entityId: row.id,
          after: { patientNumber: row.patientNumber, status: row.status },
        });

        return {
          ok: true,
          result: { patientId: row.id, patientNumber: row.patientNumber },
          message: `Listo, ${row.legalFirstName} ${row.legalLastName} queda con el número ${row.patientNumber}.`,
        };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "23505") throw error;
      }
    }
    return { ok: false, reason: "No se pudo asignar un número de paciente libre." };
  },
});

export const updatePatientContactAction = defineAction({
  name: "update_patient_contact",
  description:
    "Propose correcting how the clinic reaches a patient: phone, email or address. " +
    "Send only the fields that change; anything omitted is left as it is.",
  resource: "patients_demographic",
  action: "update",
  input: z
    .object({
      patientId: z.uuid(),
      phone: z.string().trim().max(40).optional(),
      email: z.email().max(255).optional(),
      address: z.string().trim().max(500).optional(),
    })
    .refine((v) => v.phone !== undefined || v.email !== undefined || v.address !== undefined, {
      message: "Send at least one field to change.",
    }),

  async prepare(args, ctx) {
    const [current] = await getDb()
      .select({
        phone: patients.phoneE164,
        email: patients.email,
        address: patients.address,
      })
      .from(patients)
      .where(
        and(
          eq(patients.id, args.patientId),
          eq(patients.organizationId, ctx.principal.organizationId),
        ),
      )
      .limit(1);
    if (!current) return { ok: false, reason: "Ese paciente no existe." };

    const phone = args.phone === undefined ? undefined : normalizePhone(args.phone);
    if (args.phone !== undefined && !phone) {
      return { ok: false, reason: "Ese teléfono no parece un número válido." };
    }
    const email = args.email === undefined ? undefined : normalizeEmail(args.email);

    // Each line says what it replaces. "Cambiar el teléfono" tells you
    // nothing; the old number is how you notice it is the wrong patient.
    const changes: string[] = [];
    if (phone !== undefined) {
      changes.push(`teléfono ${current.phone ?? "(vacío)"} → ${phone}`);
    }
    if (email !== undefined) {
      changes.push(`email ${current.email ?? "(vacío)"} → ${email}`);
    }
    if (args.address !== undefined) {
      changes.push(`dirección ${current.address ?? "(vacía)"} → ${args.address}`);
    }
    if (!changes.length) return { ok: false, reason: "No hay nada que cambiar." };

    const who = await describePatient(args.patientId, ctx);
    return {
      ok: true,
      summary: `Actualizar a ${who}: ${changes.join("; ")}`,
      arguments: {
        patientId: args.patientId,
        phone: phone ?? null,
        email: email ?? null,
        address: args.address ?? null,
        // Which fields were actually asked for. Without this a null meaning
        // "leave alone" is indistinguishable from one meaning "clear it".
        fields: [
          ...(phone !== undefined ? ["phone"] : []),
          ...(email !== undefined ? ["email"] : []),
          ...(args.address !== undefined ? ["address"] : []),
        ],
        before: {
          phone: current.phone,
          email: current.email,
          address: current.address,
        },
      },
    };
  },

  async perform(stored, ctx) {
    const fields = (stored.fields as string[]) ?? [];
    const patch: Record<string, unknown> = {};
    if (fields.includes("phone")) patch.phoneE164 = stored.phone;
    if (fields.includes("email")) patch.email = stored.email;
    if (fields.includes("address")) patch.address = stored.address;
    if (!Object.keys(patch).length) return { ok: false, reason: "No hay nada que cambiar." };

    const [row] = await getDb()
      .update(patients)
      .set(patch)
      .where(
        and(
          eq(patients.id, String(stored.patientId)),
          eq(patients.organizationId, ctx.principal.organizationId),
        ),
      )
      .returning({ id: patients.id });
    if (!row) return { ok: false, reason: "Ese paciente ya no existe." };

    await recordAudit({
      organizationId: ctx.principal.organizationId,
      actorUserId: ctx.principal.dbUserId,
      action: "update",
      entityType: "patient",
      entityId: row.id,
      before: stored.before as Record<string, unknown>,
      after: patch,
    });

    return { ok: true, result: { patientId: row.id }, message: "Listo, datos actualizados." };
  },
});
