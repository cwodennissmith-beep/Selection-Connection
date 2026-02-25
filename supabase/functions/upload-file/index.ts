// =============================================================================
// PIF Selection-Connection — upload-file
// POST /upload-file
// Accepts: multipart/form-data with file, preview_image, title, description,
//          price_cents, version_label, community_tags[]
// Requires auth (JWT). Uploads a file to the marketplace with 7-point validation.
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

// TODO: Move allowed formats and size limits to a config table or env vars
const ALLOWED_FILE_FORMATS = [".gh", ".3dm", ".json", ".zip"];
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB hard cap
const ALLOWED_PREVIEW_FORMATS = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_PREVIEW_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

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

/** Check whether file_upload is enabled via override_controls. */
async function isUploadEnabled(
  supabase: ReturnType<typeof createClient>
): Promise<boolean> {
  const { data, error } = await supabase
    .from("override_controls")
    .select("enabled")
    .eq("feature_key", "file_upload")
    .single();

  if (error || !data) return false;
  return data.enabled === true;
}

/** Check whether the member has the 'originator' role. */
async function hasOriginatorRole(
  supabase: ReturnType<typeof createClient>,
  memberId: string
): Promise<boolean> {
  // TODO: Query member_roles table
  // SELECT * FROM member_roles WHERE member_id = memberId AND role = 'originator'
  const { data, error } = await supabase
    .from("member_roles")
    .select("role")
    .eq("member_id", memberId)
    .eq("role", "originator")
    .maybeSingle();

  if (error) {
    console.error("[upload-file] Role check error:", error.message);
    return false;
  }
  return data !== null;
}

/**
 * 7-point validation for an uploaded file.
 * Returns an object with pass/fail for each check.
 */
