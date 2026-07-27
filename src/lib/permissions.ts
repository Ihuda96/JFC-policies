import type { Profile } from "./types";

/**
 * Capability helpers. A designated platform super admin holds every
 * capability at once (quality employee + quality manager + system admin);
 * everyone else is gated by their single role. Mirrors the database gates
 * in DEPLOY_ALL_ACCESS_FOR_ACCOUNT.sql.
 */

export function isSuperAdmin(profile?: Profile | null): boolean {
  return Boolean(profile?.is_super_admin);
}

/** May create/upload policies (quality staff, quality manager, or super). */
export function canAuthorPolicies(profile?: Profile | null): boolean {
  if (!profile) return false;
  return (
    isSuperAdmin(profile) ||
    profile.role === "quality_staff" ||
    profile.role === "quality_manager"
  );
}

/** May approve / return policies and manage the review queue. */
export function canManageQuality(profile?: Profile | null): boolean {
  if (!profile) return false;
  return isSuperAdmin(profile) || profile.role === "quality_manager";
}

/** May manage users, settings, and view the audit log. */
export function canAdminister(profile?: Profile | null): boolean {
  if (!profile) return false;
  return isSuperAdmin(profile) || profile.role === "system_admin";
}
