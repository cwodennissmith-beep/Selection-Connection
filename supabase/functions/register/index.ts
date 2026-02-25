// =============================================================================
// PIF Selection-Connection — register
// POST /register
// Accepts: { email, password, display_name, captcha_token }
// Creates a new member account with hCaptcha verification.
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

/** Verify an hCaptcha token with the hCaptcha siteverify API. */
async function verifyHCaptcha(token: string): Promise<boolean> {
  // TODO: Implement hCaptcha verification
  // 1. POST to https://api.hcaptcha.com/siteverify with:
  //    - secret: Deno.env.get("HCAPTCHA_SECRET")
  //    - response: token
  // 2. Parse JSON response and return response.success === true
  console.log("[register] TODO: verify hCaptcha token");
  return true; // Stub: always passes
}

/** Check whether member registration is enabled via override_controls. */
async function isRegistrationEnabled(
  supabase: ReturnType<typeof createClient>
): Promise<boolean> {
  // TODO: Query override_controls table
  // SELECT enabled FROM override_controls WHERE feature_key = 'member_registration'
  // Return false if row missing or enabled = false
  const { data, error } = await supabase
    .from("override_controls")
    .select("enabled")
    .eq("feature_key", "member_registration")
    .single();

  if (error || !data) {
    console.warn("[register] Could not read override_controls:", error?.message);
    return false;
  }
  return data.enabled === true;
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

    // ---- Parse request body ----
    const { email, password, display_name, captcha_token } = await req.json();

    if (!email || !password || !display_name || !captcha_token) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: email, password, display_name, captcha_token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Init Supabase admin client (service role) ----
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ---- Step 1: Verify hCaptcha ----
    const captchaValid = await verifyHCaptcha(captcha_token);
    if (!captchaValid) {
      return new Response(
        JSON.stringify({ error: "Captcha verification failed" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Step 2: Check override_controls.member_registration ----
    const registrationEnabled = await isRegistrationEnabled(supabaseAdmin);
    if (!registrationEnabled) {
      return new Response(
        JSON.stringify({ error: "Member registration is currently disabled" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Step 3: Create Supabase Auth user ----
    // TODO: Consider adding email confirmation flow
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // TODO: Set to false if email confirmation is required
      });

    if (authError || !authData.user) {
      return new Response(
        JSON.stringify({ error: authError?.message ?? "Failed to create auth user" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authData.user.id;

    // ---- Step 4: Insert row into members table ----
    // Default tier = 'design_and_go' (lowest free tier)
    const { data: memberData, error: memberError } = await supabaseAdmin
      .from("members")
      .insert({
        id: userId,
        email,
        display_name,
        tier: "design_and_go",
        // TODO: Set additional default fields:
        // storage_used_bytes: 0,
        // payout_enabled: false,
        // created_at is set by DB default
      })
      .select("id")
      .single();

    if (memberError) {
      // TODO: Consider rolling back the auth user if member insert fails
      console.error("[register] Failed to insert member row:", memberError.message);
      return new Response(
        JSON.stringify({ error: "Failed to create member profile" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Success ----
    return new Response(
      JSON.stringify({ member_id: memberData.id }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[register] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
