/**
 * SC API Helpers
 *
 * Wraps calls to Supabase Edge Functions.
 * Depends on sc-config.js (for initSupabase) and sc-auth.js (for session tokens).
 */

var SC_API = {
  /**
   * Call a Supabase Edge Function.
   * @param {string} functionName - e.g. 'create-checkout', 'upload-file'
   * @param {Object} body - JSON body to send
   * @returns {Object} { data, error }
   */
  call: async function(functionName, body) {
    var sb = initSupabase();
    var { data, error } = await sb.functions.invoke(functionName, {
      body: body || {}
    });
    if (error) {
      console.error("Edge Function error (" + functionName + "):", error);
      return { data: null, error: error.message || "Request failed" };
    }
    return { data: data, error: null };
  },

  /**
   * Check if a platform feature is enabled.
   * Reads from override_controls table.
   * @param {string} featureKey - e.g. 'marketplace_browse', 'file_upload'
   * @returns {boolean}
   */
  isFeatureEnabled: async function(featureKey) {
    var sb = initSupabase();
    /* First check master switch */
    var { data: master } = await sb
      .from("override_controls")
      .select("enabled")
      .eq("feature_key", "master_switch")
      .maybeSingle();
    if (!master || !master.enabled) return false;

    /* Then check specific feature */
    var { data: feature } = await sb
      .from("override_controls")
      .select("enabled")
      .eq("feature_key", featureKey)
      .maybeSingle();
    return feature ? feature.enabled : false;
  },

  /**
   * Load all override controls (for admin page).
   * @returns {Array} array of { feature_key, enabled, description }
   */
  getAllOverrides: async function() {
    var sb = initSupabase();
    var { data, error } = await sb
      .from("override_controls")
      .select("*")
      .order("feature_key");
    return data || [];
  },

  /* ── Marketplace Queries ── */

  /**
   * Browse listed files with optional filters.
   * @param {Object} filters - { community, minPrice, maxPrice, version, search, limit, offset }
   * @returns {Object} { files, count, error }
   */
  browseFiles: async function(filters) {
    var sb = initSupabase();
    filters = filters || {};
    var query = sb
      .from("files")
      .select("*, file_community_tags(community_tag), file_royalty_chain(role, member_id, amount_cents)", { count: "exact" })
      .eq("stage", "listed")
      .order("created_at", { ascending: false });

    if (filters.minPrice !== undefined) {
      query = query.gte("price_cents", filters.minPrice);
    }
    if (filters.maxPrice !== undefined) {
      query = query.lte("price_cents", filters.maxPrice);
    }
    if (filters.version) {
      query = query.eq("version_label", filters.version);
    }
    if (filters.search) {
      query = query.or("title.ilike.%" + filters.search + "%,description.ilike.%" + filters.search + "%");
    }
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    if (filters.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);
    }

    var { data, error, count } = await query;
    if (error) return { files: [], count: 0, error: error.message };
    return { files: data || [], count: count || 0, error: null };
  },

  /**
   * Get a single file by ID with full details.
   * @param {string} fileId
   * @returns {Object} file data or null
   */
  getFile: async function(fileId) {
    var sb = initSupabase();
    var { data, error } = await sb
      .from("files")
      .select("*, file_community_tags(community_tag), file_royalty_chain(role, member_id, amount_cents)")
      .eq("id", fileId)
      .maybeSingle();
    return data;
  },

  /**
   * Get all files in a family (version chain).
   * @param {string} familyId
   * @returns {Array} files in the family
   */
  getFileFamily: async function(familyId) {
    var sb = initSupabase();
    var { data } = await sb
      .from("files")
      .select("id, version_label, title, price_cents, stage, created_at")
      .eq("family_id", familyId)
      .eq("stage", "listed")
      .order("version_label");
    return data || [];
  },

  /* ── Member Queries ── */

  /**
   * Get a member's public profile.
   * @param {string} memberId
   * @returns {Object} member profile
   */
  getMemberProfile: async function(memberId) {
    var sb = initSupabase();
    var { data } = await sb
      .from("members")
      .select("id, display_name, tier_id, joined_at, completion_ratio, dissolution_ratio, avatar_url, bio")
      .eq("id", memberId)
      .maybeSingle();
    return data;
  },

  /**
   * Get the current member's files (all stages).
   * @returns {Array} files
   */
  getMyFiles: async function() {
    if (!SC_AUTH.member) return [];
    var sb = initSupabase();
    var { data } = await sb
      .from("files")
      .select("*, file_community_tags(community_tag)")
      .eq("uploader_id", SC_AUTH.member.id)
      .order("created_at", { ascending: false });
    return data || [];
  },

  /**
   * Get the current member's purchase history.
   * @returns {Array} orders
   */
  getMyOrders: async function() {
    if (!SC_AUTH.member) return [];
    var sb = initSupabase();
    var { data } = await sb
      .from("orders")
      .select("*, files(title, version_label, preview_image_path)")
      .eq("buyer_member_id", SC_AUTH.member.id)
      .order("created_at", { ascending: false });
    return data || [];
  },

  /**
   * Get the current member's payout history.
   * @returns {Array} payouts
   */
  getMyPayouts: async function() {
    if (!SC_AUTH.member) return [];
    var sb = initSupabase();
    var { data } = await sb
      .from("payouts")
      .select("*, orders(file_id, total_cents, paid_at, files(title))")
      .eq("member_id", SC_AUTH.member.id)
      .order("created_at", { ascending: false });
    return data || [];
  },

  /* ── Tier Helpers ── */

  /**
   * Get tier display info.
   * @param {string} tierId
   * @returns {Object} { name, price, race }
   */
  getTierInfo: function(tierId) {
    var tiers = {
      design_and_go: { name: "Design & Go", price: "Free", race: "In the paddock" },
      emerging:      { name: "Emerging", price: "$9.99/mo", race: "First qualifying laps" },
      surging:       { name: "Surging", price: "$49.99/mo", race: "Mid-field" },
      converging:    { name: "Converging", price: "$149.99/mo", race: "Front of the field" },
      diverging:     { name: "Diverging", price: "$399.99/mo", race: "Running a team" }
    };
    return tiers[tierId] || tiers.design_and_go;
  }
};