function validateFile(
  file: File,
  previewImage: File | null,
  title: string,
  versionLabel: string,
  communityTags: string[],
  _storageLimitBytes: number,
  _storageUsedBytes: number
): { passed: boolean; results: Record<string, { passed: boolean; message: string }> } {
  const results: Record<string, { passed: boolean; message: string }> = {};

  // 1. Format check
  // TODO: Implement proper MIME type + extension validation
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
  results.format = {
    passed: ALLOWED_FILE_FORMATS.includes(ext),
    message: ALLOWED_FILE_FORMATS.includes(ext)
      ? "File format accepted"
      : `Unsupported format: ${ext}. Allowed: ${ALLOWED_FILE_FORMATS.join(", ")}`,
  };

  // 2. Size vs tier quota
  // TODO: Look up the member's tier storage quota from tiers table
  const underQuota = file.size <= MAX_FILE_SIZE_BYTES;
  results.size = {
    passed: underQuota,
    message: underQuota
      ? `File size (${file.size} bytes) within limit`
      : `File size (${file.size} bytes) exceeds max (${MAX_FILE_SIZE_BYTES} bytes)`,
  };

  // 3. Integrity check
  // TODO: Implement checksum / corruption detection (e.g., compute SHA-256)
  results.integrity = {
    passed: true,
    message: "TODO: Integrity check not yet implemented",
  };

  // 4. Name / version label
  const hasNameAndVersion = title.trim().length > 0 && versionLabel.trim().length > 0;
  results.name_version = {
    passed: hasNameAndVersion,
    message: hasNameAndVersion
      ? "Title and version label present"
      : "Title and version_label are required",
  };

  // 5. Community tags
  const hasTags = communityTags.length >= 1 && communityTags.length <= 10;
  results.community_tags = {
    passed: hasTags,
    message: hasTags
      ? `${communityTags.length} tag(s) provided`
      : "Must provide between 1 and 10 community tags",
  };

  // 6. Preview image
  if (previewImage) {
    const previewExt = "." + (previewImage.name.split(".").pop() ?? "").toLowerCase();
    const previewOk =
      ALLOWED_PREVIEW_FORMATS.includes(previewExt) &&
      previewImage.size <= MAX_PREVIEW_SIZE_BYTES;
    results.preview_image = {
      passed: previewOk,
      message: previewOk
        ? "Preview image accepted"
        : "Preview image must be PNG/JPG/WebP and under 5 MB",
    };
  } else {
    results.preview_image = {
      passed: false,
      message: "Preview image is required",
    };
  }

  // 7. Storage quota remaining
  // TODO: Compare (storageUsedBytes + file.size) against tier quota
  results.storage_quota = {
    passed: true,
    message: "TODO: Storage quota check not yet implemented",
  };

  const passed = Object.values(results).every((r) => r.passed);
  return { passed, results };
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

    // ---- Init Supabase clients ----
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

    // ---- Override check ----
    const uploadEnabled = await isUploadEnabled(supabaseAdmin);
    if (!uploadEnabled) {
      return new Response(
        JSON.stringify({ error: "File uploads are currently disabled" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Originator role check ----
    const isOriginator = await hasOriginatorRole(supabaseAdmin, user.id);
    if (!isOriginator) {
      return new Response(
        JSON.stringify({ error: "Originator role required to upload files" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Parse multipart form data ----
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const previewImage = formData.get("preview_image") as File | null;
    const title = (formData.get("title") as string) ?? "";
    const description = (formData.get("description") as string) ?? "";
    const priceCents = parseInt((formData.get("price_cents") as string) ?? "0", 10);
    const versionLabel = (formData.get("version_label") as string) ?? "";

    // community_tags may come as repeated fields or a JSON array string
    let communityTags: string[] = [];
    const tagsRaw = formData.getAll("community_tags[]");
    if (tagsRaw.length > 0) {
      communityTags = tagsRaw.map((t) => String(t));
    } else {
      const tagsSingle = formData.get("community_tags") as string | null;
      if (tagsSingle) {
        try {
          communityTags = JSON.parse(tagsSingle);
        } catch {
          communityTags = [tagsSingle];
        }
      }
    }

    if (!file) {
      return new Response(
        JSON.stringify({ error: "File is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- 7-point validation ----
    // TODO: Fetch member's storage_used_bytes and tier quota for accurate checks
    const validation = validateFile(
      file,
      previewImage,
      title,
      versionLabel,
      communityTags,
      /* storageLimitBytes */ MAX_FILE_SIZE_BYTES,
      /* storageUsedBytes */ 0
    );

    if (!validation.passed) {
      return new Response(
        JSON.stringify({
          error: "Validation failed",
          validation_results: validation.results,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Upload file to Supabase Storage (marketplace-files bucket) ----
    const fileId = crypto.randomUUID();
    const storagePath = `${user.id}/${fileId}/${file.name}`;

    // TODO: Implement actual storage upload
    // const { error: uploadError } = await supabaseAdmin.storage
    //   .from("marketplace-files")
    //   .upload(storagePath, file, { contentType: file.type, upsert: false });
    // if (uploadError) throw uploadError;
    console.log("[upload-file] TODO: Upload file to storage at", storagePath);

    // ---- Upload preview image to Supabase Storage (preview-images bucket) ----
    let previewPath: string | null = null;
    if (previewImage) {
      previewPath = `${user.id}/${fileId}/preview_${previewImage.name}`;
      // TODO: Implement actual preview upload
      // const { error: previewError } = await supabaseAdmin.storage
      //   .from("preview-images")
      //   .upload(previewPath, previewImage, { contentType: previewImage.type, upsert: false });
      // if (previewError) throw previewError;
      console.log("[upload-file] TODO: Upload preview to storage at", previewPath);
    }

    // ---- Insert files row ----
    const { data: fileRow, error: fileInsertError } = await supabaseAdmin
      .from("files")
      .insert({
        id: fileId,
        uploader_id: user.id,
        title,
        description,
        price_cents: priceCents,
        version_label: versionLabel,
        storage_path: storagePath,
        preview_image_path: previewPath,
        file_size_bytes: file.size,
        validation_passed: true,
        stage: "uploaded", // Not yet listed
        // TODO: Add checksum field once integrity check is implemented
      })
      .select("id")
      .single();

    if (fileInsertError) {
      console.error("[upload-file] Insert error:", fileInsertError.message);
      return new Response(
        JSON.stringify({ error: "Failed to create file record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---- Insert file_community_tags rows ----
    if (communityTags.length > 0) {
      const tagRows = communityTags.map((tag) => ({
        file_id: fileId,
        tag,
      }));
      // TODO: Validate tags against allowed community_tags list
      const { error: tagError } = await supabaseAdmin
        .from("file_community_tags")
        .insert(tagRows);
      if (tagError) {
        console.warn("[upload-file] Tag insert warning:", tagError.message);
      }
    }

    // ---- Insert file_royalty_chain (initial entry for uploader) ----
    // TODO: Build full royalty chain based on derivative lineage
    const { error: royaltyError } = await supabaseAdmin
      .from("file_royalty_chain")
      .insert({
        file_id: fileId,
        member_id: user.id,
        share_basis_points: 10000, // 100% to uploader initially
        position: 0,
      });
    if (royaltyError) {
      console.warn("[upload-file] Royalty chain insert warning:", royaltyError.message);
    }

    // ---- Update members.storage_used_bytes ----
    // TODO: Atomic increment using RPC or raw SQL
    // await supabaseAdmin.rpc("increment_storage_used", {
    //   p_member_id: user.id,
    //   p_bytes: file.size,
    // });
    console.log("[upload-file] TODO: Increment storage_used_bytes by", file.size);

    // ---- Success ----
    return new Response(
      JSON.stringify({
        file_id: fileRow.id,
        validation_results: validation.results,
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[upload-file] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
