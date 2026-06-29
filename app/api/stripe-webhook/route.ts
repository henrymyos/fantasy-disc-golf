import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAndParseEvent } from "@/lib/stripe";

// Stripe webhook for dues payments. Verifies the signature against
// STRIPE_WEBHOOK_SECRET, then on a completed checkout marks the paying member's
// dues as paid. Must read the raw body for signature verification, so this
// route is dynamic and never cached.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  const event = verifyAndParseEvent(rawBody, signature);
  if (!event) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object ?? {};
    const meta = session.metadata ?? {};
    const leagueId = Number(meta.leagueId);
    const memberId = Number(meta.memberId);
    // Gate strictly on payment_status. For a checkout.session.completed event
    // session.status is ALWAYS "complete" (even for unpaid/async/expired
    // sessions), so OR-ing it in would mark dues paid without payment. Treat a
    // genuinely free ($0) session as paid too.
    const paid =
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required";

    if (paid && Number.isFinite(leagueId) && Number.isFinite(memberId)) {
      const admin = createAdminClient();
      await admin
        .from("league_members")
        .update({ dues_paid: true, dues_paid_at: new Date().toISOString() })
        .eq("id", memberId)
        .eq("league_id", leagueId);
    }
  }

  return NextResponse.json({ received: true });
}
