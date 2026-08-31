import { headers } from "next/headers";

/**
 * The origin this deployment is reached at.
 *
 * Prefers the configured site URL, then the deployment's own production
 * domain, and only then the request being served — which is right in local
 * development and wrong for a preview deployment building a link somebody
 * keeps. See docs/runbooks/deploy.md.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "";
}

/**
 * The same, for a route handler that already has the request — no `headers()`
 * call, and correct even when the feed is fetched by a calendar client.
 */
export function publicOrigin(request: { nextUrl: URL }): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  return request.nextUrl.origin;
}
