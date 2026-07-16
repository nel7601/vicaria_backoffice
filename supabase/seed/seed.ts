/**
 * Synthetic seed for local/staging (spec S0-10). NEVER run against production
 * and NEVER use real PHI (§9.2). Populates the organization, a location,
 * settings, roles, services, packages and a handful of demo patients so the
 * app has data to render during development.
 *
 * Usage: DATABASE_URL=... npm run seed
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/lib/db/schema";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required to seed.");
  const client = postgres(url, { prepare: false });
  const db = drizzle(client, { schema });

  console.log("Seeding organization…");
  const [org] = await db
    .insert(schema.organizations)
    .values({
      legalName: "Vicaria Health Inc.",
      operatingName: "Vicaria Health",
      timezone: "America/Toronto",
      currency: "CAD",
    })
    .returning();

  await db.insert(schema.companySettings).values({
    organizationId: org.id,
    email: "hello@vicaria.example",
    invoiceNumberPrefix: "VIC-",
    invoiceNextSequence: 1000,
    taxConfig: { HST: { rate_bps: 1300 } },
  });

  const [location] = await db
    .insert(schema.locations)
    .values({
      organizationId: org.id,
      name: "Toronto Clinic",
      timezone: "America/Toronto",
    })
    .returning();

  console.log("Seeding services & package…");
  await db.insert(schema.services).values([
    {
      organizationId: org.id,
      nameEn: "Health Coaching Session",
      nameEs: "Sesión de Health Coaching",
      category: "coaching",
      defaultDurationMinutes: 60,
    },
    {
      organizationId: org.id,
      nameEn: "Skin Tag Removal",
      nameEs: "Extracción de Skin Tags",
      category: "skin",
      defaultDurationMinutes: 30,
    },
  ]);

  await db.insert(schema.packages).values({
    organizationId: org.id,
    nameEn: "Coaching 10-pack",
    nameEs: "Paquete Coaching x10",
    priceCents: 90000,
    totalSessions: 10,
    validityDays: 365,
  });

  console.log("Seeding demo patients…");
  await db.insert(schema.patients).values([
    {
      organizationId: org.id,
      patientNumber: "P-0001",
      legalFirstName: "Ada",
      legalLastName: "Lovelace",
      preferredLanguage: "en",
      status: "active",
      email: "ada@example.com",
    },
    {
      organizationId: org.id,
      patientNumber: "P-0002",
      legalFirstName: "María",
      legalLastName: "García",
      preferredLanguage: "es",
      status: "prospect",
      email: "maria@example.com",
    },
  ]);

  console.log(`Done. Organization ${org.id}, location ${location.id}.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
