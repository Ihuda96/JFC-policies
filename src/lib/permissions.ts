import type { Profile } from "./types";

/**
 * Capability helpers. A designated platform super admin holds every
 * capability at once (quality employee + quality manager + system admin);
 * everyone else is gated by their single role. Mirrors the database gates
 * in the Supabase deploy files.
 */

export function isSuperAdmin(profile?: Profile | null): boolean {
  return Boolean(profile?.is_super_admin);
}

/** May create/upload policies. Department employees may only do this. */
export function canAuthorPolicies(profile?: Profile | null): boolean {
  if (!profile) return false;
  return (
    isSuperAdmin(profile) ||
    profile.role === "quality_staff" ||
    profile.role === "quality_manager" ||
    profile.role === "department_staff"
  );
}

/** The quality team: approves policies or sends them back with notes. */
export function canReviewPolicies(profile?: Profile | null): boolean {
  if (!profile) return false;
  return (
    isSuperAdmin(profile) ||
    profile.role === "quality_manager" ||
    profile.role === "quality_staff"
  );
}

/** Quality management duties (reports, archiving any policy). */
export function canManageQuality(profile?: Profile | null): boolean {
  if (!profile) return false;
  return isSuperAdmin(profile) || profile.role === "quality_manager";
}

/** May manage users, settings, sections and view the audit log. */
export function canAdminister(profile?: Profile | null): boolean {
  if (!profile) return false;
  return isSuperAdmin(profile) || profile.role === "system_admin";
}

/** The executive office: gives the final approval. */
export function isExecutive(profile?: Profile | null): boolean {
  if (!profile) return false;
  return isSuperAdmin(profile) || profile.role === "ceo";
}

/** Department employees only add policies and read their own department. */
export function isDepartmentStaff(profile?: Profile | null): boolean {
  return profile?.role === "department_staff";
}
