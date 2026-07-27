import { Crown } from "lucide-react";

/** Luxury shiny purple chip shown only for the designated super account. */
export function SuperAdminChip() {
  return (
    <span className="super-chip" title="وصول كامل لكل الصلاحيات">
      <Crown aria-hidden="true" />
      <span>وصول كامل</span>
    </span>
  );
}
