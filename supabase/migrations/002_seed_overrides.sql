-- Seed override controls with all MVP feature flags.
-- All disabled by default — Dennis enables them as each feature is ready.

INSERT INTO override_controls (feature_key, enabled, description) VALUES
  ('master_switch',         false, 'Full platform on/off. When off, all public features show maintenance message.'),
  ('member_registration',   false, 'Allow new member sign-ups.'),
  ('earning_verification',  false, 'Allow earning member verification flow (phone, tax, W-9, Stripe Connect).'),
  ('file_upload',           false, 'Allow file uploads by Originators.'),
  ('marketplace_browse',    false, 'Allow browsing and filtering the marketplace.'),
  ('marketplace_purchase',  false, 'Allow purchasing files from the marketplace.'),
  ('payouts',               false, 'Allow Stripe Connect transfers to Originators.'),
  ('download_delivery',     false, 'Allow download link generation and email delivery.')
ON CONFLICT (feature_key) DO NOTHING;
