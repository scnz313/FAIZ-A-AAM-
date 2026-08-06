export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      academic_years: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          label: string
          reference: string
          starts_on: string
          status: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          label: string
          reference?: string
          starts_on: string
          status?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          label?: string
          reference?: string
          starts_on?: string
          status?: string
        }
        Relationships: []
      }
      access_revalidation: {
        Row: {
          account_id: string
          security_version: number
          updated_at: string
        }
        Insert: {
          account_id: string
          security_version?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          security_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_revalidation_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_invitations: {
        Row: {
          accepted_at: string | null
          account_id: string | null
          contact: string
          created_at: string
          created_by_account_id: string | null
          expires_at: string
          id: string
          invitation_hash: string
          purpose: string
          reference: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          account_id?: string | null
          contact: string
          created_at?: string
          created_by_account_id?: string | null
          expires_at: string
          id?: string
          invitation_hash: string
          purpose: string
          reference?: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          account_id?: string | null
          contact?: string
          created_at?: string
          created_by_account_id?: string | null
          expires_at?: string
          id?: string
          invitation_hash?: string
          purpose?: string
          reference?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_invitations_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_application_versions: {
        Row: {
          application_id: string
          created_at: string
          id: string
          schema_version: number
          snapshot: Json
          submitted_by_account_id: string
          version: number
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          schema_version?: number
          snapshot: Json
          submitted_by_account_id: string
          version: number
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          schema_version?: number
          snapshot?: Json
          submitted_by_account_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "admission_application_versions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_application_versions_submitted_by_account_id_fkey"
            columns: ["submitted_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_applications: {
        Row: {
          academic_year_id: string
          created_at: string
          current_status: string
          grade_id: string
          id: string
          owner_account_id: string
          parent_contact: string | null
          parent_name: string
          reference: string
          student_name: string
          submitted_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          current_status?: string
          grade_id: string
          id?: string
          owner_account_id: string
          parent_contact?: string | null
          parent_name: string
          reference?: string
          student_name: string
          submitted_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          current_status?: string
          grade_id?: string
          id?: string
          owner_account_id?: string
          parent_contact?: string | null
          parent_name?: string
          reference?: string
          student_name?: string
          submitted_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "admission_applications_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_applications_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_applications_owner_account_id_fkey"
            columns: ["owner_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_assessments: {
        Row: {
          application_id: string
          approved_by_account_id: string
          created_at: string
          id: string
          notes: string | null
        }
        Insert: {
          application_id: string
          approved_by_account_id: string
          created_at?: string
          id?: string
          notes?: string | null
        }
        Update: {
          application_id?: string
          approved_by_account_id?: string
          created_at?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admission_assessments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_assessments_approved_by_account_id_fkey"
            columns: ["approved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_documents: {
        Row: {
          application_id: string
          document_id: string
          id: string
        }
        Insert: {
          application_id: string
          document_id: string
          id?: string
        }
        Update: {
          application_id?: string
          document_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_drafts: {
        Row: {
          application_id: string
          draft: Json
          expires_at: string
          id: string
          schema_version: number
          updated_at: string
        }
        Insert: {
          application_id: string
          draft?: Json
          expires_at: string
          id?: string
          schema_version?: number
          updated_at?: string
        }
        Update: {
          application_id?: string
          draft?: Json
          expires_at?: string
          id?: string
          schema_version?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_drafts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_events: {
        Row: {
          application_id: string
          copy: string
          created_at: string
          event_type: string
          id: string
          visible_to_applicant: boolean
        }
        Insert: {
          application_id: string
          copy: string
          created_at?: string
          event_type: string
          id?: string
          visible_to_applicant?: boolean
        }
        Update: {
          application_id?: string
          copy?: string
          created_at?: string
          event_type?: string
          id?: string
          visible_to_applicant?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "admission_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_offers: {
        Row: {
          academic_year_id: string
          admission_invoice_ref: string | null
          application_id: string
          conditions: Json
          created_at: string
          decided_by_account_id: string | null
          expires_at: string
          fee_required: boolean
          grade_id: string
          id: string
          responded_at: string | null
          response: string
          updated_at: string
          version: number
        }
        Insert: {
          academic_year_id: string
          admission_invoice_ref?: string | null
          application_id: string
          conditions?: Json
          created_at?: string
          decided_by_account_id?: string | null
          expires_at: string
          fee_required?: boolean
          grade_id: string
          id?: string
          responded_at?: string | null
          response?: string
          updated_at?: string
          version?: number
        }
        Update: {
          academic_year_id?: string
          admission_invoice_ref?: string | null
          application_id?: string
          conditions?: Json
          created_at?: string
          decided_by_account_id?: string | null
          expires_at?: string
          fee_required?: boolean
          grade_id?: string
          id?: string
          responded_at?: string | null
          response?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "admission_offers_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_offers_decided_by_account_id_fkey"
            columns: ["decided_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_offers_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_reviews: {
        Row: {
          action: string
          application_id: string
          created_at: string
          id: string
          officer_account_id: string
          private_note: string | null
          visible_reason: string | null
        }
        Insert: {
          action: string
          application_id: string
          created_at?: string
          id?: string
          officer_account_id: string
          private_note?: string | null
          visible_reason?: string | null
        }
        Update: {
          action?: string
          application_id?: string
          created_at?: string
          id?: string
          officer_account_id?: string
          private_note?: string | null
          visible_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admission_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_reviews_officer_account_id_fkey"
            columns: ["officer_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_windows: {
        Row: {
          academic_year_id: string
          capacity: number | null
          closes_at: string
          created_at: string
          grade_id: string
          id: string
          opens_at: string
          policy: Json
          reference: string
          status: string
          updated_at: string
        }
        Insert: {
          academic_year_id: string
          capacity?: number | null
          closes_at: string
          created_at?: string
          grade_id: string
          id?: string
          opens_at: string
          policy?: Json
          reference?: string
          status?: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string
          capacity?: number | null
          closes_at?: string
          created_at?: string
          grade_id?: string
          id?: string
          opens_at?: string
          policy?: Json
          reference?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_windows_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_windows_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_components: {
        Row: {
          exam_definition_id: string
          id: string
          max_marks: number
          name: string
          sort_order: number
          subject_id: string
          weight: number | null
        }
        Insert: {
          exam_definition_id: string
          id?: string
          max_marks: number
          name: string
          sort_order?: number
          subject_id: string
          weight?: number | null
        }
        Update: {
          exam_definition_id?: string
          id?: string
          max_marks?: number
          name?: string
          sort_order?: number
          subject_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_components_exam_definition_id_fkey"
            columns: ["exam_definition_id"]
            isOneToOne: false
            referencedRelation: "exam_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_components_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_account_id: string | null
          actor_label: string
          correlation_id: string | null
          created_at: string
          id: string
          outcome: string
          reason: string | null
          reference: string
          target_reference: string
          target_type: string
        }
        Insert: {
          action: string
          actor_account_id?: string | null
          actor_label: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          outcome: string
          reason?: string | null
          reference?: string
          target_reference: string
          target_type: string
        }
        Update: {
          action?: string
          actor_account_id?: string | null
          actor_label?: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          outcome?: string
          reason?: string | null
          reference?: string
          target_reference?: string
          target_type?: string
        }
        Relationships: []
      }
      concessions: {
        Row: {
          amount_paise: number
          approved_by_account_id: string
          created_at: string
          id: string
          invoice_id: string
          reason: string
        }
        Insert: {
          amount_paise: number
          approved_by_account_id: string
          created_at?: string
          id?: string
          invoice_id: string
          reason: string
        }
        Update: {
          amount_paise?: number
          approved_by_account_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "concessions_approved_by_account_id_fkey"
            columns: ["approved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concessions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      content_documents: {
        Row: {
          content_item_id: string
          document_id: string
          id: string
        }
        Insert: {
          content_item_id: string
          document_id: string
          id?: string
        }
        Update: {
          content_item_id?: string
          document_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_documents_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      content_items: {
        Row: {
          created_at: string
          current_status: string
          id: string
          kind: string
          reference: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_status?: string
          id?: string
          kind?: string
          reference?: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_status?: string
          id?: string
          kind?: string
          reference?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      content_versions: {
        Row: {
          author_account_id: string
          body: Json
          content_item_id: string
          created_at: string
          id: string
          published_at: string | null
          review_status: string
          title: string
          version: number
        }
        Insert: {
          author_account_id: string
          body?: Json
          content_item_id: string
          created_at?: string
          id?: string
          published_at?: string | null
          review_status?: string
          title: string
          version: number
        }
        Update: {
          author_account_id?: string
          body?: Json
          content_item_id?: string
          created_at?: string
          id?: string
          published_at?: string | null
          review_status?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_versions_author_account_id_fkey"
            columns: ["author_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_versions_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      document_processing_events: {
        Row: {
          created_at: string
          detail: string | null
          document_id: string
          event_type: string
          id: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          document_id: string
          event_type: string
          id?: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          document_id?: string
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_processing_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: string
          checksum: string | null
          created_at: string
          id: string
          mime_type: string
          object_key: string
          owner_domain: string
          owner_record_id: string
          reference: string
          retention_class: string
          safe_filename: string
          scan_status: string
          size_bytes: number
          updated_at: string
          uploaded_by_account_id: string
          version: number
          visibility: string
        }
        Insert: {
          category: string
          checksum?: string | null
          created_at?: string
          id?: string
          mime_type: string
          object_key: string
          owner_domain: string
          owner_record_id: string
          reference?: string
          retention_class?: string
          safe_filename: string
          scan_status?: string
          size_bytes: number
          updated_at?: string
          uploaded_by_account_id: string
          version?: number
          visibility?: string
        }
        Update: {
          category?: string
          checksum?: string | null
          created_at?: string
          id?: string
          mime_type?: string
          object_key?: string
          owner_domain?: string
          owner_record_id?: string
          reference?: string
          retention_class?: string
          safe_filename?: string
          scan_status?: string
          size_bytes?: number
          updated_at?: string
          uploaded_by_account_id?: string
          version?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_uploaded_by_account_id_fkey"
            columns: ["uploaded_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          created_by_account_id: string
          email_hash: string
          id: string
          note: string | null
          reason: string
          suppressed_at: string
        }
        Insert: {
          created_by_account_id: string
          email_hash: string
          id?: string
          note?: string | null
          reason: string
          suppressed_at?: string
        }
        Update: {
          created_by_account_id?: string
          email_hash?: string
          id?: string
          note?: string | null
          reason?: string
          suppressed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_conversions: {
        Row: {
          application_id: string
          created_at: string
          enrollment_id: string
          guardian_link_id: string | null
          id: string
          matched_existing: boolean
          reference: string
          result: Json | null
          student_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          enrollment_id: string
          guardian_link_id?: string | null
          id?: string
          matched_existing?: boolean
          reference?: string
          result?: Json | null
          student_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          enrollment_id?: string
          guardian_link_id?: string | null
          id?: string
          matched_existing?: boolean
          reference?: string
          result?: Json | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_conversions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_conversions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_conversions_guardian_link_id_fkey"
            columns: ["guardian_link_id"]
            isOneToOne: false
            referencedRelation: "guardian_student_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_conversions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          academic_year_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          grade_section_id: string
          id: string
          reference: string
          status: string
          student_id: string
          updated_at: string
          version: number
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          grade_section_id: string
          id?: string
          reference?: string
          status?: string
          student_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          grade_section_id?: string
          id?: string
          reference?: string
          status?: string
          student_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_definitions: {
        Row: {
          academic_year_id: string
          created_at: string
          grade_section_id: string
          id: string
          policy_version: number | null
          reference: string
          status: string
          term: string
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          grade_section_id: string
          id?: string
          policy_version?: number | null
          reference?: string
          status?: string
          term: string
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          grade_section_id?: string
          id?: string
          policy_version?: number | null
          reference?: string
          status?: string
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_definitions_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_definitions_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_schedule_entries: {
        Row: {
          ends_at: string
          exam_date: string
          id: string
          room_id: string | null
          schedule_version_id: string
          starts_at: string
          subject_id: string
        }
        Insert: {
          ends_at: string
          exam_date: string
          id?: string
          room_id?: string | null
          schedule_version_id: string
          starts_at: string
          subject_id: string
        }
        Update: {
          ends_at?: string
          exam_date?: string
          id?: string
          room_id?: string | null
          schedule_version_id?: string
          starts_at?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_schedule_entries_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_schedule_entries_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "exam_schedule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_schedule_entries_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_schedule_versions: {
        Row: {
          created_at: string
          grade_section_id: string
          id: string
          reference: string
          status: string
          version: number
        }
        Insert: {
          created_at?: string
          grade_section_id: string
          id?: string
          reference?: string
          status?: string
          version?: number
        }
        Update: {
          created_at?: string
          grade_section_id?: string
          id?: string
          reference?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_schedule_versions_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          code: string
          enabled: boolean
          id: string
          note: string | null
          updated_at: string
        }
        Insert: {
          code: string
          enabled?: boolean
          id?: string
          note?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          enabled?: boolean
          id?: string
          note?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fee_schedule_items: {
        Row: {
          amount_paise: number
          code: string
          currency: string
          id: string
          kind: string
          label: string
          period: string | null
          schedule_version_id: string
          sort_order: number
        }
        Insert: {
          amount_paise: number
          code: string
          currency?: string
          id?: string
          kind?: string
          label: string
          period?: string | null
          schedule_version_id: string
          sort_order?: number
        }
        Update: {
          amount_paise?: number
          code?: string
          currency?: string
          id?: string
          kind?: string
          label?: string
          period?: string | null
          schedule_version_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "fee_schedule_items_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "fee_schedule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_schedule_versions: {
        Row: {
          approved_by_account_id: string | null
          created_at: string
          effective_from: string | null
          id: string
          policy: Json
          reference: string
          status: string
          version: number
        }
        Insert: {
          approved_by_account_id?: string | null
          created_at?: string
          effective_from?: string | null
          id?: string
          policy?: Json
          reference?: string
          status?: string
          version: number
        }
        Update: {
          approved_by_account_id?: string | null
          created_at?: string
          effective_from?: string | null
          id?: string
          policy?: Json
          reference?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fee_schedule_versions_approved_by_account_id_fkey"
            columns: ["approved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_events: {
        Row: {
          created_at: string
          id: string
          normalized: Json | null
          payload_hash: string
          processed_at: string | null
          provider: string
          provider_event_id: string
          reference: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          normalized?: Json | null
          payload_hash: string
          processed_at?: string | null
          provider: string
          provider_event_id: string
          reference?: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          normalized?: Json | null
          payload_hash?: string
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          reference?: string
          status?: string
        }
        Relationships: []
      }
      grade_band_versions: {
        Row: {
          bands: Json
          created_at: string
          id: string
          status: string
          version: number
        }
        Insert: {
          bands?: Json
          created_at?: string
          id?: string
          status?: string
          version: number
        }
        Update: {
          bands?: Json
          created_at?: string
          id?: string
          status?: string
          version?: number
        }
        Relationships: []
      }
      grade_sections: {
        Row: {
          academic_year_id: string
          created_at: string
          grade_id: string
          id: string
          reference: string
          section_label: string
          status: string
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          grade_id: string
          id?: string
          reference?: string
          section_label: string
          status?: string
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          grade_id?: string
          id?: string
          reference?: string
          section_label?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "grade_sections_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grade_sections_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
        ]
      }
      grades: {
        Row: {
          code: string
          created_at: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      guardian_link_capabilities: {
        Row: {
          capability: string
          link_id: string
        }
        Insert: {
          capability: string
          link_id: string
        }
        Update: {
          capability?: string
          link_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_link_capabilities_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "guardian_student_links"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_student_links: {
        Row: {
          approved_at: string | null
          approved_by_account_id: string | null
          contact_priority: number
          created_at: string
          effective_from: string | null
          effective_to: string | null
          guardian_id: string
          id: string
          is_billing_contact: boolean
          is_emergency_contact: boolean
          reference: string
          rejection_reason: string | null
          relationship_label: string
          restriction_reason: string | null
          status: string
          student_id: string
          updated_at: string
          verification_source: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by_account_id?: string | null
          contact_priority?: number
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          guardian_id: string
          id?: string
          is_billing_contact?: boolean
          is_emergency_contact?: boolean
          reference?: string
          rejection_reason?: string | null
          relationship_label: string
          restriction_reason?: string | null
          status?: string
          student_id: string
          updated_at?: string
          verification_source?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by_account_id?: string | null
          contact_priority?: number
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          guardian_id?: string
          id?: string
          is_billing_contact?: boolean
          is_emergency_contact?: boolean
          reference?: string
          rejection_reason?: string | null
          relationship_label?: string
          restriction_reason?: string | null
          status?: string
          student_id?: string
          updated_at?: string
          verification_source?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "guardian_student_links_approved_by_account_id_fkey"
            columns: ["approved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_student_links_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_student_links_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      guardians: {
        Row: {
          created_at: string
          id: string
          person_id: string
          reference: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          person_id: string
          reference?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          person_id?: string
          reference?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardians_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_records: {
        Row: {
          created_at: string
          id: string
          operation_key: string
          request_hash: string
          result: Json | null
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          operation_key: string
          request_hash: string
          result?: Json | null
          state: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          operation_key?: string
          request_hash?: string
          result?: Json | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      in_app_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          read_at: string | null
          recipient_account_id: string
          target_reference: string | null
          target_type: string | null
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          read_at?: string | null
          recipient_account_id: string
          target_reference?: string | null
          target_type?: string | null
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          read_at?: string | null
          recipient_account_id?: string
          target_reference?: string | null
          target_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "in_app_notifications_recipient_account_id_fkey"
            columns: ["recipient_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_documents: {
        Row: {
          document_id: string
          id: string
          invoice_id: string
        }
        Insert: {
          document_id: string
          id?: string
          invoice_id: string
        }
        Update: {
          document_id?: string
          id?: string
          invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_documents_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount_paise: number
          created_at: string
          currency: string
          id: string
          invoice_id: string
          kind: string
          label: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          currency?: string
          id?: string
          invoice_id: string
          kind?: string
          label: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          currency?: string
          id?: string
          invoice_id?: string
          kind?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          academic_year_id: string
          applicant_ref: string | null
          created_at: string
          due_date: string
          enrollment_id: string | null
          id: string
          issue_date: string
          reference: string
          schedule_version_id: string | null
          status: string
          student_id: string | null
          term: string
          updated_at: string
          version: number
        }
        Insert: {
          academic_year_id: string
          applicant_ref?: string | null
          created_at?: string
          due_date: string
          enrollment_id?: string | null
          id?: string
          issue_date?: string
          reference?: string
          schedule_version_id?: string | null
          status?: string
          student_id?: string | null
          term: string
          updated_at?: string
          version?: number
        }
        Update: {
          academic_year_id?: string
          applicant_ref?: string | null
          created_at?: string
          due_date?: string
          enrollment_id?: string | null
          id?: string
          issue_date?: string
          reference?: string
          schedule_version_id?: string | null
          status?: string
          student_id?: string | null
          term?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_schedule_version_id_fkey"
            columns: ["schedule_version_id"]
            isOneToOne: false
            referencedRelation: "fee_schedule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_versions: {
        Row: {
          application_id: string
          created_at: string
          id: string
          snapshot: Json
          submitted_by_account_id: string
          version: number
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          snapshot: Json
          submitted_by_account_id: string
          version: number
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          snapshot?: Json
          submitted_by_account_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_application_versions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_application_versions_submitted_by_account_id_fkey"
            columns: ["submitted_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      job_applications: {
        Row: {
          applicant_name: string
          created_at: string
          current_status: string
          id: string
          owner_account_id: string
          reference: string
          updated_at: string
          vacancy_id: string
          vacancy_version: number
          version: number
        }
        Insert: {
          applicant_name: string
          created_at?: string
          current_status?: string
          id?: string
          owner_account_id: string
          reference?: string
          updated_at?: string
          vacancy_id: string
          vacancy_version: number
          version?: number
        }
        Update: {
          applicant_name?: string
          created_at?: string
          current_status?: string
          id?: string
          owner_account_id?: string
          reference?: string
          updated_at?: string
          vacancy_id?: string
          vacancy_version?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_applications_owner_account_id_fkey"
            columns: ["owner_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "job_vacancies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_vacancy_id_vacancy_version_fkey"
            columns: ["vacancy_id", "vacancy_version"]
            isOneToOne: false
            referencedRelation: "job_vacancy_versions"
            referencedColumns: ["vacancy_id", "version"]
          },
        ]
      }
      job_documents: {
        Row: {
          application_id: string
          document_id: string
          id: string
        }
        Insert: {
          application_id: string
          document_id: string
          id?: string
        }
        Update: {
          application_id?: string
          document_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      job_events: {
        Row: {
          application_id: string
          copy: string
          created_at: string
          event_type: string
          id: string
          visible_to_applicant: boolean
        }
        Insert: {
          application_id: string
          copy: string
          created_at?: string
          event_type: string
          id?: string
          visible_to_applicant?: boolean
        }
        Update: {
          application_id?: string
          copy?: string
          created_at?: string
          event_type?: string
          id?: string
          visible_to_applicant?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "job_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_interviews: {
        Row: {
          application_id: string
          created_at: string
          id: string
          notes: string | null
          outcome: string | null
          scheduled_at: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          notes?: string | null
          outcome?: string | null
          scheduled_at: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          outcome?: string | null
          scheduled_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_review_assignments: {
        Row: {
          application_id: string
          created_at: string
          id: string
          reviewer_account_id: string
          status: string
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          reviewer_account_id: string
          status?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          reviewer_account_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_review_assignments_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_review_assignments_reviewer_account_id_fkey"
            columns: ["reviewer_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          job_name: string
          outcome: Json | null
          started_at: string
          status: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name: string
          outcome?: Json | null
          started_at?: string
          status: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          job_name?: string
          outcome?: Json | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      job_scorecards: {
        Row: {
          application_id: string
          created_at: string
          id: string
          notes: string | null
          reviewer_account_id: string
          score: number
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          notes?: string | null
          reviewer_account_id: string
          score: number
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          reviewer_account_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_scorecards_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_scorecards_reviewer_account_id_fkey"
            columns: ["reviewer_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      job_vacancies: {
        Row: {
          created_at: string
          current_status: string
          department: string | null
          id: string
          reference: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          current_status?: string
          department?: string | null
          id?: string
          reference?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          current_status?: string
          department?: string | null
          id?: string
          reference?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      job_vacancy_versions: {
        Row: {
          created_at: string
          id: string
          published_by_account_id: string | null
          terms: Json
          vacancy_id: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          published_by_account_id?: string | null
          terms: Json
          vacancy_id: string
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          published_by_account_id?: string | null
          terms?: Json
          vacancy_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_vacancy_versions_published_by_account_id_fkey"
            columns: ["published_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_vacancy_versions_vacancy_id_fkey"
            columns: ["vacancy_id"]
            isOneToOne: false
            referencedRelation: "job_vacancies"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount_paise: number
          created_at: string
          created_by_account_id: string | null
          currency: string
          entry_type: string
          id: string
          invoice_id: string
          reason: string | null
          reference: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          created_by_account_id?: string | null
          currency?: string
          entry_type: string
          id?: string
          invoice_id: string
          reason?: string | null
          reference?: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          created_by_account_id?: string | null
          currency?: string
          entry_type?: string
          id?: string
          invoice_id?: string
          reason?: string | null
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      mark_entries: {
        Row: {
          absent: boolean
          batch_id: string
          component_id: string
          created_at: string
          id: string
          obtained: number | null
          remark: string | null
          roster_id: string
          updated_at: string
        }
        Insert: {
          absent?: boolean
          batch_id: string
          component_id: string
          created_at?: string
          id?: string
          obtained?: number | null
          remark?: string | null
          roster_id: string
          updated_at?: string
        }
        Update: {
          absent?: boolean
          batch_id?: string
          component_id?: string
          created_at?: string
          id?: string
          obtained?: number | null
          remark?: string | null
          roster_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mark_entries_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "result_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_entries_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "assessment_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_entries_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "result_rosters"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_audiences: {
        Row: {
          academic_year_id: string | null
          audience: string
          grade_section_id: string | null
          id: string
          notice_id: string
          role_code: string | null
          student_id: string | null
        }
        Insert: {
          academic_year_id?: string | null
          audience: string
          grade_section_id?: string | null
          id?: string
          notice_id: string
          role_code?: string | null
          student_id?: string | null
        }
        Update: {
          academic_year_id?: string | null
          audience?: string
          grade_section_id?: string | null
          id?: string
          notice_id?: string
          role_code?: string | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notice_audiences_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_audiences_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_audiences_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_audiences_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "role_definitions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "notice_audiences_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          category: string
          content_item_id: string
          created_at: string
          expires_at: string | null
          id: string
          published_at: string | null
          reference: string
          review_due: string | null
          status: string
          updated_at: string
          urgent: boolean
        }
        Insert: {
          category?: string
          content_item_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          published_at?: string | null
          reference?: string
          review_due?: string | null
          status?: string
          updated_at?: string
          urgent?: boolean
        }
        Update: {
          category?: string
          content_item_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          published_at?: string | null
          reference?: string
          review_due?: string | null
          status?: string
          updated_at?: string
          urgent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notices_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: true
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          event_id: string
          id: string
          last_error: string | null
          next_attempt_at: string | null
          provider_message_id: string | null
          recipient_account_id: string
          status: string
          template_version: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          event_id: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          provider_message_id?: string | null
          recipient_account_id: string
          status?: string
          template_version: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          event_id?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          provider_message_id?: string | null
          recipient_account_id?: string
          status?: string
          template_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "outbox_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_recipient_account_id_fkey"
            columns: ["recipient_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_events: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_key: string
          id: string
          kind: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          payload: Json
          status: string
          target_reference: string
          target_type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_key: string
          id?: string
          kind: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          status?: string
          target_reference: string
          target_type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_key?: string
          id?: string
          kind?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          payload?: Json
          status?: string
          target_reference?: string
          target_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_allocations: {
        Row: {
          amount_paise: number
          created_at: string
          id: string
          invoice_id: string
          payment_id: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          id?: string
          invoice_id: string
          payment_id: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          id?: string
          invoice_id?: string
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          amount_paise: number
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          invoice_id: string
          method: string
          provider_order_ref: string | null
          reference: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          invoice_id: string
          method: string
          provider_order_ref?: string | null
          reference?: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          invoice_id?: string
          method?: string
          provider_order_ref?: string | null
          reference?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_paise: number
          attempt_id: string
          created_at: string
          currency: string
          id: string
          paid_at: string
          provider_txn_id: string
          reference: string
        }
        Insert: {
          amount_paise: number
          attempt_id: string
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string
          provider_txn_id: string
          reference?: string
        }
        Update: {
          amount_paise?: number
          attempt_id?: string
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string
          provider_txn_id?: string
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: true
            referencedRelation: "payment_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          created_at: string
          display_name: string
          family_name: string
          given_name: string
          id: string
          merged_into_person_id: string | null
          reference: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          family_name: string
          given_name: string
          id?: string
          merged_into_person_id?: string | null
          reference?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          family_name?: string
          given_name?: string
          id?: string
          merged_into_person_id?: string | null
          reference?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_merged_into_person_id_fkey"
            columns: ["merged_into_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      period_definitions: {
        Row: {
          academic_year_id: string
          created_at: string
          day_of_week: number
          ends_at: string
          id: string
          period_number: number
          starts_at: string
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          day_of_week: number
          ends_at: string
          id?: string
          period_number: number
          starts_at: string
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          day_of_week?: number
          ends_at?: string
          id?: string
          period_number?: number
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "period_definitions_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          action: string
          count: number
          id: string
          subject_hash: string
          window_start: string
        }
        Insert: {
          action: string
          count?: number
          id?: string
          subject_hash: string
          window_start: string
        }
        Update: {
          action?: string
          count?: number
          id?: string
          subject_hash?: string
          window_start?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          issued_at: string
          payment_id: string
          reference: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          issued_at?: string
          payment_id: string
          reference: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          issued_at?: string
          payment_id?: string
          reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_exceptions: {
        Row: {
          created_at: string
          detail: Json | null
          id: string
          kind: string
          run_id: string
          status: string
        }
        Insert: {
          created_at?: string
          detail?: Json | null
          id?: string
          kind: string
          run_id: string
          status?: string
        }
        Update: {
          created_at?: string
          detail?: Json | null
          id?: string
          kind?: string
          run_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_exceptions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          created_by_account_id: string | null
          id: string
          reference: string
          run_at: string
          status: string
          summary: Json | null
        }
        Insert: {
          created_by_account_id?: string | null
          id?: string
          reference?: string
          run_at?: string
          status?: string
          summary?: Json | null
        }
        Update: {
          created_by_account_id?: string | null
          id?: string
          reference?: string
          run_at?: string
          status?: string
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_runs_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_requests: {
        Row: {
          amount_paise: number
          approver_account_id: string | null
          created_at: string
          decided_at: string | null
          id: string
          payment_id: string
          reason: string
          reference: string
          requested_by_account_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          amount_paise: number
          approver_account_id?: string | null
          created_at?: string
          decided_at?: string | null
          id?: string
          payment_id: string
          reason: string
          reference?: string
          requested_by_account_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          amount_paise?: number
          approver_account_id?: string | null
          created_at?: string
          decided_at?: string | null
          id?: string
          payment_id?: string
          reason?: string
          reference?: string
          requested_by_account_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_approver_account_id_fkey"
            columns: ["approver_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_requested_by_account_id_fkey"
            columns: ["requested_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount_paise: number
          created_at: string
          id: string
          provider_ref: string | null
          reference: string
          refund_request_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          id?: string
          provider_ref?: string | null
          reference?: string
          refund_request_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          id?: string
          provider_ref?: string | null
          reference?: string
          refund_request_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_refund_request_id_fkey"
            columns: ["refund_request_id"]
            isOneToOne: true
            referencedRelation: "refund_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      resend_webhook_events: {
        Row: {
          created_at: string
          event_time: string
          event_type: string
          id: string
          normalized: Json | null
          payload_hash: string
          svix_id: string
        }
        Insert: {
          created_at?: string
          event_time: string
          event_type: string
          id?: string
          normalized?: Json | null
          payload_hash: string
          svix_id: string
        }
        Update: {
          created_at?: string
          event_time?: string
          event_type?: string
          id?: string
          normalized?: Json | null
          payload_hash?: string
          svix_id?: string
        }
        Relationships: []
      }
      result_batch_versions: {
        Row: {
          batch_id: string
          created_at: string
          created_by_account_id: string
          id: string
          note: string | null
          status: string
          version: number
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_by_account_id: string
          id?: string
          note?: string | null
          status: string
          version: number
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_by_account_id?: string
          id?: string
          note?: string | null
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "result_batch_versions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "result_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_batch_versions_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      result_batches: {
        Row: {
          created_at: string
          exam_definition_id: string
          grade_section_id: string
          id: string
          reference: string
          status: string
          subject_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          exam_definition_id: string
          grade_section_id: string
          id?: string
          reference?: string
          status?: string
          subject_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          exam_definition_id?: string
          grade_section_id?: string
          id?: string
          reference?: string
          status?: string
          subject_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "result_batches_exam_definition_id_fkey"
            columns: ["exam_definition_id"]
            isOneToOne: false
            referencedRelation: "exam_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_batches_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_batches_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      result_correction_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by_account_id: string | null
          id: string
          publication_id: string
          reason: string
          requested_by_account_id: string
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by_account_id?: string | null
          id?: string
          publication_id: string
          reason: string
          requested_by_account_id: string
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by_account_id?: string | null
          id?: string
          publication_id?: string
          reason?: string
          requested_by_account_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_correction_requests_decided_by_account_id_fkey"
            columns: ["decided_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_correction_requests_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "result_publications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_correction_requests_requested_by_account_id_fkey"
            columns: ["requested_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      result_documents: {
        Row: {
          document_id: string
          id: string
          publication_id: string
        }
        Insert: {
          document_id: string
          id?: string
          publication_id: string
        }
        Update: {
          document_id?: string
          id?: string
          publication_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_documents_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "result_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      result_events: {
        Row: {
          batch_id: string
          copy: string
          created_at: string
          event_type: string
          id: string
          visible_to_family: boolean
        }
        Insert: {
          batch_id: string
          copy: string
          created_at?: string
          event_type: string
          id?: string
          visible_to_family?: boolean
        }
        Update: {
          batch_id?: string
          copy?: string
          created_at?: string
          event_type?: string
          id?: string
          visible_to_family?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "result_events_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "result_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      result_publication_items: {
        Row: {
          created_at: string
          id: string
          publication_id: string
          snapshot: Json
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          publication_id: string
          snapshot: Json
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          publication_id?: string
          snapshot?: Json
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_publication_items_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "result_publications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_publication_items_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      result_publications: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          published_at: string
          published_by_account_id: string
          reference: string
          status: string
          version: number
          withdrawal_reason: string | null
          withdrawn_at: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          published_at?: string
          published_by_account_id: string
          reference?: string
          status?: string
          version: number
          withdrawal_reason?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          published_at?: string
          published_by_account_id?: string
          reference?: string
          status?: string
          version?: number
          withdrawal_reason?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "result_publications_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "result_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_publications_published_by_account_id_fkey"
            columns: ["published_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      result_rosters: {
        Row: {
          batch_id: string
          enrollment_id: string
          frozen_at: string
          id: string
          student_id: string
        }
        Insert: {
          batch_id: string
          enrollment_id: string
          frozen_at?: string
          id?: string
          student_id: string
        }
        Update: {
          batch_id?: string
          enrollment_id?: string
          frozen_at?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_rosters_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "result_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_rosters_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_rosters_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      role_definitions: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          label: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          label?: string
        }
        Relationships: []
      }
      role_grant_academic_years: {
        Row: {
          academic_year_id: string
          role_grant_id: string
        }
        Insert: {
          academic_year_id: string
          role_grant_id: string
        }
        Update: {
          academic_year_id?: string
          role_grant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_grant_academic_years_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_grant_academic_years_role_grant_id_fkey"
            columns: ["role_grant_id"]
            isOneToOne: false
            referencedRelation: "role_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_grant_grade_sections: {
        Row: {
          grade_section_id: string
          role_grant_id: string
        }
        Insert: {
          grade_section_id: string
          role_grant_id: string
        }
        Update: {
          grade_section_id?: string
          role_grant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_grant_grade_sections_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_grant_grade_sections_role_grant_id_fkey"
            columns: ["role_grant_id"]
            isOneToOne: false
            referencedRelation: "role_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_grant_subjects: {
        Row: {
          role_grant_id: string
          subject_id: string
        }
        Insert: {
          role_grant_id: string
          subject_id: string
        }
        Update: {
          role_grant_id?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_grant_subjects_role_grant_id_fkey"
            columns: ["role_grant_id"]
            isOneToOne: false
            referencedRelation: "role_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_grant_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      role_grants: {
        Row: {
          account_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          granted_by_account_id: string | null
          id: string
          reason: string | null
          reference: string
          role_code: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          account_id: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          granted_by_account_id?: string | null
          id?: string
          reason?: string | null
          reference?: string
          role_code: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          granted_by_account_id?: string | null
          id?: string
          reason?: string | null
          reference?: string
          role_code?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "role_grants_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_grants_granted_by_account_id_fkey"
            columns: ["granted_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_grants_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "role_definitions"
            referencedColumns: ["code"]
          },
        ]
      }
      rooms: {
        Row: {
          code: string
          created_at: string
          id: string
          kind: string
          label: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          kind?: string
          label: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string
        }
        Relationships: []
      }
      school_profile_versions: {
        Row: {
          address_city: string | null
          address_line1: string | null
          address_state: string | null
          affiliation: string | null
          approved_at: string | null
          approved_by_account_id: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          languages: string[] | null
          postal_code: string | null
          school_code: string | null
          school_name: string | null
          status: string
          version: number
        }
        Insert: {
          address_city?: string | null
          address_line1?: string | null
          address_state?: string | null
          affiliation?: string | null
          approved_at?: string | null
          approved_by_account_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          languages?: string[] | null
          postal_code?: string | null
          school_code?: string | null
          school_name?: string | null
          status?: string
          version: number
        }
        Update: {
          address_city?: string | null
          address_line1?: string | null
          address_state?: string | null
          affiliation?: string | null
          approved_at?: string | null
          approved_by_account_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          languages?: string[] | null
          postal_code?: string | null
          school_code?: string | null
          school_name?: string | null
          status?: string
          version?: number
        }
        Relationships: []
      }
      settings_versions: {
        Row: {
          change_reason: string | null
          changed_by_account_id: string | null
          created_at: string
          effective_from: string | null
          id: string
          policy: Json
          reference: string
          status: string
          version: number
        }
        Insert: {
          change_reason?: string | null
          changed_by_account_id?: string | null
          created_at?: string
          effective_from?: string | null
          id?: string
          policy?: Json
          reference?: string
          status?: string
          version: number
        }
        Update: {
          change_reason?: string | null
          changed_by_account_id?: string | null
          created_at?: string
          effective_from?: string | null
          id?: string
          policy?: Json
          reference?: string
          status?: string
          version?: number
        }
        Relationships: []
      }
      staff_assignments: {
        Row: {
          academic_year_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          grade_section_id: string | null
          id: string
          reference: string
          role_grant_id: string
          staff_member_id: string
          status: string
          subject_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          grade_section_id?: string | null
          id?: string
          reference?: string
          role_grant_id: string
          staff_member_id: string
          status?: string
          subject_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          grade_section_id?: string | null
          id?: string
          reference?: string
          role_grant_id?: string
          staff_member_id?: string
          status?: string
          subject_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_assignments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_assignments_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_assignments_role_grant_id_fkey"
            columns: ["role_grant_id"]
            isOneToOne: false
            referencedRelation: "role_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_assignments_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_members: {
        Row: {
          created_at: string
          employment_status: string
          id: string
          person_id: string
          reference: string
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          employment_status?: string
          id?: string
          person_id: string
          reference?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          employment_status?: string
          id?: string
          person_id?: string
          reference?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      student_documents: {
        Row: {
          document_id: string
          id: string
          student_id: string
        }
        Insert: {
          document_id: string
          id?: string
          student_id: string
        }
        Update: {
          document_id?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_documents_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      student_support_records: {
        Row: {
          category: string
          created_at: string
          id: string
          note: string
          student_id: string
          updated_at: string
          version: number
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          note: string
          student_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          note?: string
          student_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_support_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          created_at: string
          id: string
          person_id: string
          reference: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          person_id: string
          reference?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          person_id?: string
          reference?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      support_documents: {
        Row: {
          document_id: string
          id: string
          support_request_id: string
        }
        Insert: {
          document_id: string
          id?: string
          support_request_id: string
        }
        Update: {
          document_id?: string
          id?: string
          support_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_documents_support_request_id_fkey"
            columns: ["support_request_id"]
            isOneToOne: false
            referencedRelation: "support_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      support_events: {
        Row: {
          actor_account_id: string | null
          created_at: string
          detail: string | null
          event_type: string
          id: string
          support_request_id: string
        }
        Insert: {
          actor_account_id?: string | null
          created_at?: string
          detail?: string | null
          event_type: string
          id?: string
          support_request_id: string
        }
        Update: {
          actor_account_id?: string | null
          created_at?: string
          detail?: string | null
          event_type?: string
          id?: string
          support_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_events_actor_account_id_fkey"
            columns: ["actor_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_events_support_request_id_fkey"
            columns: ["support_request_id"]
            isOneToOne: false
            referencedRelation: "support_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          author_account_id: string
          body: string
          created_at: string
          id: string
          is_staff: boolean
          support_request_id: string
        }
        Insert: {
          author_account_id: string
          body: string
          created_at?: string
          id?: string
          is_staff?: boolean
          support_request_id: string
        }
        Update: {
          author_account_id?: string
          body?: string
          created_at?: string
          id?: string
          is_staff?: boolean
          support_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_author_account_id_fkey"
            columns: ["author_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_support_request_id_fkey"
            columns: ["support_request_id"]
            isOneToOne: false
            referencedRelation: "support_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      support_private_notes: {
        Row: {
          author_account_id: string
          body: string
          created_at: string
          id: string
          support_request_id: string
        }
        Insert: {
          author_account_id: string
          body: string
          created_at?: string
          id?: string
          support_request_id: string
        }
        Update: {
          author_account_id?: string
          body?: string
          created_at?: string
          id?: string
          support_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_private_notes_author_account_id_fkey"
            columns: ["author_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_private_notes_support_request_id_fkey"
            columns: ["support_request_id"]
            isOneToOne: false
            referencedRelation: "support_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      support_requests: {
        Row: {
          assignee_account_id: string | null
          category: string
          created_at: string
          id: string
          priority: string
          reference: string
          requester_account_id: string
          resolved_at: string | null
          sla_due_at: string | null
          status: string
          subject: string
          updated_at: string
          version: number
        }
        Insert: {
          assignee_account_id?: string | null
          category: string
          created_at?: string
          id?: string
          priority?: string
          reference?: string
          requester_account_id: string
          resolved_at?: string | null
          sla_due_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          version?: number
        }
        Update: {
          assignee_account_id?: string | null
          category?: string
          created_at?: string
          id?: string
          priority?: string
          reference?: string
          requester_account_id?: string
          resolved_at?: string | null
          sla_due_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "support_requests_assignee_account_id_fkey"
            columns: ["assignee_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_requests_requester_account_id_fkey"
            columns: ["requester_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_overrides: {
        Row: {
          created_at: string
          day_of_week: number
          grade_section_id: string
          id: string
          kind: string
          note: string | null
          override_date: string
          period_number: number
          reference: string
          room_id: string | null
          subject_id: string | null
          substitute_teacher_assignment_id: string | null
        }
        Insert: {
          created_at?: string
          day_of_week: number
          grade_section_id: string
          id?: string
          kind: string
          note?: string | null
          override_date: string
          period_number: number
          reference?: string
          room_id?: string | null
          subject_id?: string | null
          substitute_teacher_assignment_id?: string | null
        }
        Update: {
          created_at?: string
          day_of_week?: number
          grade_section_id?: string
          id?: string
          kind?: string
          note?: string | null
          override_date?: string
          period_number?: number
          reference?: string
          room_id?: string | null
          subject_id?: string | null
          substitute_teacher_assignment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timetable_overrides_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_overrides_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_overrides_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_overrides_substitute_teacher_assignment_id_fkey"
            columns: ["substitute_teacher_assignment_id"]
            isOneToOne: false
            referencedRelation: "staff_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_periods: {
        Row: {
          day_of_week: number
          ends_at: string
          id: string
          kind: string
          period_number: number
          room_id: string | null
          starts_at: string
          subject_id: string | null
          teacher_assignment_id: string | null
          timetable_version_id: string
        }
        Insert: {
          day_of_week: number
          ends_at: string
          id?: string
          kind?: string
          period_number: number
          room_id?: string | null
          starts_at: string
          subject_id?: string | null
          teacher_assignment_id?: string | null
          timetable_version_id: string
        }
        Update: {
          day_of_week?: number
          ends_at?: string
          id?: string
          kind?: string
          period_number?: number
          room_id?: string | null
          starts_at?: string
          subject_id?: string | null
          teacher_assignment_id?: string | null
          timetable_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_periods_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_periods_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_periods_teacher_assignment_id_fkey"
            columns: ["teacher_assignment_id"]
            isOneToOne: false
            referencedRelation: "staff_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_periods_timetable_version_id_fkey"
            columns: ["timetable_version_id"]
            isOneToOne: false
            referencedRelation: "timetable_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_publications: {
        Row: {
          id: string
          note: string | null
          published_at: string
          published_by_account_id: string
          reference: string
          timetable_version_id: string
        }
        Insert: {
          id?: string
          note?: string | null
          published_at?: string
          published_by_account_id: string
          reference?: string
          timetable_version_id: string
        }
        Update: {
          id?: string
          note?: string | null
          published_at?: string
          published_by_account_id?: string
          reference?: string
          timetable_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_publications_published_by_account_id_fkey"
            columns: ["published_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_publications_timetable_version_id_fkey"
            columns: ["timetable_version_id"]
            isOneToOne: true
            referencedRelation: "timetable_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_versions: {
        Row: {
          created_at: string
          effective_from: string | null
          effective_to: string | null
          grade_section_id: string
          id: string
          reference: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          grade_section_id: string
          id?: string
          reference?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          grade_section_id?: string
          id?: string
          reference?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "timetable_versions_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      user_accounts: {
        Row: {
          created_at: string
          id: string
          person_id: string
          status: string
          updated_at: string
          verified_contact: string | null
        }
        Insert: {
          created_at?: string
          id: string
          person_id: string
          status?: string
          updated_at?: string
          verified_contact?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          person_id?: string
          status?: string
          updated_at?: string
          verified_contact?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_accounts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_receipts: {
        Row: {
          event_id: string
          event_type: string
          id: string
          normalized: Json | null
          payload_hash: string
          processed_at: string | null
          provider: string
          received_at: string
          status: string
        }
        Insert: {
          event_id: string
          event_type: string
          id?: string
          normalized?: Json | null
          payload_hash: string
          processed_at?: string | null
          provider: string
          received_at?: string
          status?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          id?: string
          normalized?: Json | null
          payload_hash?: string
          processed_at?: string | null
          provider?: string
          received_at?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
