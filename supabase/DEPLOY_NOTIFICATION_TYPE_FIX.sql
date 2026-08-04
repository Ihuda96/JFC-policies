-- JFC Policies Platform — fix: missing 'account_activated' notification type
--
-- Run this by itself in the Supabase SQL Editor (as its own "Run"), not
-- pasted together with other scripts — Postgres cannot use a brand-new enum
-- value inside the same transaction that adds it, so this has to be its own
-- statement/transaction, the same reason DEPLOY_V2_STEP1_ROLES.sql is split
-- out from DEPLOY_V2_STEP2_FEATURES.sql. Safe to re-run.
--
-- admin_approve_signup (DEPLOY_V2_STEP2_FEATURES.sql) has always inserted a
-- notification with type = 'account_activated', but that value was never
-- added to the notification_type enum — so every time an admin approved a
-- department-staff signup, the RPC raised an "invalid input value for enum"
-- error instead of activating the account. No code change is needed beyond
-- this: the function already writes 'account_activated' literally, so once
-- the enum accepts it, admin_approve_signup starts working as originally
-- intended.

alter type public.notification_type add value if not exists 'account_activated';
