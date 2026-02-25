// =============================================================================
// PIF Selection-Connection — resend-download
// POST /resend-download
// Accepts: { order_id }
// Requires auth. Generates a new download token and sends a fresh delivery
// email for a previously purchased file.
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

/** Maximum number of delivery email retries allowed per order. */
const MAX_DELIVERY_RETRIES = 5;

/** Download token validity period (72 hours in ms). */
const DOWNLOAD_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

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
  //     subject: `Your download link has been refreshed: ${fileTitle}`,
  //     html: `
  //       <h2>New download link</h2>
  //       <p>Here's a fresh download link for <strong>${fileTitle}</strong>.</p>
  //       <p><a href="${downloadUrl}">Click here to download your file</a></p>
  //       <p>This link expires in 72 hours.</p>
  //     `,
  //   }),
  // });
  //
  // return res.ok;

  console.log("[resend-download] TODO: Send delivery email to", buyerEmail);
  console.log("[resend-download] File:", fileTitle, "Download URL:", downloadUrl);
  return true;
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
    const { order_id } = await req.json();

    if (!order_id) {
      return new Response(
        JSON.stringify({ error: "Missing required field: order_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Fetch order ----
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, file_id, buyer_email, payment_status, delivery_email_retries")
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Verify the authenticated user is the buyer ----
    if (user.email !== order.buyer_email) {
      return new Response(
        JSON.stringify({ error: "You are not the buyer of this order" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Verify payment is complete ----
    if (order.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ error: "Order has not been paid" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Check retry limit ----
    const retries = order.delivery_email_retries ?? 0;
    if (retries >= MAX_DELIVERY_RETRIES) {
      return new Response(
        JSON.stringify({
          error: `Maximum delivery email retries (${MAX_DELIVERY_RETRIES}) exceeded. Contact support.`,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Generate new download token ----
    const newDownloadToken = crypto.randomUUID();
    const newExpiresAt = new Date(Date.now() + DOWNLOAD_TOKEN_TTL_MS).toISOString();

    // ---- Update order with new token ----
    const { error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        download_token: newDownloadToken,
        download_expires_at: newExpiresAt,
        delivery_email_retries: retries + 1,
      })
      .eq("id", order.id);

    if (updateError) {
      console.error("[resend-download] Failed to update order:", updateError.message);
      return new Response(
        JSON.stringify({ error: "Failed to generate new download link" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Fetch file title ----
    const { data: fileRow } = await supabaseAdmin
      .from("files")
      .select("title")
      .eq("id", order.file_id)
      .single();

    // ---- Build download URL and send email ----
    // TODO: Use PUBLIC_SITE_URL for the download link
    const downloadUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/download?token=${newDownloadToken}`;
    const emailSent = await sendDeliveryEmail(
      order.buyer_email,
      fileRow?.title ?? "Untitled",
      downloadUrl
    );

    if (!emailSent) {
      console.warn("[resend-download] Email delivery may have failed");
    }

    // ---- Success ----
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[resend-download] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
