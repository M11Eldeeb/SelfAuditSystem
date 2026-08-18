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
  | "reviewed";
export type OfficerDecision = "confirmed" | "overridden";

export interface ConditionalField {
  shows_when_option: string;
  field_type: "number" | "text";
  field_label: string;
}

export interface Database {
  public: {
    Tables: {
      branches: {
        Row: { id: string; name: string; code: string; active: boolean; created_at: string };
        Insert: { id?: string; name: string; code: string; active?: boolean; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["branches"]["Insert"]>;
        Relationships: [];
      };
      users: {
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
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
        Relationships: [];
      };
      upload_batches: {
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
        Update: Partial<Database["public"]["Tables"]["upload_batches"]["Insert"]>;
        Relationships: [];
      };
      claims: {
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
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["claims"]["Insert"]>;
        Relationships: [];
      };
      audit_questions: {
        Row: {
          id: string;
          sort_order: number;
          text: string;
          help_text: string | null;
          type: string;
          options: string[];
          conditional_field: ConditionalField | null;
          required: boolean;
          ai_checkable: boolean;
          ai_check_note: string | null;
          compliant_options: string[];
          partial_credit_options: string[];
        };
        Insert: Database["public"]["Tables"]["audit_questions"]["Row"];
        Update: Partial<Database["public"]["Tables"]["audit_questions"]["Row"]>;
        Relationships: [];
      };
      audit_photo_types: {
        Row: {
          id: string;
          sort_order: number;
          label: string;
          help_text: string | null;
          required: boolean;
        };
        Insert: Database["public"]["Tables"]["audit_photo_types"]["Row"];
        Update: Partial<Database["public"]["Tables"]["audit_photo_types"]["Row"]>;
        Relationships: [];
      };
      audit_cycles: {
        Row: {
          id: string;
          cycle_month: string;
          claims_month: string;
          status: CycleStatus;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cycle_month: string;
          claims_month: string;
          status?: CycleStatus;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_cycles"]["Insert"]>;
        Relationships: [];
      };
      audit_assignments: {
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
        Update: Partial<Database["public"]["Tables"]["audit_assignments"]["Insert"]>;
        Relationships: [];
      };
      audit_answers: {
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
        Update: Partial<Database["public"]["Tables"]["audit_answers"]["Insert"]>;
        Relationships: [];
      };
      audit_photos: {
        Row: {
          id: string;
          assignment_id: string;
          photo_type_id: string;
          storage_path: string;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          assignment_id: string;
          photo_type_id: string;
          storage_path: string;
          uploaded_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_photos"]["Insert"]>;
        Relationships: [];
      };
      audit_notes: {
        Row: { assignment_id: string; note_text: string | null; updated_at: string };
        Insert: { assignment_id: string; note_text?: string | null; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["audit_notes"]["Insert"]>;
        Relationships: [];
      };
      ai_reviews: {
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
        Update: Partial<Database["public"]["Tables"]["ai_reviews"]["Insert"]>;
        Relationships: [];
      };
      audit_results: {
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
        Update: Partial<Database["public"]["Tables"]["audit_results"]["Insert"]>;
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
    };
    CompositeTypes: Record<string, never>;
  };
}
