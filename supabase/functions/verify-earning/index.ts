// =============================================================================
// PIF Selection-Connection — verify-earning
// POST /verify-earning
// Accepts: { tax_acknowledged, w9_acknowledged }
// Requires auth. Records tax/W-9 acknowledgment and creates a Stripe Connect
// Express account for the member so they can receive payouts.
// =============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum tier required to become an earner / originator.
 * Tiers in ascending order: design_and_go < emerging < maker < professional
 */
const MINIMUM_EARNING_TIER = "emerging";

/** Tier hierarchy for comparison. */
const TIER_RANK: Record<string, number> = {
  design_and_go: 0,
  emerging: 1,
  maker: 2,
  professional: 3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the authenticated user from the Authorization header. */
async function getAuthUser(
  req: Request,
  supabase: ReturnType<typeof createClient>
) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

/** Check if a member's tier meets the minimum earning requirement. */
function meetsMinimumTier(memberTier: string): boolean {
  const memberRank = TIER_RANK[memberTier] ?? -1;
  const requiredRank = TIER_RANK[MINIMUM_EARNING_TIER] ?? 999;
  return memberRank >= requiredRank;
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

    // ---- Auth check ----
    const user = await getAuthUser(req, supabaseAdmin);
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Parse request body ----
    const { tax_acknowledged, w9_acknowledged } = await req.json();

    if (tax_acknowledged !== true || w9_acknowledged !== true) {
      return new Response(
        JSON.stringify({
          error: "Both tax_acknowledged and w9_acknowledged must be true to proceed",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Fetch member record ----
    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id, tier, email, display_name, stripe_account_id, payout_enabled")
      .eq("id", user.id)
      .single();

    if (memberError || !member) {
      return new Response(
        JSON.stringify({ error: "Member profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Verify minimum tier ----
    if (!meetsMinimumTier(member.tier)) {
      return new Response(
        JSON.stringify({
          error: `Your current tier (${member.tier}) does not meet the minimum requirement (${MINIMUM_EARNING_TIER}) to earn on the marketplace.`,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Check if already onboarded ----
    if (member.stripe_account_id) {
      return new Response(
        JSON.stringify({
          error: "You already have a Stripe Connect account",
          stripe_account_id: member.stripe_account_id,
          payout_enabled: member.payout_enabled,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Record tax/W-9 acknowledgment ----
    // TODO: Store acknowledgment timestamp and IP for compliance records
    const { error: ackError } = await supabaseAdmin
      .from("members")
      .update({
        tax_acknowledged: true,
        tax_acknowledged_at: new Date().toISOString(),
        w9_acknowledged: true,
        w9_acknowledged_at: new Date().toISOString(),
      })
      .eq("id", member.id);

    if (ackError) {
      console.error("[verify-earning] Failed to record acknowledgment:", ackError.message);
      return new Response(
        JSON.stringify({ error: "Failed to record acknowledgment" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Create Stripe Connect Express account ----
    // TODO: Implement actual Stripe Connect account creation
    // const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2023-10-16" });
    //
    // const account = await stripe.accounts.create({
    //   type: "express",
    //   email: member.email,
    //   metadata: {
    //     pif_member_id: member.id,
    //     display_name: member.display_name,
    //   },
    //   capabilities: {
    //     card_payments: { requested: true },
    //     transfers: { requested: true },
    //   },
    // });
    //
    // // Store the Stripe account ID on the member
    // await supabaseAdmin
    //   .from("members")
    //   .update({ stripe_account_id: account.id })
    //   .eq("id", member.id);
    //
    // // Create an account link for onboarding
    // const accountLink = await stripe.accountLinks.create({
    //   account: account.id,
    //   refresh_url: `${Deno.env.get("PUBLIC_SITE_URL")}/earning/refresh`,
    //   return_url: `${Deno.env.get("PUBLIC_SITE_URL")}/earning/complete`,
    //   type: "account_onboarding",
    // });
    //
    // const onboardingUrl = accountLink.url;

    const mockAccountId = `acct_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const onboardingUrl = `https://connect.stripe.com/setup/e/${mockAccountId}`;
    console.log("[verify-earning] TODO: Replace mock Stripe account with real implementation");

    // Store mock account ID
    const { error: stripeUpdateError } = await supabaseAdmin
      .from("members")
      .update({ stripe_account_id: mockAccountId })
      .eq("id", member.id);

    if (stripeUpdateError) {
      console.error("[verify-earning] Failed to store Stripe account:", stripeUpdateError.message);
    }

    // ---- Success ----
    return new Response(
      JSON.stringify({ stripe_onboarding_url: onboardingUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[verify-earning] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
