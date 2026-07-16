export type AppRole = "quality_staff" | "quality_manager" | "system_admin";

export type ProfileStatus = "pending" | "active" | "disabled";

export type PolicyStatus =
  | "draft"
  | "pending_approval"
  | "returned_for_revision"
  | "resubmitted"
  | "approved"
  | "archived";

export type VersionStatus =
  | "draft"
  | "submitted"
  | "returned"
  | "approved"
  | "superseded"
  | "archived";

export type FileKind = "original" | "preview" | "approved_pdf";

export type ProcessingStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "needs_classification_review";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  status: ProfileStatus;
  department: string | null;
  job_title: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface Policy {
  id: string;
  title: string;
  policy_number: string | null;
  status: PolicyStatus;
  owner_id: string;
  created_by: string;
  assigned_manager_id: string | null;
  current_version_id: string | null;
  approved_version_id: string | null;
  document_type: string;
  owner_department: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  next_review_at: string | null;
  archived_at: string | null;
  profiles?: Pick<Profile, "full_name" | "email"> | null;
}

export interface PolicyVersion {
  id: string;
  policy_id: string;
  version_number: number;
  status: VersionStatus;
  source_file_name: string;
  submitted_by: string | null;
  submitted_at: string | null;
  returned_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  manager_note: string | null;
  change_summary: string | null;
  created_at: string;
}

export interface PolicyFile {
  id: string;
  policy_id: string;
  version_id: string;
  bucket_id: string;
  storage_path: string;
  file_kind: FileKind;
  file_name: string;
  content_type: string;
  file_size: number;
  page_count: number | null;
  preview_ready: boolean;
  created_at: string;
}

export interface PolicyMetadata {
  policy_id: string;
  extracted_title: string | null;
  extracted_policy_number: string | null;
  extracted_version: string | null;
  issuing_department: string | null;
  issue_date: string | null;
  review_date: string | null;
  approval_date: string | null;
  language: string;
  confidence: number | null;
  extraction_status: ProcessingStatus;
  needs_review: boolean;
  search_text: string | null;
  updated_at: string;
}

export interface ReviewComment {
  id: string;
  policy_id: string;
  version_id: string;
  author_id: string;
  page_number: number | null;
  comment_text: string;
  resolved_at: string | null;
  created_at: string;
}

export interface ApprovalAction {
  id: string;
  policy_id: string;
  version_id: string;
  actor_id: string;
  action: "submitted" | "returned" | "resubmitted" | "approved" | "archived";
  comment: string | null;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  recipient_id: string;
  policy_id: string | null;
  version_id: string | null;
  type: string;
  title_ar: string;
  body_ar: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: number;
  event_time: string;
  actor_id: string | null;
  event_type: string;
  entity_table: string | null;
  entity_id: string | null;
  policy_id: string | null;
  metadata: Record<string, unknown>;
}

export interface FileProcessingJob {
  id: string;
  policy_id: string;
  version_id: string;
  file_id: string;
  job_type: string;
  status: ProcessingStatus;
  attempts: number;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PolicyBundle extends Policy {
  policy_versions?: PolicyVersion[];
  policy_files?: PolicyFile[];
  policy_metadata?: PolicyMetadata | null;
  file_processing_jobs?: FileProcessingJob[];
}
