// =============================================================================
// PIF Selection-Connection — list-file
// POST /list-file
// Accepts: { file_id }
// Requires auth. Transitions a validated file from 'uploaded' to 'listed' stage.
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
    const { file_id } = await req.json();

    if (!file_id) {
      return new Response(
        JSON.stringify({ error: "Missing required field: file_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Fetch the file record ----
    const { data: fileRow, error: fetchError } = await supabaseAdmin
      .from("files")
      .select("id, uploader_id, validation_passed, stage")
      .eq("id", file_id)
      .single();

    if (fetchError || !fileRow) {
      return new Response(
        JSON.stringify({ error: "File not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Verify the uploader owns this file ----
    if (fileRow.uploader_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "You do not own this file" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Verify validation_passed = true ----
    if (!fileRow.validation_passed) {
      return new Response(
        JSON.stringify({ error: "File has not passed validation. Cannot list." }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Guard: only transition from 'uploaded' to 'listed' ----
    // TODO: Consider allowing re-listing of 'delisted' files
    if (fileRow.stage !== "uploaded") {
      return new Response(
        JSON.stringify({
          error: `File is in '${fileRow.stage}' stage. Only 'uploaded' files can be listed.`,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Update stage to 'listed' ----
    const { error: updateError } = await supabaseAdmin
      .from("files")
      .update({ stage: "listed" })
      .eq("id", file_id);

    if (updateError) {
      console.error("[list-file] Update error:", updateError.message);
      return new Response(
        JSON.stringify({ error: "Failed to update file stage" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // TODO: Trigger any post-listing hooks (e.g., notify followers, index for search)

    // ---- Success ----
    return new Response(
      JSON.stringify({ file_id, stage: "listed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[list-file] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
