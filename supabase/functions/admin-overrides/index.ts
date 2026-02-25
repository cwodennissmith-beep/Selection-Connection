// =============================================================================
// PIF Selection-Connection — admin-overrides
// GET  /admin-overrides          — returns all override_controls rows
// PUT  /admin-overrides          — accepts { feature_key, enabled }
// Requires auth + admin check (hardcoded admin member ID).
// Manages feature flags that gate marketplace capabilities.
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
 * Hardcoded admin member ID.
 * TODO: Move to env var or a dedicated admins table for production.
 */
const ADMIN_MEMBER_ID = Deno.env.get("ADMIN_MEMBER_ID") ?? "REPLACE_WITH_ADMIN_UUID";

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

/** Check if the authenticated user is an admin. */
function isAdmin(userId: string): boolean {
  // TODO: Expand to support multiple admins or an admin role in member_roles
  return userId === ADMIN_MEMBER_ID;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** GET — Return all override_controls rows. */
async function handleGet(
  supabase: ReturnType<typeof createClient>
): Promise<Response> {
  const { data, error } = await supabase
    .from("override_controls")
    .select("*")
    .order("feature_key", { ascending: true });

  if (error) {
    console.error("[admin-overrides] GET error:", error.message);
    return new Response(
      JSON.stringify({ error: "Failed to fetch override controls" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ controls: data }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/** PUT — Update a single override_controls row. */
async function handlePut(
  supabase: ReturnType<typeof createClient>,
  body: { feature_key: string; enabled: boolean }
): Promise<Response> {
  const { feature_key, enabled } = body;

  if (!feature_key || typeof enabled !== "boolean") {
    return new Response(
      JSON.stringify({ error: "Missing or invalid fields: feature_key (string), enabled (boolean)" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ---- Verify the feature_key exists ----
  const { data: existing, error: lookupError } = await supabase
    .from("override_controls")
    .select("feature_key")
    .eq("feature_key", feature_key)
    .single();

  if (lookupError || !existing) {
    return new Response(
      JSON.stringify({ error: `Unknown feature key: ${feature_key}` }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ---- Update the row ----
  const { error: updateError } = await supabase
    .from("override_controls")
    .update({
      enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("feature_key", feature_key);

  if (updateError) {
    console.error("[admin-overrides] PUT error:", updateError.message);
    return new Response(
      JSON.stringify({ error: "Failed to update override control" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ---- Return updated controls ----
  // TODO: Consider logging admin actions to an audit trail table
  const { data: updatedControls } = await supabase
    .from("override_controls")
    .select("*")
    .order("feature_key", { ascending: true });

  return new Response(
    JSON.stringify({ controls: updatedControls }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
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

    // ---- Admin check ----
    if (!isAdmin(user.id)) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Route by method ----
    switch (req.method) {
      case "GET":
        return await handleGet(supabaseAdmin);

      case "PUT": {
        const body = await req.json();
        return await handlePut(supabaseAdmin, body);
      }

      default:
        return new Response(
          JSON.stringify({ error: "Method not allowed. Use GET or PUT." }),
          { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

  } catch (err) {
    console.error("[admin-overrides] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
