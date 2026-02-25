-- PIF Selection-Connection MVP — Initial Schema
-- Version: 1.0.0
-- Matches architecture doc v1.2.1

-- ============================================================
-- MEMBERS
-- ============================================================
CREATE TABLE members (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id       UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT UNIQUE NOT NULL,
  display_name       TEXT NOT NULL,
  tier_id            TEXT NOT NULL DEFAULT 'design_and_go'
                     CHECK (tier_id IN ('design_and_go','emerging','surging','converging','diverging')),
  joined_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_verified     BOOLEAN NOT NULL DEFAULT false,
  terms_accepted_at  TIMESTAMPTZ,
  avatar_url         TEXT,
  bio                TEXT,
  -- Earning member verification
  phone_verified     BOOLEAN NOT NULL DEFAULT false,
  tax_info_submitted BOOLEAN NOT NULL DEFAULT false,
  w9_submitted       BOOLEAN NOT NULL DEFAULT false,
  payout_enabled     BOOLEAN NOT NULL DEFAULT false,
  stripe_account_id  TEXT,
  stripe_customer_id TEXT,
  -- The Race: public performance ratios (cannot be hidden — Principle 3)
  completion_ratio   NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
  dissolution_ratio  NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  -- Storage tracking
  storage_used_bytes BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_members_auth ON members(auth_user_id);
CREATE INDEX idx_members_tier ON members(tier_id);
CREATE INDEX idx_members_email ON members(email);

-- ============================================================
-- MEMBER ROLES (separate from tiers — Principle 2: Role vs Tier)
-- ============================================================
CREATE TABLE member_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role_id    TEXT NOT NULL CHECK (role_id IN ('originator','contributor','applicator')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (member_id, role_id)
);

CREATE INDEX idx_member_roles_member ON member_roles(member_id);

-- ============================================================
-- MEMBER COMMUNITIES
-- ============================================================
CREATE TABLE member_communities (
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  community_tag TEXT NOT NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, community_tag)
);

-- ============================================================
-- FILES
-- ============================================================
CREATE TABLE files (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id          UUID NOT NULL,
  uploader_id        UUID NOT NULL REFERENCES members(id),
  version_label      TEXT NOT NULL CHECK (version_label IN ('v1','v1.1','v2','v2.1')),
  file_name          TEXT NOT NULL,
  file_format        TEXT NOT NULL CHECK (file_format IN ('dxf','svg','crv','crv3d','pdf','zip')),
  file_size_bytes    BIGINT NOT NULL,
  storage_path       TEXT NOT NULL,
  preview_image_path TEXT,
  title              TEXT NOT NULL,
  description        TEXT,
  price_cents        INTEGER NOT NULL CHECK (price_cents >= 0),
  stage              TEXT NOT NULL DEFAULT 'draft'
                     CHECK (stage IN ('draft','listed','unlisted','removed')),
  validation_passed  BOOLEAN NOT NULL DEFAULT false,
  validated_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_family ON files(family_id);
CREATE INDEX idx_files_uploader ON files(uploader_id);
CREATE INDEX idx_files_stage ON files(stage);
CREATE INDEX idx_files_stage_created ON files(stage, created_at DESC);

-- ============================================================
-- FILE COMMUNITY TAGS
-- ============================================================
CREATE TABLE file_community_tags (
  file_id       UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  community_tag TEXT NOT NULL,
  PRIMARY KEY (file_id, community_tag)
);

CREATE INDEX idx_file_tags_community ON file_community_tags(community_tag);

-- ============================================================
-- FILE ROYALTY CHAIN
-- Who gets paid per sale. MVP: Originator only.
-- Contributor/Applicator added when Solicitation workflow ships.
-- ============================================================
CREATE TABLE file_royalty_chain (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('originator','contributor','applicator')),
  member_id    UUID NOT NULL REFERENCES members(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  UNIQUE (file_id, role)
);

CREATE INDEX idx_royalty_file ON file_royalty_chain(file_id);

-- ============================================================
-- ORDERS
-- One row per purchase transaction.
-- ============================================================
CREATE TABLE orders (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id                     UUID NOT NULL REFERENCES files(id),
  buyer_email                 TEXT NOT NULL,
  buyer_member_id             UUID REFERENCES members(id),
  -- Amounts (all in cents)
  file_price_cents            INTEGER NOT NULL,
  pif_fee_cents               INTEGER NOT NULL,
  total_cents                 INTEGER NOT NULL,
  -- Stripe
  stripe_checkout_session_id  TEXT UNIQUE,
  stripe_payment_intent_id    TEXT,
  payment_status              TEXT NOT NULL DEFAULT 'pending'
                              CHECK (payment_status IN ('pending','paid','failed','refunded')),
  -- Download delivery
  download_token              TEXT UNIQUE,
  download_expires_at         TIMESTAMPTZ,
  downloaded_at               TIMESTAMPTZ,
  download_attempts           INTEGER NOT NULL DEFAULT 0,
  -- Email delivery
  delivery_email_sent         BOOLEAN NOT NULL DEFAULT false,
  delivery_email_sent_at      TIMESTAMPTZ,
  delivery_email_retries      INTEGER NOT NULL DEFAULT 0,
  -- Timestamps
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at                     TIMESTAMPTZ
);

CREATE INDEX idx_orders_file ON orders(file_id);
CREATE INDEX idx_orders_buyer_email ON orders(buyer_email);
CREATE INDEX idx_orders_buyer_member ON orders(buyer_member_id);
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_download_token ON orders(download_token);
CREATE INDEX idx_orders_stripe_session ON orders(stripe_checkout_session_id);

-- ============================================================
-- PAYOUTS
-- Tracks money owed to each participant in a sale.
-- ============================================================
CREATE TABLE payouts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           UUID NOT NULL REFERENCES orders(id),
  member_id          UUID NOT NULL REFERENCES members(id),
  role               TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents >= 0),
  stripe_transfer_id TEXT,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','transferred','failed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  transferred_at     TIMESTAMPTZ
);

CREATE INDEX idx_payouts_order ON payouts(order_id);
CREATE INDEX idx_payouts_member ON payouts(member_id);
CREATE INDEX idx_payouts_status ON payouts(status);

-- ============================================================
-- OVERRIDE CONTROLS
-- Feature-by-feature activation + master switch (Section 9B).
-- ============================================================
CREATE TABLE override_controls (
  feature_key TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES members(id)
);
