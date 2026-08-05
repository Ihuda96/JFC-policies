import type { PolicyMetadata } from "./types";

interface PolicyDatesInput {
  policy_metadata?: Pick<PolicyMetadata, "issue_date" | "review_date" | "approval_date"> | null;
  approved_at?: string | null;
  final_approved_at?: string | null;
  next_review_at?: string | null;
}

export interface PolicyDates {
  issueDate: string | null;
  effectiveDate: string | null;
  reviewDate: string | null;
}

/** The three dates every policy card should show, consistently sourced
 *  from that same policy: prefer the document's own extracted metadata,
 *  falling back to the matching workflow timestamp only when extraction
 *  hasn't produced a value yet. */
export function policyDates(policy: PolicyDatesInput): PolicyDates {
  return {
    issueDate: policy.policy_metadata?.issue_date ?? policy.approved_at ?? null,
    effectiveDate:
      policy.policy_metadata?.approval_date ?? policy.final_approved_at ?? policy.approved_at ?? null,
    reviewDate: policy.policy_metadata?.review_date ?? policy.next_review_at ?? null,
  };
}
