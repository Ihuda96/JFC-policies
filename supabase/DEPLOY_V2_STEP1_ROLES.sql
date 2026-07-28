-- JFC Policies Platform — V2 upgrade, STEP 1 of 2
--
-- Run this file FIRST in the Supabase SQL Editor, then run
-- DEPLOY_V2_STEP2_FEATURES.sql.
--
-- Why two files: PostgreSQL cannot use a newly added enum value inside the
-- same transaction that adds it. This step only adds the two new roles so
-- that step 2 can reference them.
--
-- Safe to re-run.

alter type public.app_role add value if not exists 'department_staff';

alter type public.app_role add value if not exists 'ceo';
