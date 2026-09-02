// Hand-written to match supabase/migrations/0001_init.sql + 0002_seed_questions.sql.
// Once the Supabase project exists, prefer regenerating this with:
//   npx supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts

export type UserRole = "officer" | "branch_admin";
export type CycleStatus = "draft" | "open" | "completed";
export type AssignmentStatus =
  | "not_started"
  | "in_progress"
  | "submitted"
  | "ai_checked"
  | "reviewed"
  | "expired";
export type OfficerDecision = "confirmed" | "overridden";
export type QuestionScope = "claim" | "branch" | "parts";
export type BranchOpsStatus = "not_started" | "submitted" | "reviewed";
export type DepartmentId = "reception" | "workshop" | "parts" | "warrantyops" | "branchops";
export type SampleMode = "flagged" | "random";
export type InternalAuditStatus = "in_progress" | "finalized";

export interface ConditionalField {
  shows_when_option: string;
  field_type: "number" | "text";
  field_label: string;
}

export interface Database {
  public: {
    Tables: {
      self_audit_branches: {
        Row: { id: string; name: string; code: string; active: boolean; created_at: string };
        Insert: { id?: string; name: string; code: string; active?: boolean; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["self_audit_branches"]["Insert"]>;
        Relationships: [];
      };
      self_audit_users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: UserRole;
          branch_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          role: UserRole;
          branch_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_users"]["Insert"]>;
        Relationships: [];
      };
      self_audit_upload_batches: {
        Row: {
          id: string;
          uploaded_by: string | null;
          uploaded_at: string;
          source_filename: string;
          claim_month: string;
          row_count: number;
        };
        Insert: {
          id?: string;
          uploaded_by?: string | null;
          uploaded_at?: string;
          source_filename: string;
          claim_month: string;
          row_count?: number;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_upload_batches"]["Insert"]>;
        Relationships: [];
      };
      self_audit_claims: {
        Row: {
          id: string;
          branch_id: string;
          upload_batch_id: string;
          claim_number: string;
          work_order_no: string | null;
          has_parts: boolean;
          vin: string | null;
          vehicle_model: string | null;
          mileage: number | null;
          part_serial_number: string | null;
          part_production_date: string | null;
          repair_end_date: string | null;
          dealer_submit_date: string | null;
          creation_date: string;
          raw_row: Record<string, unknown>;
          claim_amount: number | null;
          prior_approval: string | null;
          return_times: number | null;
          return_times_dealer: number | null;
          labor_code: string | null;
          main_part_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          branch_id: string;
          upload_batch_id: string;
          claim_number: string;
          work_order_no?: string | null;
          has_parts?: boolean;
          vin?: string | null;
          vehicle_model?: string | null;
          mileage?: number | null;
          part_serial_number?: string | null;
          part_production_date?: string | null;
          repair_end_date?: string | null;
          dealer_submit_date?: string | null;
          creation_date: string;
          raw_row?: Record<string, unknown>;
          claim_amount?: number | null;
          prior_approval?: string | null;
          return_times?: number | null;
          return_times_dealer?: number | null;
          labor_code?: string | null;
          main_part_name?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_claims"]["Insert"]>;
        Relationships: [];
      };
      self_audit_audit_questions: {
        Row: {
          id: string;
          sort_order: number;
          scope: QuestionScope;
          department: DepartmentId | null;
          text: string;
          help_text: string | null;
          type: string;
          options: string[];
          conditional_field: ConditionalField | null;
          required: boolean;
          ai_checkable: boolean;
          ai_check_note: string | null;
          remediation_suggestion: string | null;
          compliant_options: string[];
          partial_credit_options: string[];
        };
        Insert: Database["public"]["Tables"]["self_audit_audit_questions"]["Row"];
        Update: Partial<Database["public"]["Tables"]["self_audit_audit_questions"]["Row"]>;
        Relationships: [];
      };
      self_audit_audit_photo_types: {
        Row: {
          id: string;
          sort_order: number;
          scope: QuestionScope;
          label: string;
          help_text: string | null;
          required: boolean;
        };
        Insert: Database["public"]["Tables"]["self_audit_audit_photo_types"]["Row"];
        Update: Partial<Database["public"]["Tables"]["self_audit_audit_photo_types"]["Row"]>;
        Relationships: [];
      };
      self_audit_audit_cycles: {
        Row: {
          id: string;
          cycle_month: string;
          claims_month: string;
          status: CycleStatus;
          deadline_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cycle_month: string;
          claims_month: string;
          status?: CycleStatus;
          deadline_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_audit_cycles"]["Insert"]>;
        Relationships: [];
      };
      self_audit_audit_assignments: {
        Row: {
          id: string;
          cycle_id: string;
          branch_id: string;
          claim_id: string;
          status: AssignmentStatus;
          submitted_at: string | null;
          submitted_by: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          branch_id: string;
          claim_id: string;
          status?: AssignmentStatus;
          submitted_at?: string | null;
          submitted_by?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_audit_assignments"]["Insert"]>;
        Relationships: [];
      };
      self_audit_audit_answers: {
        Row: {
          assignment_id: string;
          question_id: string;
          answer_value: string | null;
          conditional_value: string | null;
          updated_at: string;
        };
        Insert: {
          assignment_id: string;
          question_id: string;
          answer_value?: string | null;
          conditional_value?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_audit_answers"]["Insert"]>;
        Relationships: [];
      };
      self_audit_audit_photos: {
        Row: {
          id: string;
          assignment_id: string;
          photo_type_id: string;
          storage_path: string;
          uploaded_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          assignment_id: string;
          photo_type_id: string;
          storage_path: string;
          uploaded_at?: string;
          deleted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_audit_photos"]["Insert"]>;
        Relationships: [];
      };
      self_audit_audit_notes: {
        Row: { assignment_id: string; note_text: string | null; updated_at: string };
        Insert: { assignment_id: string; note_text?: string | null; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["self_audit_audit_notes"]["Insert"]>;
        Relationships: [];
      };
      self_audit_ai_reviews: {
        Row: {
          id: string;
          assignment_id: string;
          question_id: string;
          ai_suggested_value: string | null;
          ai_reasoning: string | null;
          ai_confidence: string | null;
          officer_decision: OfficerDecision | null;
          officer_value: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          assignment_id: string;
          question_id: string;
          ai_suggested_value?: string | null;
          ai_reasoning?: string | null;
          ai_confidence?: string | null;
          officer_decision?: OfficerDecision | null;
          officer_value?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_ai_reviews"]["Insert"]>;
        Relationships: [];
      };
      self_audit_audit_results: {
        Row: {
          id: string;
          cycle_id: string;
          branch_id: string;
          score_pct: number;
          per_question_breakdown: Record<string, unknown>;
          finalized_by: string | null;
          finalized_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          branch_id: string;
          score_pct: number;
          per_question_breakdown?: Record<string, unknown>;
          finalized_by?: string | null;
          finalized_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_audit_results"]["Insert"]>;
        Relationships: [];
      };
      self_audit_branch_operation_progress: {
        Row: {
          cycle_id: string;
          branch_id: string;
          status: BranchOpsStatus;
          submitted_at: string | null;
          submitted_by: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
        };
        Insert: {
          cycle_id: string;
          branch_id: string;
          status?: BranchOpsStatus;
          submitted_at?: string | null;
          submitted_by?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_branch_operation_progress"]["Insert"]>;
        Relationships: [];
      };
      self_audit_branch_operation_answers: {
        Row: {
          cycle_id: string;
          branch_id: string;
          question_id: string;
          answer_value: string | null;
          officer_value: string | null;
          updated_at: string;
        };
        Insert: {
          cycle_id: string;
          branch_id: string;
          question_id: string;
          answer_value?: string | null;
          officer_value?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_branch_operation_answers"]["Insert"]>;
        Relationships: [];
      };
      self_audit_branch_operation_photos: {
        Row: {
          cycle_id: string;
          branch_id: string;
          photo_type_id: string;
          storage_path: string;
          uploaded_at: string;
          deleted_at: string | null;
        };
        Insert: {
          cycle_id: string;
          branch_id: string;
          photo_type_id: string;
          storage_path: string;
          uploaded_at?: string;
          deleted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_branch_operation_photos"]["Insert"]>;
        Relationships: [];
      };
      self_audit_internal_audits: {
        Row: {
          id: string;
          branch_id: string | null;
          date_from: string | null;
          date_to: string | null;
          sample_size: number;
          sample_mode: SampleMode;
          max_per_part: number | null;
          auditor_id: string | null;
          manager_name: string | null;
          status: InternalAuditStatus;
          closing_statement: string | null;
          score_pct: number | null;
          per_question_breakdown: Record<string, unknown>;
          created_at: string;
          finalized_at: string | null;
        };
        Insert: {
          id?: string;
          branch_id?: string | null;
          date_from?: string | null;
          date_to?: string | null;
          sample_size: number;
          sample_mode?: SampleMode;
          max_per_part?: number | null;
          auditor_id?: string | null;
          manager_name?: string | null;
          status?: InternalAuditStatus;
          closing_statement?: string | null;
          score_pct?: number | null;
          per_question_breakdown?: Record<string, unknown>;
          created_at?: string;
          finalized_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_internal_audits"]["Insert"]>;
        Relationships: [];
      };
      self_audit_internal_audit_claims: {
        Row: {
          id: string;
          internal_audit_id: string;
          claim_id: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          internal_audit_id: string;
          claim_id: string;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_internal_audit_claims"]["Insert"]>;
        Relationships: [];
      };
      self_audit_internal_audit_answers: {
        Row: {
          internal_audit_claim_id: string;
          question_id: string;
          answer_value: string | null;
          updated_at: string;
        };
        Insert: {
          internal_audit_claim_id: string;
          question_id: string;
          answer_value?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_internal_audit_answers"]["Insert"]>;
        Relationships: [];
      };
      self_audit_internal_audit_notes: {
        Row: {
          internal_audit_claim_id: string;
          note_text: string | null;
          updated_at: string;
        };
        Insert: {
          internal_audit_claim_id: string;
          note_text?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_internal_audit_notes"]["Insert"]>;
        Relationships: [];
      };
      self_audit_internal_audit_branch_answers: {
        Row: {
          internal_audit_id: string;
          question_id: string;
          answer_value: string | null;
          updated_at: string;
        };
        Insert: {
          internal_audit_id: string;
          question_id: string;
          answer_value?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_internal_audit_branch_answers"]["Insert"]>;
        Relationships: [];
      };
      self_audit_internal_audit_department_remarks: {
        Row: {
          internal_audit_id: string;
          department_id: DepartmentId;
          remark_text: string | null;
        };
        Insert: {
          internal_audit_id: string;
          department_id: DepartmentId;
          remark_text?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["self_audit_internal_audit_department_remarks"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
      cycle_status: CycleStatus;
      assignment_status: AssignmentStatus;
      officer_decision: OfficerDecision;
      branch_ops_status: BranchOpsStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
