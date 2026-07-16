import type { PolicyStatus, ProfileStatus, VersionStatus } from "../lib/types";
import {
  policyStatusLabels,
  profileStatusLabels,
  versionStatusLabels,
} from "../lib/format";

type Status = PolicyStatus | VersionStatus | ProfileStatus;

const tones: Record<string, string> = {
  draft: "neutral",
  pending_approval: "warning",
  returned_for_revision: "danger",
  resubmitted: "info",
  approved: "success",
  archived: "neutral",
  submitted: "warning",
  returned: "danger",
  superseded: "neutral",
  pending: "warning",
  active: "success",
  disabled: "danger",
};

export function StatusBadge({ status }: { status: Status }) {
  const label =
    (policyStatusLabels as Record<string, string>)[status] ??
    (versionStatusLabels as Record<string, string>)[status] ??
    (profileStatusLabels as Record<string, string>)[status] ??
    status;

  return <span className={`status-badge ${tones[status] ?? "neutral"}`}>{label}</span>;
}
