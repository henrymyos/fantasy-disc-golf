import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAndParseEvent } from "@/lib/stripe";

// Stripe webhook for dues payments. Verifies the signature against
// STRIPE_WEBHOOK_SECRET, then on a completed checkout marks the paying member's
// dues as paid (after verifying the amount), and on a refund/dispute clears
// them again. Must read the raw body for signature verification, so this route
// is dynamic and never cached.

export const dynamic = "force-dynamic";

// Stripe metadata values arrive as strings. Pull leagueId/memberId out of a
// metadata bag, returning null unless both are present and numeric.
function resolveMember(meta: any): { leagueId: number; memberId: number } | null {
  const leagueId = Number(meta?.leagueId);
  const memberId = Number(meta?.memberId);
  if (Number.isFinite(leagueId) && Number.isFinite(memberId)) {
    return { leagueId, memberId };
  }
  return null;
}

// Refunds and disputes arrive as Charge/Dispute events, which do NOT carry the
// checkout-session metadata we set (it lives on the Session, not the Charge or
// PaymentIntent). Resolve the member by looking the originating Checkout Session
// up by its PaymentIntent. Returns null (handler no-ops) if Stripe isn't
// configured or the session can't be found.
async function resolveMemberFromPaymentIntent(
  paymentIntent: unknown,
): Promise<{ leagueId: number; memberId: number } | null> {
  const secret = process.env.STRIPE_SECRET_KEY;
  const pi =
    typeof paymentIntent === "string"
      ? paymentIntent
      : (paymentIntent as any)?.id;
  if (!secret || !pi) return null;

  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions?payment_intent=${encodeURIComponent(pi)}&limit=1`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: Array<{ metadata?: any }> };
  const session = data.data?.[0];
  return session ? resolveMember(session.metadata) : null;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  const event = verifyAndParseEvent(rawBody, signature);
  if (!event) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    const member = resolveMember(session.metadata);
    // Gate strictly on payment_status. For a checkout.session.completed event
    // session.status is ALWAYS "complete" (even for unpaid/async/expired
    // sessions), so OR-ing it in would mark dues paid without payment. Treat a
    // genuinely free ($0) session as paid too.
    const paid =
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required";

    if (paid && member) {
      const admin = createAdminClient();

      // Amount verification: session.amount_total is in cents, while the
      // league's dues_amount is stored in dollars (see createDuesCheckoutSession
      // in lib/stripe.ts). Only mark paid when the charged amount matches the
      // configured dues, so a tampered/mispriced session can't satisfy dues. A
      // null/zero dues_amount means dues aren't configured -> never mark paid.
      const { data: league } = await admin
        .from("leagues")
        .select("dues_amount")
        .eq("id", member.leagueId)
        .single();
      const dues = (league as any)?.dues_amount;
      const expectedCents =
        dues != null && Number.isFinite(Number(dues)) && Number(dues) > 0
          ? Math.round(Number(dues) * 100)
          : null;
      const amountTotal = Number(session.amount_total);

      if (
        expectedCents === null ||
        !Number.isFinite(amountTotal) ||
        amountTotal !== expectedCents
      ) {
        console.warn(
          `[stripe-webhook] amount mismatch for member ${member.memberId} in league ${member.leagueId}: got ${session.amount_total}, expected ${expectedCents}`,
        );
        return NextResponse.json({ received: true, ignored: "amount_mismatch" });
      }

      // Idempotent timestamp: only stamp dues_paid_at on the transition to paid,
      // so a duplicate webhook delivery doesn't overwrite the original payment
      // time. Leave an existing timestamp untouched.
      const { data: existing } = await admin
        .from("league_members")
        .select("dues_paid_at")
        .eq("id", member.memberId)
        .eq("league_id", member.leagueId)
        .single();

      const update: { dues_paid: boolean; dues_paid_at?: string } = {
        dues_paid: true,
      };
      if (!(existing as any)?.dues_paid_at) {
        update.dues_paid_at = new Date().toISOString();
      }

      await admin
        .from("league_members")
        .update(update)
        .eq("id", member.memberId)
        .eq("league_id", member.leagueId);
    }
  } else if (
    event.type === "charge.refunded" ||
    event.type === "charge.dispute.created"
  ) {
    // For charge.refunded the object is a Charge; for charge.dispute.created
    // it's a Dispute. Both expose payment_intent. Prefer metadata on the object
    // (forward-compatible if payment_intent_data metadata is ever added), then
    // fall back to resolving the Checkout Session via the PaymentIntent.
    const object = event.data?.object ?? {};
    const member =
      resolveMember(object.metadata) ??
      (await resolveMemberFromPaymentIntent(object.payment_intent));

    if (member) {
      const admin = createAdminClient();
      await admin
        .from("league_members")
        .update({ dues_paid: false, dues_paid_at: null })
        .eq("id", member.memberId)
        .eq("league_id", member.leagueId);
    }
  }

  return NextResponse.json({ received: true });
}
