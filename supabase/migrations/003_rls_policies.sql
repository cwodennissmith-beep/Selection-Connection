-- Row Level Security policies for all MVP tables.
-- These ensure data access is controlled at the database level.

-- ============================================================
-- MEMBERS
-- ============================================================
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- Anyone can read public profile fields (display_name, tier, ratios, joined_at)
CREATE POLICY "Public member profiles"
  ON members FOR SELECT
  USING (true);

-- Members can update their own profile
CREATE POLICY "Members update own profile"
  ON members FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Only Edge Functions (service role) can insert members
-- No INSERT policy for anon/authenticated = blocked by default

-- ============================================================
-- MEMBER ROLES
-- ============================================================
ALTER TABLE member_roles ENABLE ROW LEVEL SECURITY;

-- Members can read their own roles
CREATE POLICY "Members read own roles"
  ON member_roles FOR SELECT
  USING (member_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid()));

-- Public can read roles for profile display
CREATE POLICY "Public role visibility"
  ON member_roles FOR SELECT
  USING (true);

-- ============================================================
-- MEMBER COMMUNITIES
-- ============================================================
ALTER TABLE member_communities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public community membership"
  ON member_communities FOR SELECT
  USING (true);

CREATE POLICY "Members manage own communities"
  ON member_communities FOR ALL
  USING (member_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid()));

-- ============================================================
-- FILES
-- ============================================================
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- Listed files are visible to everyone (marketplace browse)
CREATE POLICY "Listed files are public"
  ON files FOR SELECT
  USING (stage = 'listed');

-- Uploaders can see and manage all their own files (any stage)
CREATE POLICY "Uploaders manage own files"
  ON files FOR ALL
  USING (uploader_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid()));

-- ============================================================
-- FILE COMMUNITY TAGS
-- ============================================================
ALTER TABLE file_community_tags ENABLE ROW LEVEL SECURITY;

-- Tags on listed files are public
CREATE POLICY "Tags on listed files are public"
  ON file_community_tags FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE stage = 'listed'));

-- Uploaders can manage tags on their own files
CREATE POLICY "Uploaders manage own file tags"
  ON file_community_tags FOR ALL
  USING (file_id IN (
    SELECT id FROM files WHERE uploader_id IN (
      SELECT id FROM members WHERE auth_user_id = auth.uid()
    )
  ));

-- ============================================================
-- FILE ROYALTY CHAIN
-- ============================================================
ALTER TABLE file_royalty_chain ENABLE ROW LEVEL SECURITY;

-- Royalty chain is visible on listed files (transparency)
CREATE POLICY "Royalty chain on listed files"
  ON file_royalty_chain FOR SELECT
  USING (file_id IN (SELECT id FROM files WHERE stage = 'listed'));

-- Members in the chain can see their own entries
CREATE POLICY "Members see own royalties"
  ON file_royalty_chain FOR SELECT
  USING (member_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid()));

-- ============================================================
-- ORDERS
-- ============================================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Buyers can see their own orders (by member_id or email)
CREATE POLICY "Buyers see own orders"
  ON orders FOR SELECT
  USING (
    buyer_member_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid())
    OR buyer_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Sellers can see orders for their files (for payout visibility)
CREATE POLICY "Sellers see orders for their files"
  ON orders FOR SELECT
  USING (
    file_id IN (
      SELECT id FROM files WHERE uploader_id IN (
        SELECT id FROM members WHERE auth_user_id = auth.uid()
      )
    )
  );

-- ============================================================
-- PAYOUTS
-- ============================================================
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- Members can see their own payouts
CREATE POLICY "Members see own payouts"
  ON payouts FOR SELECT
  USING (member_id IN (SELECT id FROM members WHERE auth_user_id = auth.uid()));

-- ============================================================
-- OVERRIDE CONTROLS
-- ============================================================
ALTER TABLE override_controls ENABLE ROW LEVEL SECURITY;

-- Everyone can read override controls (frontend checks feature flags)
CREATE POLICY "Override controls are readable"
  ON override_controls FOR SELECT
  USING (true);

-- Only service role (Edge Functions) can modify override controls
-- No UPDATE/INSERT policy for anon/authenticated = blocked by default
