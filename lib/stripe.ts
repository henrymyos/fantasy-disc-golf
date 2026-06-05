import crypto from "crypto";

// Dependency-free Stripe integration via the REST API, so dues payments don't
// pull in the Stripe SDK. Everything is gated on STRIPE_SECRET_KEY — when it's
// unset, the app falls back to the commissioner's manual paid/unpaid tracking.

export function stripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Creates a one-off Checkout Session for a member's league dues and returns the
 * hosted payment URL. Amount is in dollars; converted to cents here.
 */
export async function createDuesCheckoutSession(opts: {
  leagueId: number;
  memberId: number;
  leagueName: string;
  amountDollars: number;
}): Promise<string> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe is not configured");

  const base = siteUrl();
  const cents = Math.round(opts.amountDollars * 100);

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", `${base}/league/${opts.leagueId}?dues=paid`);
  form.set("cancel_url", `${base}/league/${opts.leagueId}?dues=cancelled`);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(cents));
  form.set("line_items[0][price_data][product_data][name]", `League dues — ${opts.leagueName}`);
  form.set("metadata[leagueId]", String(opts.leagueId));
  form.set("metadata[memberId]", String(opts.memberId));
  form.set("client_reference_id", `${opts.leagueId}:${opts.memberId}`);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe checkout failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("Stripe did not return a checkout URL");
  return data.url;
}

/**
 * Verifies a Stripe webhook signature (the `stripe-signature` header) against
 * the raw request body using STRIPE_WEBHOOK_SECRET. Returns the parsed event
 * when valid, otherwise null.
 */
export function verifyAndParseEvent(rawBody: string, signatureHeader: string | null): any | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return null;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k, v];
    }),
  );
  const timestamp = parts["t"];
  const sig = parts["v1"];
  if (!timestamp || !sig) return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Reject events older than 5 minutes (replay protection).
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return null;

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}
