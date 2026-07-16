import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { services } from "@/lib/db/schema";

export async function listActiveServices(organizationId: string) {
  const db = getDb();
  return db
    .select({
      id: services.id,
      nameEn: services.nameEn,
      nameEs: services.nameEs,
      defaultDurationMinutes: services.defaultDurationMinutes,
    })
    .from(services)
    .where(
      and(eq(services.organizationId, organizationId), eq(services.isActive, true)),
    );
}
