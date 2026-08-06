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
