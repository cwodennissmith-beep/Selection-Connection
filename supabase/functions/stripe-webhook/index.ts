// =============================================================================
// PIF Selection-Connection — stripe-webhook
// POST /stripe-webhook
// Receives Stripe webhook events. No auth header — uses Stripe signature
// verification instead.
//
// Handled events:
//   - checkout.session.completed  → mark order paid, generate download token,
//                                    create payout rows, send delivery email
//   - payment_intent.payment_failed → mark order failed
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verify the Stripe webhook signature.
 * Returns the parsed event object or null if verification fails.
 */
async function verifyStripeSignature(
  body: string,
  signature: string | null,
  secret: string
): Promise<Record<string, unknown> | null> {
  // TODO: Implement proper Stripe webhook signature verification
  // Use crypto.subtle to compute HMAC-SHA256 and compare with signature header
  //
  // The Stripe-Signature header contains:
  //   t=<timestamp>,v1=<signature>
  //
  // Steps:
  // 1. Parse t and v1 from the header
  // 2. Compute expected = HMAC-SHA256(secret, `${t}.${body}`)
  // 3. Compare expected with v1 using timing-safe comparison
  // 4. Verify timestamp is within tolerance (e.g., 5 minutes)

  if (!signature) {
    console.error("[stripe-webhook] Missing Stripe-Signature header");
    return null;
  }

  console.log("[stripe-webhook] TODO: Implement real Stripe signature verification");

  // Stub: parse the body as JSON and trust it (UNSAFE — replace before production)
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Send the file delivery email via Resend.
 */
async function sendDeliveryEmail(
  buyerEmail: string,
  fileTitle: string,
  downloadUrl: string
): Promise<boolean> {
  // TODO: Implement Resend email delivery
  // const resendApiKey = Deno.env.get("RESEND_API_KEY");
  //
  // const res = await fetch("https://api.resend.com/emails", {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     Authorization: `Bearer ${resendApiKey}`,
  //   },
  //   body: JSON.stringify({
  //     from: "PIF Marketplace <noreply@pif.market>",
  //     to: buyerEmail,
  //     subject: `Your PIF file is ready: ${fileTitle}`,
  //     html: `
  //       <h2>Your purchase is complete!</h2>
  //       <p>Thank you for purchasing <strong>${fileTitle}</strong>.</p>
  //       <p><a href="${downloadUrl}">Click here to download your file</a></p>
  //       <p>This link expires in 72 hours. You can request a new link from your account.</p>
  //     `,
  //   }),
  // });
  //
  // return res.ok;

  console.log("[stripe-webhook] TODO: Send delivery email to", buyerEmail);
  console.log("[stripe-webhook] File:", fileTitle, "Download URL:", downloadUrl);
  return true;
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

/**
 * Handle checkout.session.completed:
 * 1. Mark order as paid
 * 2. Generate download_token + expiry
 * 3. Create payout rows for each royalty chain member
 * 4. Send delivery email
 */
async function handleCheckoutCompleted(
  supabase: ReturnType<typeof createClient>,
  session: Record<string, unknown>
): Promise<Response> {
  const sessionId = session.id as string;
  const metadata = session.metadata as Record<string, string> | undefined;
  const fileId = metadata?.file_id;
  const buyerEmail = metadata?.buyer_email;

  if (!fileId || !buyerEmail) {
    console.error("[stripe-webhook] Missing metadata in checkout session:", sessionId);
    return new Response(JSON.stringify({ error: "Missing metadata" }), { status: 400 });
  }

  // ---- Find the order by stripe_session_id ----
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, file_id, total_cents, pif_fee_cents")
    .eq("stripe_session_id", sessionId)
    .single();

  if (orderError || !order) {
    console.error("[stripe-webhook] Order not found for session:", sessionId);
    return new Response(JSON.stringify({ error: "Order not found" }), { status: 404 });
  }

  // ---- Generate download token and expiry ----
  const downloadToken = crypto.randomUUID();
  const downloadExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72 hours

  // ---- Mark order as paid ----
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      payment_status: "paid",
      download_token: downloadToken,
      download_expires_at: downloadExpiresAt,
      paid_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateError) {
    console.error("[stripe-webhook] Failed to update order:", updateError.message);
    return new Response(JSON.stringify({ error: "Failed to update order" }), { status: 500 });
  }

  // ---- Fetch royalty chain for the file ----
  const { data: royaltyChain, error: royaltyError } = await supabase
    .from("file_royalty_chain")
    .select("member_id, share_basis_points, position")
    .eq("file_id", fileId)
    .order("position", { ascending: true });

  if (royaltyError) {
    console.error("[stripe-webhook] Failed to fetch royalty chain:", royaltyError.message);
  }

  // ---- Create payout rows ----
  if (royaltyChain && royaltyChain.length > 0) {
    const basePriceCents = order.total_cents - order.pif_fee_cents;
    const payoutRows = royaltyChain.map((entry) => ({
      order_id: order.id,
      member_id: entry.member_id,
      amount_cents: Math.round((basePriceCents * entry.share_basis_points) / 10000),
      status: "pending", // TODO: Process payouts via Stripe Transfer
    }));

    const { error: payoutError } = await supabase.from("payouts").insert(payoutRows);
    if (payoutError) {
      console.error("[stripe-webhook] Failed to create payouts:", payoutError.message);
      // Non-fatal — order is still marked paid. Payouts can be retried.
    }
  }

  // ---- Send delivery email ----
  // TODO: Build proper download URL using PUBLIC_SITE_URL
  const downloadUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/download?token=${downloadToken}`;

  const { data: fileRow } = await supabase
    .from("files")
    .select("title")
    .eq("id", fileId)
    .single();

  await sendDeliveryEmail(buyerEmail, fileRow?.title ?? "Untitled", downloadUrl);

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

/**
 * Handle payment_intent.payment_failed:
 * Mark the order as failed.
 */
async function handlePaymentFailed(
  supabase: ReturnType<typeof createClient>,
  paymentIntent: Record<string, unknown>
): Promise<Response> {
  // TODO: The payment intent ID needs to be matched to an order.
  // Stripe Checkout Sessions embed the payment_intent, so we may need to
  // look up via the checkout session metadata or store the PI ID on the order.

  const piId = paymentIntent.id as string;
  console.log("[stripe-webhook] Payment failed for PI:", piId);

  // TODO: Find and update the order
  // const { error } = await supabase
  //   .from("orders")
  //   .update({ payment_status: "failed" })
  //   .eq("stripe_payment_intent_id", piId);

  console.log("[stripe-webhook] TODO: Map payment_intent to order and mark as failed");

  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // ---- CORS preflight ----
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- Method guard ----
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Read raw body for signature verification ----
    const body = await req.text();
    const signature = req.headers.get("Stripe-Signature");

    // ---- Verify Stripe signature ----
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
    const event = await verifyStripeSignature(body, signature, webhookSecret);

    if (!event) {
      return new Response(
        JSON.stringify({ error: "Invalid webhook signature" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Init Supabase admin client ----
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ---- Route by event type ----
    const eventType = event.type as string;
    const eventData = (event.data as Record<string, unknown>)?.object as Record<string, unknown>;

    console.log("[stripe-webhook] Received event:", eventType);

    switch (eventType) {
      case "checkout.session.completed":
        return await handleCheckoutCompleted(supabaseAdmin, eventData);

      case "payment_intent.payment_failed":
        return await handlePaymentFailed(supabaseAdmin, eventData);

      default:
        // Acknowledge unhandled events so Stripe doesn't retry
        console.log("[stripe-webhook] Unhandled event type:", eventType);
        return new Response(
          JSON.stringify({ received: true, handled: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

  } catch (err) {
    console.error("[stripe-webhook] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
