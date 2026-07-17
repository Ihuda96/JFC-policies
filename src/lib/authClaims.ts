const superAdminRoles = new Set(["superadmin", "super_admin", "system_admin"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function boolish(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizedText(value);
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function hasSuperAdminRole(value: unknown) {
  if (Array.isArray(value)) {
    return value.some((item) => superAdminRoles.has(normalizedText(item)));
  }

  return normalizedText(value)
    .split(/[,\s]+/)
    .some((item) => superAdminRoles.has(item));
}

export function isPlatformSuperAdminMetadata(metadata: unknown) {
  const appMetadata = asRecord(metadata);

  return (
    boolish(appMetadata.superadmin) ||
    boolish(appMetadata.is_super_admin) ||
    boolish(appMetadata.system_admin) ||
    hasSuperAdminRole(appMetadata.role) ||
    hasSuperAdminRole(appMetadata.app_role) ||
    hasSuperAdminRole(appMetadata.roles) ||
    hasSuperAdminRole(appMetadata.permissions)
  );
}
