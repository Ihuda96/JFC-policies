-- JFC Policies Platform — V8 (1 of 2): enum value for the CEO "unapprove" action
--
-- Run this file ALONE first, in the Supabase SQL Editor. Then run
-- DEPLOY_V8_CEO_UNAPPROVE.sql in a second, separate run.
--
-- Postgres cannot add an enum value and use it in the same transaction, so
-- this has to be its own step (same reason DEPLOY_NOTIFICATION_TYPE_FIX.sql
-- was split out earlier for 'account_activated').

alter type public.approval_action_type add value if not exists 'unapproved';
