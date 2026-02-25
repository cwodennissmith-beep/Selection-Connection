// =============================================================================
// PIF Selection-Connection — stripe-onboarding
// POST /stripe-onboarding
// Receives Stripe Connect account.updated webhook events.
// When a connected account becomes charges_enabled, grants the originator role
// and enables payouts for the member.
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
 * Verify the Stripe Connect webhook signature.
 * Uses a separate webhook secret from the main Stripe webhook.
 */
async function verifyStripeSignature(
  body: string,
  signature: string | null,
  secret: string
): Promise<Record<string, unknown> | null> {
  // TODO: Implement proper Stripe webhook signature verification
  // Same HMAC-SHA256 approach as stripe-webhook function.
  // This endpoint uses STRIPE_CONNECT_WEBHOOK_SECRET (separate from payments webhook).

  if (!signature) {
    console.error("[stripe-onboarding] Missing Stripe-Signature header");
    return null;
  }

  console.log("[stripe-onboarding] TODO: Implement real Stripe signature verification");

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
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
    const webhookSecret = Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET") ?? "";
    const event = await verifyStripeSignature(body, signature, webhookSecret);

    if (!event) {
      return new Response(
        JSON.stringify({ error: "Invalid webhook signature" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Only handle account.updated ----
    const eventType = event.type as string;
    if (eventType !== "account.updated") {
      console.log("[stripe-onboarding] Ignoring event type:", eventType);
      return new Response(
        JSON.stringify({ received: true, handled: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Init Supabase admin client ----
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ---- Extract account data ----
    const account = (event.data as Record<string, unknown>)?.object as Record<string, unknown>;
    const stripeAccountId = account.id as string;
    const chargesEnabled = account.charges_enabled as boolean;

    console.log(
      `[stripe-onboarding] Account ${stripeAccountId}: charges_enabled = ${chargesEnabled}`
    );

    if (!chargesEnabled) {
      // Account is not yet fully onboarded — nothing to do
      return new Response(
        JSON.stringify({ received: true, charges_enabled: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Find the member by stripe_account_id ----
    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id, payout_enabled")
      .eq("stripe_account_id", stripeAccountId)
      .single();

    if (memberError || !member) {
      console.error(
        "[stripe-onboarding] No member found for Stripe account:",
        stripeAccountId
      );
      // Return 200 so Stripe doesn't retry — the account may belong to a different system
      return new Response(
        JSON.stringify({ received: true, error: "Member not found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Update members.payout_enabled = true ----
    if (!member.payout_enabled) {
      const { error: updateError } = await supabaseAdmin
        .from("members")
        .update({ payout_enabled: true })
        .eq("id", member.id);

      if (updateError) {
        console.error("[stripe-onboarding] Failed to update payout_enabled:", updateError.message);
      } else {
        console.log("[stripe-onboarding] Enabled payouts for member:", member.id);
      }
    }

    // ---- Grant originator role in member_roles ----
    // Use upsert to avoid duplicate key errors if role already exists
    const { error: roleError } = await supabaseAdmin
      .from("member_roles")
      .upsert(
        { member_id: member.id, role: "originator" },
        { onConflict: "member_id,role" }
      );

    if (roleError) {
      console.error("[stripe-onboarding] Failed to grant originator role:", roleError.message);
    } else {
      console.log("[stripe-onboarding] Granted originator role to member:", member.id);
    }

    // TODO: Consider sending a welcome email notifying the member they can now upload files

    // ---- Success ----
    return new Response(
      JSON.stringify({ received: true, charges_enabled: true, member_id: member.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[stripe-onboarding] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
