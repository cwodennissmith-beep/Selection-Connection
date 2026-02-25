/**
 * SC Auth Helpers
 *
 * Provides login, logout, session check, and auth state listeners.
 * Depends on sc-config.js being loaded first (for initSupabase).
 */

var SC_AUTH = {
  /** Current session (null if not logged in) */
  session: null,

  /** Current member profile from members table (null if not logged in) */
  member: null,

  /**
   * Initialize auth — call once on page load.
   * Sets up session listener and loads current session if any.
   */
  init: async function() {
    var sb = initSupabase();
    if (!sb) return;

    /* Get current session */
    var { data } = await sb.auth.getSession();
    if (data.session) {
      this.session = data.session;
      await this._loadMember();
    }

    /* Listen for auth state changes (login, logout, token refresh) */
    sb.auth.onAuthStateChange(async function(event, session) {
      SC_AUTH.session = session;
      if (session) {
        await SC_AUTH._loadMember();
      } else {
        SC_AUTH.member = null;
      }
      SC_AUTH._notifyListeners(event);
    });
  },

  /**
   * Register a new member.
   * @param {string} email
   * @param {string} password
   * @param {string} displayName
   * @returns {Object} { success, error, message }
   */
  register: async function(email, password, displayName) {
    var sb = initSupabase();
    var { data, error } = await sb.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { display_name: displayName }
      }
    });
    if (error) return { success: false, error: error.message };
    return { success: true, message: "Check your email for a verification link." };
  },

  /**
   * Log in with email and password.
   * @returns {Object} { success, error }
   */
  login: async function(email, password) {
    var sb = initSupabase();
    var { data, error } = await sb.auth.signInWithPassword({
      email: email,
      password: password
    });
    if (error) return { success: false, error: error.message };
    this.session = data.session;
    await this._loadMember();
    return { success: true };
  },

  /**
   * Log out the current user.
   */
  logout: async function() {
    var sb = initSupabase();
    await sb.auth.signOut();
    this.session = null;
    this.member = null;
  },

  /**
   * Check if user is currently logged in.
   * @returns {boolean}
   */
  isLoggedIn: function() {
    return this.session !== null;
  },

  /**
   * Get the current user's auth UUID.
   * @returns {string|null}
   */
  getAuthId: function() {
    return this.session ? this.session.user.id : null;
  },

  /**
   * Get the current member's tier.
   * @returns {string|null} e.g. 'design_and_go', 'emerging', etc.
   */
  getTier: function() {
    return this.member ? this.member.tier_id : null;
  },

  /**
   * Check if the current member has a specific role.
   * @param {string} roleId - 'originator', 'contributor', or 'applicator'
   * @returns {boolean}
   */
  hasRole: async function(roleId) {
    if (!this.member) return false;
    var sb = initSupabase();
    var { data } = await sb
      .from("member_roles")
      .select("is_active")
      .eq("member_id", this.member.id)
      .eq("role_id", roleId)
      .eq("is_active", true)
      .maybeSingle();
    return data !== null;
  },

  /* ── Internal ── */

  /** Load member profile from members table */
  _loadMember: async function() {
    if (!this.session) return;
    var sb = initSupabase();
    var { data, error } = await sb
      .from("members")
      .select("*")
      .eq("auth_user_id", this.session.user.id)
      .maybeSingle();
    if (data) {
      this.member = data;
    }
  },

  /** Auth state change listeners */
  _listeners: [],

  /**
   * Register a callback for auth state changes.
   * @param {Function} fn - called with (event) where event is 'SIGNED_IN', 'SIGNED_OUT', etc.
   */
  onAuthChange: function(fn) {
    this._listeners.push(fn);
  },

  _notifyListeners: function(event) {
    this._listeners.forEach(function(fn) {
      try { fn(event); } catch(e) { console.error("Auth listener error:", e); }
    });
  }
};
