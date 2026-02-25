// =============================================================================
// PIF Selection-Connection — download
// GET /download?token=<download_token>
// Validates a download token, generates a signed Supabase Storage URL, and
// redirects the buyer to the file. Tracks download attempts.
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

/** How long a signed download URL is valid (in seconds). */
const SIGNED_URL_EXPIRY_SECONDS = 60 * 10; // 10 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the authenticated user from the Authorization header (optional). */
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
    if (req.method !== "GET") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Parse query params ----
    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing required query parameter: token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Init Supabase admin client ----
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ---- Find order by download_token ----
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select(
        "id, file_id, payment_status, download_expires_at, download_attempts, buyer_email, downloaded_at"
      )
      .eq("download_token", token)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired download token" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Verify payment_status = paid ----
    if (order.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ error: "Payment has not been completed for this order" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Check expiry OR allow authenticated re-download ----
    const now = new Date();
    const expiresAt = order.download_expires_at
      ? new Date(order.download_expires_at)
      : null;

    const isExpired = expiresAt && now > expiresAt;

    if (isExpired) {
      // Allow re-download if the buyer is authenticated
      const user = await getAuthUser(req, supabaseAdmin);

      // TODO: Match user to order — check if user.email === order.buyer_email
      //       or if user.id matches a member linked to this order
      const isOwner = user?.email === order.buyer_email;

      if (!isOwner) {
        return new Response(
          JSON.stringify({
            error: "Download link has expired. Sign in and request a new link.",
          }),
          { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("[download] Allowing re-download for authenticated buyer:", user?.email);
    }

    // ---- Fetch file record to get storage_path ----
    const { data: fileRow, error: fileError } = await supabaseAdmin
      .from("files")
      .select("storage_path, title")
      .eq("id", order.file_id)
      .single();

    if (fileError || !fileRow) {
      return new Response(
        JSON.stringify({ error: "File record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Generate signed Supabase Storage URL ----
    // TODO: Implement actual signed URL generation
    // const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
    //   .from("marketplace-files")
    //   .createSignedUrl(fileRow.storage_path, SIGNED_URL_EXPIRY_SECONDS);
    //
    // if (signedUrlError || !signedUrlData?.signedUrl) {
    //   console.error("[download] Failed to generate signed URL:", signedUrlError?.message);
    //   return new Response(
    //     JSON.stringify({ error: "Failed to generate download URL" }),
    //     { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    //   );
    // }
    // const signedUrl = signedUrlData.signedUrl;

    const signedUrl = `https://placeholder.supabase.co/storage/v1/object/sign/marketplace-files/${fileRow.storage_path}?token=PLACEHOLDER`;
    console.log("[download] TODO: Replace with real signed URL generation");

    // ---- Update order: set downloaded_at, increment download_attempts ----
    const { error: trackError } = await supabaseAdmin
      .from("orders")
      .update({
        downloaded_at: now.toISOString(),
        download_attempts: (order.download_attempts ?? 0) + 1,
      })
      .eq("id", order.id);

    if (trackError) {
      console.warn("[download] Failed to track download:", trackError.message);
      // Non-fatal — still allow the download
    }

    // ---- Redirect to signed URL ----
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: signedUrl,
      },
    });

  } catch (err) {
    console.error("[download] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
