// =============================================================================
// PIF Selection-Connection — create-checkout
// POST /create-checkout
// Accepts: { file_id, buyer_email }
// Creates a Stripe Checkout Session for purchasing a marketplace file.
// Calculates royalty chain splits and PIF 10% platform fee.
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

/** Check whether marketplace_purchase is enabled via override_controls. */
async function isPurchaseEnabled(
  supabase: ReturnType<typeof createClient>
): Promise<boolean> {
  const { data, error } = await supabase
    .from("override_controls")
    .select("enabled")
    .eq("feature_key", "marketplace_purchase")
    .single();

  if (error || !data) return false;
  return data.enabled === true;
}

/**
 * Calculate the total price including PIF platform fee.
 * PIF takes 10% on top of the base price.
 *   total = base_price * 1.10
 * The application_fee_amount = total - sum_of_royalty_payouts
 */
function calculatePricing(priceCents: number, royaltyChain: Array<{ share_basis_points: number }>) {
  // Total charged to buyer = base price + 10% PIF fee
  const pifFeeMultiplier = 1.10;
  const totalCents = Math.round(priceCents * pifFeeMultiplier);
  const pifFeeCents = totalCents - priceCents;

  // Each royalty recipient gets their share of the base price
  const payouts = royaltyChain.map((entry) => ({
    ...entry,
    amount_cents: Math.round((priceCents * entry.share_basis_points) / 10000),
  }));

  return {
    total_cents: totalCents,
    pif_fee_cents: pifFeeCents,
    base_price_cents: priceCents,
    payouts,
  };
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

    // ---- Init Supabase admin client ----
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ---- Parse request body ----
    const { file_id, buyer_email } = await req.json();

    if (!file_id || !buyer_email) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: file_id, buyer_email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Override check ----
    const purchaseEnabled = await isPurchaseEnabled(supabaseAdmin);
    if (!purchaseEnabled) {
      return new Response(
        JSON.stringify({ error: "Marketplace purchases are currently disabled" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Fetch file record ----
    const { data: fileRow, error: fileError } = await supabaseAdmin
      .from("files")
      .select("id, title, price_cents, stage, uploader_id")
      .eq("id", file_id)
      .single();

    if (fileError || !fileRow) {
      return new Response(
        JSON.stringify({ error: "File not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (fileRow.stage !== "listed") {
      return new Response(
        JSON.stringify({ error: "File is not currently listed for sale" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Fetch royalty chain ----
    const { data: royaltyChain, error: royaltyError } = await supabaseAdmin
      .from("file_royalty_chain")
      .select("member_id, share_basis_points, position")
      .eq("file_id", file_id)
      .order("position", { ascending: true });

    if (royaltyError || !royaltyChain || royaltyChain.length === 0) {
      console.error("[create-checkout] No royalty chain found for file:", file_id);
      return new Response(
        JSON.stringify({ error: "Royalty chain not configured for this file" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Calculate pricing ----
    const pricing = calculatePricing(fileRow.price_cents, royaltyChain);

    // ---- Create Stripe Checkout Session ----
    // TODO: Implement Stripe Checkout Session creation
    // const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });
    //
    // Fetch the primary seller's Stripe Connect account ID:
    // const { data: seller } = await supabaseAdmin
    //   .from("members")
    //   .select("stripe_account_id")
    //   .eq("id", royaltyChain[0].member_id)
    //   .single();
    //
    // const session = await stripe.checkout.sessions.create({
    //   mode: "payment",
    //   customer_email: buyer_email,
    //   line_items: [
    //     {
    //       price_data: {
    //         currency: "usd",
    //         unit_amount: pricing.total_cents,
    //         product_data: {
    //           name: fileRow.title,
    //           description: `PIF Marketplace file: ${fileRow.title}`,
    //         },
    //       },
    //       quantity: 1,
    //     },
    //   ],
    //   payment_intent_data: {
    //     application_fee_amount: pricing.pif_fee_cents,
    //     transfer_data: {
    //       destination: seller.stripe_account_id,
    //     },
    //   },
    //   success_url: `${Deno.env.get("PUBLIC_SITE_URL")}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
    //   cancel_url: `${Deno.env.get("PUBLIC_SITE_URL")}/purchase/cancel`,
    //   metadata: {
    //     file_id,
    //     buyer_email,
    //   },
    // });

    const mockSessionId = `cs_test_${crypto.randomUUID()}`;
    const checkoutUrl = `https://checkout.stripe.com/pay/${mockSessionId}`;
    console.log("[create-checkout] TODO: Replace mock Stripe session with real implementation");

    // ---- Create order row (payment_status = pending) ----
    const orderId = crypto.randomUUID();
    const { error: orderError } = await supabaseAdmin.from("orders").insert({
      id: orderId,
      file_id,
      buyer_email,
      stripe_session_id: mockSessionId, // TODO: Use session.id from real Stripe
      payment_status: "pending",
      total_cents: pricing.total_cents,
      pif_fee_cents: pricing.pif_fee_cents,
      // download_token: null — set after payment confirmed
      // download_expires_at: null
    });

    if (orderError) {
      console.error("[create-checkout] Order insert error:", orderError.message);
      return new Response(
        JSON.stringify({ error: "Failed to create order" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Success ----
    return new Response(
      JSON.stringify({ checkout_url: checkoutUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[create-checkout] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
