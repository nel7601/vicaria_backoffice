"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { authorize } from "@/lib/auth/authorize";
import { recordAudit } from "@/lib/audit/record";
import { getDb } from "@/lib/db";
import { calendarFeedTokens, companySettings } from "@/lib/db/schema";
import { getPrimaryOrganization } from "@/lib/db/queries/organization";

export interface CalendarSyncResult {
  ok: boolean;
  error?: string;
  /** The subscription URL, returned only when it was just created. */
  url?: string;
}

/** 256 bits, URL-safe: the link is the credential, so guessing must be hopeless. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Give an employee a subscription link, replacing any live one.
 *
 * Rotation is the same operation as creation: the old token is revoked rather
 * than deleted, so a link that leaked stays dead and the audit trail still
 * shows it existed.
 */
export async function issueCalendarFeedAction(
  employeeId: string,
): Promise<CalendarSyncResult> {
  const user = await authorize("configuration", "update");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const token = newToken();

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(calendarFeedTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(calendarFeedTokens.organizationId, org.id),
            eq(calendarFeedTokens.employeeId, employeeId),
            isNull(calendarFeedTokens.revokedAt),
          ),
        );
      await tx.insert(calendarFeedTokens).values({
        organizationId: org.id,
        employeeId,
        token,
      });
    });
  } catch (e) {
    console.error("Calendar feed issue failed:", e);
    return { ok: false, error: "Could not create the calendar link." };
  }

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "create",
    entityType: "calendar_feed_token",
    entityId: employeeId,
  });

  revalidatePath("/settings");
  return { ok: true, url: `/api/calendar/${token}.ics` };
}

/** Kill an employee's link without issuing another. */
export async function revokeCalendarFeedAction(
  employeeId: string,
): Promise<CalendarSyncResult> {
  const user = await authorize("configuration", "update");
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  await db
    .update(calendarFeedTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(calendarFeedTokens.organizationId, org.id),
        eq(calendarFeedTokens.employeeId, employeeId),
        isNull(calendarFeedTokens.revokedAt),
      ),
    );

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "delete",
    entityType: "calendar_feed_token",
    entityId: employeeId,
    reason: "Calendar subscription revoked via Settings",
  });

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Choose how much a calendar event may say about the patient.
 *
 * Audited as a permission change, not a preference: raising it copies patient
 * names onto servers outside the clinic's control, and that decision should be
 * as traceable as granting someone access.
 */
export async function setCalendarFeedDetailAction(
  detail: "minimal" | "initials" | "full",
): Promise<CalendarSyncResult> {
  const user = await authorize("configuration", "update");
  if (!["minimal", "initials", "full"].includes(detail)) {
    return { ok: false, error: "Unknown detail level." };
  }
  const org = await getPrimaryOrganization();
  if (!org) return { ok: false, error: "Organization not found." };

  const db = getDb();
  const [before] = await db
    .select({ detail: companySettings.calendarFeedDetail })
    .from(companySettings)
    .where(eq(companySettings.organizationId, org.id))
    .limit(1);

  await db
    .update(companySettings)
    .set({ calendarFeedDetail: detail, updatedAt: new Date() })
    .where(eq(companySettings.organizationId, org.id));

  await recordAudit({
    organizationId: org.id,
    actorUserId: user.authId,
    action: "update",
    entityType: "calendar_feed_detail",
    entityId: org.id,
    before: { detail: before?.detail ?? null },
    after: { detail },
  });

  revalidatePath("/settings");
  return { ok: true };
}
