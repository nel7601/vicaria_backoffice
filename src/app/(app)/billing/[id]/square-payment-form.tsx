"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/domain/money";
import { paySquareCardAction } from "../actions";

/**
 * Card payment via Square Web Payments SDK (spec §10.1, PCI SAQ A):
 * Square's iframe fields collect the card, `tokenize()` returns a one-time
 * token, and the server action charges it. Card data never touches our code.
 */

export interface SquareClientConfig {
  applicationId: string;
  locationId: string;
  environment: "production" | "sandbox";
}

interface SquareCard {
  attach(target: string | HTMLElement): Promise<void>;
  tokenize(): Promise<{
    status: string;
    token?: string;
    errors?: { message?: string }[];
  }>;
  destroy(): Promise<void>;
}

interface SquareSdk {
  payments(
    applicationId: string,
    locationId: string,
  ): { card(): Promise<SquareCard> };
}

declare global {
  interface Window {
    Square?: SquareSdk;
  }
}

export function SquarePaymentForm({
  invoiceId,
  amountCents,
  config,
}: {
  invoiceId: string;
  amountCents: number;
  config: SquareClientConfig;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<SquareCard | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sdkUrl =
    config.environment === "production"
      ? "https://web.squarecdn.com/v1/square.js"
      : "https://sandbox.web.squarecdn.com/v1/square.js";

  useEffect(() => {
    if (!sdkReady || !containerRef.current) return;
    let cancelled = false;
    let card: SquareCard | null = null;

    (async () => {
      try {
        const payments = window.Square!.payments(
          config.applicationId,
          config.locationId,
        );
        card = await payments.card();
        if (cancelled || !containerRef.current) {
          await card.destroy();
          return;
        }
        await card.attach(containerRef.current);
        cardRef.current = card;
        setCardReady(true);
      } catch (e) {
        console.error("Square card form failed to load:", e);
        setMessage(
          "The card form could not be loaded. Check the Square configuration.",
        );
      }
    })();

    return () => {
      cancelled = true;
      setCardReady(false);
      cardRef.current = null;
      card?.destroy().catch(() => {});
    };
  }, [sdkReady, config.applicationId, config.locationId]);

  async function charge() {
    const card = cardRef.current;
    if (!card || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await card.tokenize();
      if (result.status !== "OK" || !result.token) {
        setMessage(
          result.errors?.[0]?.message ??
            "The card details are incomplete or invalid.",
        );
        return;
      }
      const res = await paySquareCardAction(invoiceId, {
        sourceId: result.token,
      });
      if (res.ok) {
        setMessage("Card charged — payment applied and receipt issued.");
        router.refresh();
      } else {
        setMessage(res.error ?? "Card payment failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      {/* onReady also fires when the SDK was already loaded by a previous mount. */}
      <Script src={sdkUrl} onReady={() => setSdkReady(true)} />
      {/* Square's iframe card fields mount here. */}
      <div ref={containerRef} />
      {!cardReady && !message && (
        <p className="text-xs text-muted">Loading secure card form…</p>
      )}
      <Button disabled={!cardReady || busy} onClick={charge}>
        {busy ? "Charging…" : `Charge ${formatCents(amountCents)}`}
      </Button>
      {message && <p className="text-sm text-muted">{message}</p>}
      <p className="text-xs text-muted">
        The card is processed by Square; card numbers never reach this system.
      </p>
    </div>
  );
}
