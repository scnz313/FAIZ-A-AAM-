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
    PostgrestVersion: "14.5"
  }
  app: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      timetable_period_teachers: {
        Row: {
          academic_year_id: string | null
          day_of_week: number | null
          effective_subject_id: string | null
          grade_section_id: string | null
          kind: string | null
          period_number: number | null
          room_id: string | null
          source: string | null
          staff_member_id: string | null
          subject_id: string | null
          teacher_display_name: string | null
          teacher_title: string | null
          teaching_assignment_id: string | null
          timetable_period_id: string | null
          timetable_version_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      account_has_staff_grant: { Args: never; Returns: boolean }
      accounts_mark_mfa_verified: { Args: never; Returns: Json }
      accounts_reactivate: {
        Args: { p_account_id: string; p_reason: string }
        Returns: undefined
      }
      accounts_record_auth_event: { Args: { p_event: string }; Returns: Json }
      accounts_record_recovery_request: {
        Args: { p_account_id: string }
        Returns: Json
      }
      accounts_suspend: {
        Args: { p_account_id: string; p_reason: string }
        Returns: undefined
      }
      active_publication_ids: { Args: never; Returns: string[] }
      admission_configuration: { Args: never; Returns: Json }
      admission_eligibility_valid: {
        Args: {
          p_app: Database["public"]["Tables"]["admission_applications"]["Row"]
          p_snapshot: Json
          p_window: Database["public"]["Tables"]["admission_windows"]["Row"]
        }
        Returns: boolean
      }
      admission_public_configuration: {
        Args: { p_academic_year_id?: string }
        Returns: Json
      }
      admission_staff_scope: {
        Args: { p_application_id: string; p_roles: string[] }
        Returns: boolean
      }
      admissions_decide: {
        Args: {
          p_action: string
          p_application_id: string
          p_conditions?: Json
          p_expires_at?: string
          p_private_note?: string
          p_visible_reason?: string
        }
        Returns: undefined
      }
      admissions_decide_v2: {
        Args: {
          p_action: string
          p_application_id: string
          p_conditions?: Json
          p_expected_version?: number
          p_expires_at?: string
          p_private_note?: string
          p_visible_reason?: string
        }
        Returns: Json
      }
      admissions_duplicate_review_resolve: {
        Args: {
          p_application_id: string
          p_candidate_student_id: string
          p_evidence_reference: string
          p_evidence_type: string
          p_expected_version?: number
          p_outcome: string
          p_reason: string
        }
        Returns: Json
      }
      admissions_request_changes: {
        Args: {
          p_application_id: string
          p_private_note?: string
          p_visible_reason: string
        }
        Returns: undefined
      }
      admissions_respond_offer: {
        Args: {
          p_application_id: string
          p_offer_version?: number
          p_response: string
        }
        Returns: string
      }
      admissions_review_advance: {
        Args: {
          p_action: string
          p_application_id: string
          p_private_note?: string
          p_visible_reason?: string
        }
        Returns: undefined
      }
      admissions_save_draft: {
        Args: {
          p_academic_year_id?: string
          p_application_id?: string
          p_draft?: Json
          p_expected_version?: number
          p_grade_id?: string
          p_parent_contact?: string
          p_parent_name?: string
          p_schema_version?: number
          p_student_name?: string
        }
        Returns: Json
      }
      admissions_save_draft_v2: {
        Args: {
          p_academic_year_id?: string
          p_application_id?: string
          p_draft?: Json
          p_expected_draft_version?: number
          p_expected_version?: number
          p_grade_id?: string
          p_parent_contact?: string
          p_parent_name?: string
          p_schema_version?: number
          p_student_name?: string
        }
        Returns: Json
      }
      admissions_submit: {
        Args: {
          p_application_id: string
          p_expected_version?: number
          p_schema_version?: number
          p_snapshot: Json
        }
        Returns: string
      }
      admissions_withdraw: {
        Args: {
          p_application_id: string
          p_expected_version?: number
          p_idempotency_key?: string
        }
        Returns: Json
      }
      applicant_register: {
        Args: {
          p_auth_user_id: string
          p_contact: string
          p_family_name: string
          p_given_name: string
          p_purpose?: string
        }
        Returns: Json
      }
      assignments_create: {
        Args: {
          p_academic_year_id: string
          p_effective_from?: string
          p_grade_section_id?: string
          p_role_grant_id: string
          p_staff_member_id: string
          p_subject_id?: string
        }
        Returns: string
      }
      assignments_end: {
        Args: {
          p_assignment_id: string
          p_expected_version: number
          p_reason: string
        }
        Returns: undefined
      }
      audit_list: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["audit_events"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "audit_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      audit_list_page: {
        Args: {
          p_action?: string
          p_actor_account_id?: string
          p_cursor?: string
          p_limit?: number
          p_outcome?: string
          p_target_type?: string
        }
        Returns: Database["public"]["Tables"]["audit_events"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "audit_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      auth_claim_email: { Args: never; Returns: string }
      auth_claim_phone: { Args: never; Returns: string }
      auth_rate_limit_consume: {
        Args: {
          p_action: string
          p_limit: number
          p_subject_hash: string
          p_window_seconds: number
        }
        Returns: Json
      }
      bump_access_revalidation: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      claim_outbox: {
        Args: { p_batch_size?: number }
        Returns: Database["public"]["Tables"]["outbox_events"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "outbox_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_provider_jobs: {
        Args: { p_batch_size?: number }
        Returns: Database["public"]["Tables"]["provider_jobs"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "provider_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_provider_job: {
        Args: { p_job_id: string; p_outcome?: Json }
        Returns: Database["public"]["Tables"]["provider_jobs"]["Row"]
        SetofOptions: {
          from: "*"
          to: "provider_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      content_approve_version: {
        Args: {
          p_expected_version?: number
          p_idempotency_key?: string
          p_version_id: string
        }
        Returns: Json
      }
      content_expire_due: { Args: never; Returns: number }
      content_publish_due: { Args: never; Returns: number }
      content_publish_notice: {
        Args: { p_notice_id: string }
        Returns: undefined
      }
      content_publish_version: {
        Args: { p_version_id: string }
        Returns: undefined
      }
      content_publish_version_v2: {
        Args: {
          p_expected_version?: number
          p_expires_at?: string
          p_idempotency_key?: string
          p_scheduled_at?: string
          p_version_id: string
        }
        Returns: Json
      }
      content_request_review: {
        Args: {
          p_expected_version?: number
          p_idempotency_key?: string
          p_version_id: string
        }
        Returns: Json
      }
      content_review_version: {
        Args: { p_outcome: string; p_version_id: string }
        Returns: undefined
      }
      content_save_draft: {
        Args: {
          p_body: Json
          p_content_item_id: string
          p_expected_version?: number
          p_kind: string
          p_slug: string
          p_title: string
        }
        Returns: Json
      }
      content_save_draft_v2: {
        Args: {
          p_body: Json
          p_content_item_id: string
          p_expected_version?: number
          p_idempotency_key?: string
          p_kind: string
          p_slug: string
          p_title: string
        }
        Returns: Json
      }
      content_unpublish: {
        Args: { p_content_item_id: string; p_reason: string }
        Returns: undefined
      }
      content_unpublish_v2: {
        Args: {
          p_content_item_id: string
          p_expected_version?: number
          p_reason: string
        }
        Returns: Json
      }
      content_validate_body: { Args: { p_body: Json }; Returns: Json }
      context_family_select: {
        Args: { p_expected_version?: number; p_student_id: string }
        Returns: Json
      }
      context_staff_select: {
        Args: { p_expected_version?: number; p_role_grant_id: string }
        Returns: Json
      }
      data_export_allowed_columns: {
        Args: { p_domain: string }
        Returns: string[]
      }
      data_export_allowed_filters: {
        Args: { p_domain: string }
        Returns: string[]
      }
      data_export_cancel: {
        Args: { p_reason: string; p_request_reference: string }
        Returns: Json
      }
      data_export_claim_generation: {
        Args: { p_request_reference: string }
        Returns: Json
      }
      data_export_create_signed_download: {
        Args: { p_account_id?: string; p_request_reference: string }
        Returns: Json
      }
      data_export_list: { Args: never; Returns: Json[] }
      data_export_list_paginated: {
        Args: { p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      data_export_mark_failed: {
        Args: { p_error: string; p_request_reference: string }
        Returns: Json
      }
      data_export_mark_ready: {
        Args: {
          p_document_id: string
          p_request_reference: string
          p_row_count: number
        }
        Returns: Json
      }
      data_export_request:
        | {
            Args: {
              p_columns: Json
              p_domain: string
              p_filters: Json
              p_format: string
              p_purpose: string
              p_reason: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_columns: Json
              p_domain: string
              p_filters: Json
              p_format: string
              p_idempotency_key?: string
              p_purpose: string
              p_reason: string
            }
            Returns: Json
          }
      data_export_set_artifact_key: {
        Args: { p_request_reference: string }
        Returns: Json
      }
      data_health_check: { Args: never; Returns: Json }
      data_health_snapshot: { Args: never; Returns: Json }
      data_import_cancel: {
        Args: {
          p_batch_id: string
          p_expected_version: number
          p_reason: string
        }
        Returns: Json
      }
      data_import_commit: {
        Args: {
          p_batch_id: string
          p_confirmed_create_count: number
          p_confirmed_update_count: number
          p_expected_version: number
          p_idempotency_key: string
          p_reason: string
        }
        Returns: Json
      }
      data_import_create_batch: {
        Args: {
          p_academic_year_id: string
          p_authority_confirmation: boolean
          p_privacy_confirmation: boolean
          p_source_document_id: string
          p_source_system: string
        }
        Returns: Json
      }
      data_import_flag_shared_contacts: { Args: never; Returns: number }
      data_import_list_batches: { Args: never; Returns: Json[] }
      data_import_list_issues: {
        Args: { p_batch_id: string; p_severity?: string }
        Returns: Json[]
      }
      data_import_preview: { Args: { p_batch_id: string }; Returns: Json }
      data_import_record_issue: {
        Args: {
          p_batch_id: string
          p_code: string
          p_field: string
          p_message: string
          p_resolution_hint?: string
          p_row_id: string
          p_row_number: number
          p_severity: string
        }
        Returns: string
      }
      data_import_record_mapping: {
        Args: {
          p_batch_id: string
          p_column_mappings?: Json
          p_mapping_template_id?: string
        }
        Returns: Json
      }
      data_import_record_scan: {
        Args: {
          p_batch_id: string
          p_column_count: number
          p_encoding: string
          p_error?: string
          p_headers: Json
          p_row_count: number
        }
        Returns: Json
      }
      data_import_report: { Args: { p_batch_id: string }; Returns: Json }
      data_import_set_state: {
        Args: {
          p_batch_id: string
          p_expected_version: number
          p_new_state: string
        }
        Returns: Json
      }
      data_import_store_rows: {
        Args: { p_batch_id: string; p_rows: Json }
        Returns: number
      }
      data_import_valid_transition: {
        Args: { p_from: string; p_to: string }
        Returns: boolean
      }
      document_actor_allowed: {
        Args: { p_owner_domain: string; p_owner_record_id: string }
        Returns: boolean
      }
      document_staff_allowed: {
        Args: { p_owner_domain: string; p_owner_record_id: string }
        Returns: boolean
      }
      documents_apply_scan: {
        Args: { p_detail?: string; p_document_id: string; p_status: string }
        Returns: Json
      }
      documents_create_upload_intent: {
        Args: {
          p_allowed_mime_types?: string[]
          p_attachment_code: string
          p_declared_mime_type: string
          p_declared_size: number
          p_max_bytes?: number
          p_object_key?: string
          p_owner_domain: string
          p_owner_record_id: string
          p_safe_filename: string
        }
        Returns: Json
      }
      documents_finalize_upload: {
        Args: {
          p_actual_mime_type: string
          p_actual_size: number
          p_checksum: string
          p_document_id: string
        }
        Returns: Json
      }
      documents_link_attachment: {
        Args: {
          p_attachment_code: string
          p_document_id: string
          p_owner_domain: string
          p_owner_record_id: string
        }
        Returns: Json
      }
      documents_mark_deleted: {
        Args: { p_detail?: string; p_document_id: string }
        Returns: Json
      }
      documents_projection_list: {
        Args: { p_owner_domain?: string; p_owner_record_id?: string }
        Returns: Json[]
      }
      documents_retention_candidates: {
        Args: { p_limit?: number }
        Returns: Database["public"]["Tables"]["documents"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_outbox: {
        Args: {
          p_event_key: string
          p_kind: string
          p_max_attempts?: number
          p_payload?: Json
          p_target_reference: string
          p_target_type: string
        }
        Returns: Database["public"]["Tables"]["outbox_events"]["Row"]
        SetofOptions: {
          from: "*"
          to: "outbox_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enqueue_pdf_generation: {
        Args: { p_document_type: string; p_source_reference: string }
        Returns: string
      }
      enqueue_provider_job: {
        Args: {
          p_correlation_id?: string
          p_document_id?: string
          p_idempotency_key?: string
          p_job_kind: string
          p_target_reference?: string
          p_target_type?: string
        }
        Returns: Database["public"]["Tables"]["provider_jobs"]["Row"]
        SetofOptions: {
          from: "*"
          to: "provider_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enrollment_convert: { Args: { p_application_id: string }; Returns: Json }
      enrollment_convert_create: {
        Args: { p_application_id: string }
        Returns: Json
      }
      enrollment_readiness: {
        Args: { p_application_id: string }
        Returns: Json
      }
      exam_schedule_publish: {
        Args: { p_note?: string; p_version_id: string }
        Returns: string
      }
      exam_schedule_save_draft: {
        Args: {
          p_entries: Json
          p_grade_section_id: string
          p_version_id?: string
        }
        Returns: Json
      }
      expire_identity_invitations: { Args: never; Returns: number }
      fail_outbox: {
        Args: { p_error: string; p_event_key: string }
        Returns: Database["public"]["Tables"]["outbox_events"]["Row"]
        SetofOptions: {
          from: "*"
          to: "outbox_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_provider_job: {
        Args: { p_error: string; p_job_id: string; p_permanent?: boolean }
        Returns: Database["public"]["Tables"]["provider_jobs"]["Row"]
        SetofOptions: {
          from: "*"
          to: "provider_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finance_actor_invoice_allowed: {
        Args: { p_invoice_id: string }
        Returns: boolean
      }
      finance_apply_concession: {
        Args: {
          p_amount_paise: number
          p_invoice_id: string
          p_reason: string
          p_type?: string
        }
        Returns: string
      }
      finance_approve_adjustment: {
        Args: {
          p_adjustment_id: string
          p_approve: boolean
          p_expected_version: number
          p_reason?: string
        }
        Returns: Json
      }
      finance_approve_refund: {
        Args: {
          p_approve: boolean
          p_expected_version: number
          p_reason?: string
          p_refund_request_id: string
        }
        Returns: Json
      }
      finance_create_attempt: {
        Args: {
          p_amount_paise: number
          p_invoice_ref: string
          p_method: string
        }
        Returns: {
          provider_order_ref: string
          reference: string
        }[]
      }
      finance_create_attempt_v2: {
        Args: {
          p_amount_paise: number
          p_idempotency_key: string
          p_invoice_ref: string
          p_method: string
          p_provider_code?: string
        }
        Returns: Json
      }
      finance_invoice_scope: {
        Args: { p_invoice_id: string }
        Returns: boolean
      }
      finance_issue_admission_invoice: {
        Args: { p_application_id: string; p_schedule_version_id?: string }
        Returns: string
      }
      finance_post_adjustment: {
        Args: {
          p_adjustment_id: string
          p_expected_version: number
          p_idempotency_key?: string
        }
        Returns: Json
      }
      finance_post_refund: {
        Args: {
          p_expected_version: number
          p_provider_ref?: string
          p_refund_request_id: string
        }
        Returns: Json
      }
      finance_post_sandbox_payment: {
        Args: {
          p_amount_paise: number
          p_attempt_reference: string
          p_invoice_ref: string
          p_method?: string
          p_provider_txn_id: string
        }
        Returns: string
      }
      finance_reconciliation_import: {
        Args: {
          p_evidence: Json
          p_expected_version?: number
          p_idempotency_key?: string
          p_run_id: string
        }
        Returns: Json
      }
      finance_reconciliation_resolve: {
        Args: {
          p_exception_id: string
          p_expected_version: number
          p_idempotency_key?: string
          p_resolution_reason: string
        }
        Returns: Json
      }
      finance_reconciliation_start: {
        Args: { p_idempotency_key?: string }
        Returns: Json
      }
      finance_refresh_attempt: {
        Args: { p_attempt_reference: string }
        Returns: string
      }
      finance_refresh_attempt_v2: {
        Args: { p_attempt_reference: string; p_expected_version?: number }
        Returns: Json
      }
      finance_request_adjustment: {
        Args: {
          p_amount_paise: number
          p_expected_invoice_version: number
          p_idempotency_key?: string
          p_invoice_id: string
          p_kind: string
          p_reason: string
        }
        Returns: Json
      }
      finance_request_refund: {
        Args: { p_amount_paise: number; p_payment_id: string; p_reason: string }
        Returns: string
      }
      finance_request_refund_v2: {
        Args: {
          p_amount_paise: number
          p_expected_version?: number
          p_idempotency_key?: string
          p_payment_id: string
          p_reason: string
        }
        Returns: Json
      }
      guardian_campaign_create: {
        Args: {
          p_academic_year_id: string
          p_delivery_channel: string
          p_label: string
        }
        Returns: Json
      }
      guardian_claim_accept:
        | {
            Args: {
              p_claim_reference: string
              p_family_name: string
              p_given_name: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_claim_reference: string
              p_family_name: string
              p_given_name: string
              p_one_time_secret?: string
            }
            Returns: Json
          }
      guardian_claim_accept_by_token: {
        Args: { p_family_name: string; p_given_name: string; p_token: string }
        Returns: Json
      }
      guardian_claim_create: {
        Args: {
          p_campaign_id?: string
          p_channel: string
          p_expires_at: string
          p_guardian_contact_id: string
          p_guardian_id: string
          p_reason?: string
        }
        Returns: Json
      }
      guardian_claim_list: { Args: never; Returns: Json[] }
      guardian_claim_mark_dispatched: {
        Args: {
          p_claim_reference: string
          p_provider_ref?: string
          p_provider_subject: string
        }
        Returns: Json
      }
      guardian_claim_revoke: {
        Args: { p_claim_reference: string; p_reason: string }
        Returns: Json
      }
      guardian_claim_verify_token: { Args: { p_token: string }; Returns: Json }
      guardian_contact_change_approve: {
        Args: { p_approval_note?: string; p_change_reference: string }
        Returns: Json
      }
      guardian_contact_change_request:
        | {
            Args: {
              p_channel: string
              p_guardian_id: string
              p_new_contact_value: string
              p_reason: string
            }
            Returns: Json
          }
        | { Args: { p_new_contact: string; p_reason: string }; Returns: Json }
      guardian_has_capability: {
        Args: { p_capability: string; p_student_id: string }
        Returns: boolean
      }
      guardian_links_request: {
        Args: { p_relationship_label: string; p_student_id: string }
        Returns: Json
      }
      guardian_notice_ids: { Args: never; Returns: string[] }
      guardian_publication_allowed: {
        Args: { p_publication_id: string }
        Returns: boolean
      }
      guardian_switch_active_child: {
        Args: { p_guardian_id: string; p_student_id: string }
        Returns: Json
      }
      has_any_role: { Args: { p_roles: string[] }; Returns: boolean }
      has_role: { Args: { p_role: string }; Returns: boolean }
      hash_invitation_secret: { Args: { p_secret: string }; Returns: string }
      health_readiness: { Args: never; Returns: Json }
      hr_application_scope: {
        Args: { p_application_id: string; p_roles: string[] }
        Returns: boolean
      }
      invites_create: {
        Args: { p_contact: string; p_expires_at: string; p_purpose?: string }
        Returns: string
      }
      invites_revoke: {
        Args: { p_invitation_reference: string }
        Returns: undefined
      }
      invoice_balance: { Args: { p_invoice_id: string }; Returns: number }
      is_guardian: { Args: never; Returns: boolean }
      is_pure_teacher: { Args: never; Returns: boolean }
      is_staff_aal2: { Args: never; Returns: boolean }
      jobs_assign_reviewer: {
        Args: { p_application_id: string; p_reviewer_account_id: string }
        Returns: string
      }
      jobs_create_draft: {
        Args: { p_applicant_name: string; p_vacancy_version_id: string }
        Returns: Json
      }
      jobs_decide: {
        Args: {
          p_action: string
          p_application_id: string
          p_private_note?: string
          p_reason?: string
          p_scheduled_at?: string
        }
        Returns: undefined
      }
      jobs_decide_v2: {
        Args: {
          p_action: string
          p_application_id: string
          p_expected_version?: number
          p_private_note?: string
          p_reason?: string
          p_scheduled_at?: string
        }
        Returns: Json
      }
      jobs_retention_status: {
        Args: { p_application_id: string }
        Returns: Json
      }
      jobs_save_draft: {
        Args: {
          p_application_id: string
          p_draft: Json
          p_expected_version?: number
          p_schema_version?: number
        }
        Returns: Json
      }
      jobs_save_draft_v2: {
        Args: {
          p_application_id: string
          p_draft: Json
          p_expected_draft_version?: number
          p_expected_version?: number
          p_schema_version?: number
        }
        Returns: Json
      }
      jobs_save_scorecard: {
        Args: { p_application_id: string; p_notes?: string; p_score: number }
        Returns: string
      }
      jobs_submit: {
        Args: {
          p_application_id: string
          p_expected_version?: number
          p_snapshot: Json
        }
        Returns: string
      }
      jobs_withdraw: {
        Args: { p_application_id: string; p_expected_version?: number }
        Returns: undefined
      }
      legacy_teacher_access_report: { Args: never; Returns: Json[] }
      legacy_teacher_access_retire: {
        Args: {
          p_account_id: string
          p_expected_grant_version: number
          p_reason: string
        }
        Returns: Json
      }
      links_approve: {
        Args: { p_expected_version: number; p_link_id: string }
        Returns: undefined
      }
      links_capabilities_set: {
        Args: {
          p_capabilities: string[]
          p_expected_version: number
          p_link_id: string
        }
        Returns: undefined
      }
      links_reject: {
        Args: {
          p_expected_version: number
          p_link_id: string
          p_reason: string
        }
        Returns: undefined
      }
      links_restrict: {
        Args: {
          p_expected_version: number
          p_link_id: string
          p_reason: string
        }
        Returns: undefined
      }
      links_revoke: {
        Args: {
          p_expected_version: number
          p_link_id: string
          p_reason: string
        }
        Returns: undefined
      }
      mark_outbox_delivered: {
        Args: { p_event_key: string }
        Returns: Database["public"]["Tables"]["outbox_events"]["Row"]
        SetofOptions: {
          from: "*"
          to: "outbox_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      new_ref: { Args: { prefix: string; ref_year?: number }; Returns: string }
      normalize_identity_contact: {
        Args: { p_contact: string }
        Returns: string
      }
      notifications_mark_all: {
        Args: { p_expected_version?: number }
        Returns: number
      }
      notifications_mark_read: {
        Args: { p_expected_version?: number; p_notification_id: string }
        Returns: Json
      }
      profile_role_codes: {
        Args: { p_profile_code: string }
        Returns: string[]
      }
      project_notification_event: {
        Args: { p_event_id: string }
        Returns: number
      }
      project_notification_event_provider: {
        Args: { p_event_id: string }
        Returns: number
      }
      project_notification_event_v2: {
        Args: { p_event_id: string }
        Returns: number
      }
      public_notice_ids: { Args: never; Returns: string[] }
      record_audit: {
        Args: {
          p_action: string
          p_actor_label?: string
          p_outcome?: string
          p_reason?: string
          p_target_reference: string
          p_target_type: string
        }
        Returns: string
      }
      result_batch_scope: {
        Args: { p_batch_id: string; p_roles: string[] }
        Returns: boolean
      }
      result_entry_sheet_scope: {
        Args: { p_roles: string[]; p_sheet_id: string }
        Returns: boolean
      }
      result_publication_scope: {
        Args: { p_publication_id: string; p_roles: string[] }
        Returns: boolean
      }
      result_report_release_scope: {
        Args: { p_release_id: string; p_roles?: string[] }
        Returns: boolean
      }
      results_approve_correction: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_request_id: string
        }
        Returns: Json
      }
      results_correction_approve_v2: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_request_id: string
        }
        Returns: Json
      }
      results_correction_decide: {
        Args: { p_note?: string; p_outcome: string; p_request_id: string }
        Returns: Json
      }
      results_correction_request: {
        Args: { p_publication_id: string; p_reason: string }
        Returns: string
      }
      results_correction_request_v2: {
        Args: {
          p_idempotency_key?: string
          p_publication_id: string
          p_reason: string
          p_release_id: string
        }
        Returns: Json
      }
      results_entry_sheet_create: {
        Args: {
          p_exam_definition_id: string
          p_grade_section_id: string
          p_idempotency_key?: string
          p_subject_id: string
        }
        Returns: Json
      }
      results_entry_sheet_get: { Args: { p_sheet_id: string }; Returns: Json }
      results_entry_sheet_list: { Args: never; Returns: Json[] }
      results_entry_sheet_moderate: {
        Args: {
          p_expected_version?: number
          p_idempotency_key?: string
          p_note?: string
          p_outcome: string
          p_sheet_id: string
        }
        Returns: Json
      }
      results_entry_sheet_publish: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_sheet_id: string
        }
        Returns: Json
      }
      results_entry_sheet_save_draft: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_marks: Json
          p_sheet_id: string
        }
        Returns: Json
      }
      results_entry_sheet_submit: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_sheet_id: string
        }
        Returns: Json
      }
      results_entry_sheet_versions_list: {
        Args: { p_sheet_id: string }
        Returns: Json[]
      }
      results_idempotency_begin: {
        Args: { p_operation: string; p_request_hash: string }
        Returns: Json
      }
      results_idempotency_finish: {
        Args: { p_operation: string; p_request_hash: string; p_result: Json }
        Returns: Json
      }
      results_moderate: {
        Args: {
          p_batch_id: string
          p_expected_version?: number
          p_note?: string
          p_outcome: string
        }
        Returns: undefined
      }
      results_publish_batch: {
        Args: { p_batch_id: string; p_expected_version: number }
        Returns: string
      }
      results_report_release_get: {
        Args: { p_release_id: string }
        Returns: Json
      }
      results_report_release_list: {
        Args: { p_student_id?: string }
        Returns: Json[]
      }
      results_report_release_publish: {
        Args: {
          p_academic_year_id: string
          p_enrollment_id: string
          p_expected_version?: number
          p_idempotency_key?: string
          p_publication_ids: Json
          p_student_id: string
          p_term: string
        }
        Returns: Json
      }
      results_request_correction: {
        Args: {
          p_idempotency_key?: string
          p_publication_id: string
          p_reason: string
          p_release_id: string
        }
        Returns: Json
      }
      results_save_draft: {
        Args: { p_batch_id: string; p_expected_version: number; p_marks: Json }
        Returns: Json
      }
      results_submit_marks: {
        Args: { p_batch_id: string; p_expected_version: number; p_marks: Json }
        Returns: undefined
      }
      results_submit_marks_legacy: {
        Args: { p_batch_id: string; p_expected_version: number; p_marks: Json }
        Returns: undefined
      }
      results_supersede_releases_for_sheet: {
        Args: {
          p_actor: string
          p_new_publication_id: string
          p_new_sheet_id: string
          p_source_sheet_id: string
        }
        Returns: number
      }
      results_withdraw: {
        Args: { p_publication_id: string; p_reason: string }
        Returns: undefined
      }
      roles_grant: {
        Args: {
          p_academic_year_ids?: string[]
          p_account_id: string
          p_grade_section_ids?: string[]
          p_reason: string
          p_role_code: string
          p_subject_ids?: string[]
        }
        Returns: string
      }
      roles_revoke: {
        Args: {
          p_expected_version: number
          p_grant_id: string
          p_reason: string
        }
        Returns: undefined
      }
      settings_approve: {
        Args: {
          p_effective_from: string
          p_expected_version: number
          p_settings_id: string
        }
        Returns: Json
      }
      settings_effective_due: { Args: never; Returns: number }
      settings_read_effective: { Args: never; Returns: Json }
      settings_read_latest: { Args: never; Returns: Json }
      settings_save: {
        Args: { p_expected_version: number; p_policy: Json; p_reason: string }
        Returns: Json
      }
      settings_save_v2: {
        Args: { p_expected_version: number; p_policy: Json; p_reason: string }
        Returns: Json
      }
      slice5_idempotency: {
        Args: {
          p_operation_key: string
          p_request_hash: string
          p_result?: Json
        }
        Returns: Json
      }
      staff_assignment_to_teaching_assignment: {
        Args: { p_staff_assignment_id: string }
        Returns: string
      }
      staff_grade_scope_allowed: {
        Args: {
          p_academic_year_id: string
          p_grade_id: string
          p_roles: string[]
        }
        Returns: boolean
      }
      staff_invites_accept:
        | {
            Args: {
              p_family_name: string
              p_given_name: string
              p_invitation_reference: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_family_name: string
              p_given_name: string
              p_invitation_reference: string
              p_one_time_ref: string
            }
            Returns: Json
          }
      staff_invites_attach_provider: {
        Args: {
          p_invitation_reference: string
          p_provider_invitation_ref?: string
          p_provider_subject: string
        }
        Returns: Json
      }
      staff_invites_create: {
        Args: {
          p_academic_year_ids?: string[]
          p_contact: string
          p_display_name: string
          p_expires_at: string
          p_grade_section_ids?: string[]
          p_reason: string
          p_role_code: string
          p_subject_ids?: string[]
        }
        Returns: string
      }
      staff_invites_create_profile: {
        Args: {
          p_contact: string
          p_display_name: string
          p_expires_at: string
          p_profile_code?: string
          p_reason?: string
          p_title?: string
        }
        Returns: Json
      }
      staff_invites_create_record: {
        Args: {
          p_academic_year_ids?: string[]
          p_contact: string
          p_display_name: string
          p_expires_at: string
          p_grade_section_ids?: string[]
          p_reason: string
          p_role_code: string
          p_subject_ids?: string[]
        }
        Returns: Json
      }
      staff_invites_mark_provider_failed: {
        Args: { p_invitation_reference: string; p_reason: string }
        Returns: undefined
      }
      staff_profile_adopt: {
        Args: { p_account_id: string; p_profile_code: string; p_reason: string }
        Returns: Json
      }
      staff_profile_change: {
        Args: {
          p_account_id: string
          p_expected_version: number
          p_profile_code: string
          p_reason: string
        }
        Returns: Json
      }
      staff_profiles_list: { Args: never; Returns: Json }
      staff_scope_allowed: {
        Args: {
          p_academic_year_id?: string
          p_grade_section_id?: string
          p_roles: string[]
          p_subject_id?: string
        }
        Returns: boolean
      }
      support_assign: {
        Args: {
          p_assignee_account_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: undefined
      }
      support_create: {
        Args: {
          p_body: string
          p_category: string
          p_priority?: string
          p_subject: string
        }
        Returns: Json
      }
      support_public_intake: {
        Args: {
          p_body: string
          p_category: string
          p_contact: string
          p_intake_key?: string
          p_requester_name?: string
          p_subject: string
        }
        Returns: Json
      }
      support_public_intake_v2: {
        Args: {
          p_body: string
          p_captcha_provider?: string
          p_captcha_verified_at?: string
          p_category: string
          p_contact: string
          p_intake_key_hash?: string
          p_requester_name?: string
          p_subject: string
        }
        Returns: Json
      }
      support_reopen: {
        Args: { p_expected_version: number; p_request_id: string }
        Returns: undefined
      }
      support_respond: {
        Args: { p_body: string; p_private?: boolean; p_request_id: string }
        Returns: undefined
      }
      support_respond_v2: {
        Args: {
          p_body: string
          p_expected_version?: number
          p_idempotency_key?: string
          p_private?: boolean
          p_request_id: string
        }
        Returns: Json
      }
      support_set_status: {
        Args: {
          p_expected_version: number
          p_reason?: string
          p_request_id: string
          p_resolution_code?: string
          p_status: string
        }
        Returns: Json
      }
      teacher_assignment_allowed: {
        Args: {
          p_academic_year_id: string
          p_grade_section_id: string
          p_subject_id: string
        }
        Returns: boolean
      }
      teacher_section_allowed: {
        Args: { p_grade_section_id: string }
        Returns: boolean
      }
      teaching_assignment_create: {
        Args: {
          p_academic_year_id: string
          p_effective_from?: string
          p_grade_section_id: string
          p_reason?: string
          p_staff_member_id: string
          p_subject_id: string
        }
        Returns: Json
      }
      teaching_assignment_end: {
        Args: {
          p_assignment_id: string
          p_expected_version: number
          p_reason: string
        }
        Returns: Json
      }
      teaching_staff_create: {
        Args: { p_display_name: string; p_reason: string; p_title: string }
        Returns: Json
      }
      teaching_staff_list: { Args: never; Returns: Json[] }
      timetable_publish_version: {
        Args: { p_note?: string; p_version_id: string }
        Returns: string
      }
      timetable_revoke_override: {
        Args: {
          p_expected_version: number
          p_override_id: string
          p_reason: string
        }
        Returns: Json
      }
      timetable_save_draft: {
        Args: {
          p_expected_revision?: number
          p_grade_section_id: string
          p_periods: Json
          p_version_id: string
        }
        Returns: Json
      }
      timetable_save_override: {
        Args: {
          p_day_of_week: number
          p_grade_section_id: string
          p_kind: string
          p_note?: string
          p_override_date: string
          p_period_number: number
          p_room_id?: string
          p_subject_id?: string
          p_substitute_teacher_assignment_id?: string
        }
        Returns: string
      }
      timetable_validate_draft: {
        Args: { p_version_id: string }
        Returns: Json
      }
      users_admin_list: { Args: never; Returns: Json }
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
      account_context_preferences: {
        Row: {
          account_id: string
          active_role_grant_id: string | null
          active_student_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          account_id: string
          active_role_grant_id?: string | null
          active_student_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          account_id?: string
          active_role_grant_id?: string | null
          active_student_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_context_preferences_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_context_preferences_active_role_grant_id_fkey"
            columns: ["active_role_grant_id"]
            isOneToOne: false
            referencedRelation: "role_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_context_preferences_active_student_id_fkey"
            columns: ["active_student_id"]
            isOneToOne: false
            referencedRelation: "students"
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
          intended_academic_year_ids: string[]
          intended_display_name: string | null
          intended_grade_section_ids: string[]
          intended_mfa_required: boolean
          intended_reason: string | null
          intended_role_code: string | null
          intended_staff_profile_code: string | null
          intended_staff_profile_version: number | null
          intended_subject_ids: string[]
          intended_title: string | null
          invitation_hash: string
          provider_dispatched_at: string | null
          provider_invitation_ref: string | null
          provider_state: string
          provider_subject: string | null
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
          intended_academic_year_ids?: string[]
          intended_display_name?: string | null
          intended_grade_section_ids?: string[]
          intended_mfa_required?: boolean
          intended_reason?: string | null
          intended_role_code?: string | null
          intended_staff_profile_code?: string | null
          intended_staff_profile_version?: number | null
          intended_subject_ids?: string[]
          intended_title?: string | null
          invitation_hash: string
          provider_dispatched_at?: string | null
          provider_invitation_ref?: string | null
          provider_state?: string
          provider_subject?: string | null
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
          intended_academic_year_ids?: string[]
          intended_display_name?: string | null
          intended_grade_section_ids?: string[]
          intended_mfa_required?: boolean
          intended_reason?: string | null
          intended_role_code?: string | null
          intended_staff_profile_code?: string | null
          intended_staff_profile_version?: number | null
          intended_subject_ids?: string[]
          intended_title?: string | null
          invitation_hash?: string
          provider_dispatched_at?: string | null
          provider_invitation_ref?: string | null
          provider_state?: string
          provider_subject?: string | null
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
          {
            foreignKeyName: "account_invitations_intended_staff_profile_code_fkey"
            columns: ["intended_staff_profile_code"]
            isOneToOne: false
            referencedRelation: "staff_access_profiles"
            referencedColumns: ["code"]
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
      admission_document_requirements: {
        Row: {
          admission_window_id: string
          allowed_mime_types: string[]
          code: string
          created_at: string
          id: string
          label: string
          max_bytes: number
          reference: string
          required: boolean
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          admission_window_id: string
          allowed_mime_types?: string[]
          code: string
          created_at?: string
          id?: string
          label: string
          max_bytes?: number
          reference?: string
          required?: boolean
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          admission_window_id?: string
          allowed_mime_types?: string[]
          code?: string
          created_at?: string
          id?: string
          label?: string
          max_bytes?: number
          reference?: string
          required?: boolean
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "admission_document_requirements_admission_window_id_fkey"
            columns: ["admission_window_id"]
            isOneToOne: false
            referencedRelation: "admission_windows"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_documents: {
        Row: {
          application_id: string
          document_id: string
          id: string
          requirement_code: string | null
        }
        Insert: {
          application_id: string
          document_id: string
          id?: string
          requirement_code?: string | null
        }
        Update: {
          application_id?: string
          document_id?: string
          id?: string
          requirement_code?: string | null
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
          version: number
        }
        Insert: {
          application_id: string
          draft?: Json
          expires_at: string
          id?: string
          schema_version?: number
          updated_at?: string
          version?: number
        }
        Update: {
          application_id?: string
          draft?: Json
          expires_at?: string
          id?: string
          schema_version?: number
          updated_at?: string
          version?: number
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
      admission_duplicate_reviews: {
        Row: {
          application_id: string
          candidate_student_id: string
          created_at: string
          id: string
          reason: string
          reference: string
          reviewed_at: string | null
          reviewed_by_account_id: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          application_id: string
          candidate_student_id: string
          created_at?: string
          id?: string
          reason: string
          reference?: string
          reviewed_at?: string | null
          reviewed_by_account_id?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          application_id?: string
          candidate_student_id?: string
          created_at?: string
          id?: string
          reason?: string
          reference?: string
          reviewed_at?: string | null
          reviewed_by_account_id?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "admission_duplicate_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_duplicate_reviews_candidate_student_id_fkey"
            columns: ["candidate_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_duplicate_reviews_reviewed_by_account_id_fkey"
            columns: ["reviewed_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
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
      admission_idempotency_records: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          request_hash: string
          result: Json
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          request_hash: string
          result: Json
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          request_hash?: string
          result?: Json
        }
        Relationships: []
      }
      admission_identity_evidence: {
        Row: {
          application_id: string
          candidate_student_id: string
          created_at: string
          document_id: string | null
          evidence_reference: string | null
          evidence_type: string
          id: string
          reason: string | null
          reference: string
          status: string
          verified_at: string | null
          verified_by_account_id: string | null
        }
        Insert: {
          application_id: string
          candidate_student_id: string
          created_at?: string
          document_id?: string | null
          evidence_reference?: string | null
          evidence_type: string
          id?: string
          reason?: string | null
          reference?: string
          status?: string
          verified_at?: string | null
          verified_by_account_id?: string | null
        }
        Update: {
          application_id?: string
          candidate_student_id?: string
          created_at?: string
          document_id?: string | null
          evidence_reference?: string | null
          evidence_type?: string
          id?: string
          reason?: string | null
          reference?: string
          status?: string
          verified_at?: string | null
          verified_by_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admission_identity_evidence_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "admission_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_identity_evidence_candidate_student_id_fkey"
            columns: ["candidate_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_identity_evidence_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_identity_evidence_verified_by_account_id_fkey"
            columns: ["verified_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
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
          final_approved_at: string | null
          final_approved_by_account_id: string | null
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
          final_approved_at?: string | null
          final_approved_by_account_id?: string | null
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
          final_approved_at?: string | null
          final_approved_by_account_id?: string | null
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
            foreignKeyName: "admission_offers_final_approved_by_account_id_fkey"
            columns: ["final_approved_by_account_id"]
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
          eligibility_policy: Json
          grade_id: string
          id: string
          opens_at: string
          policy: Json
          reference: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          academic_year_id: string
          capacity?: number | null
          closes_at: string
          created_at?: string
          eligibility_policy?: Json
          grade_id: string
          id?: string
          opens_at: string
          policy?: Json
          reference?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          academic_year_id?: string
          capacity?: number | null
          closes_at?: string
          created_at?: string
          eligibility_policy?: Json
          grade_id?: string
          id?: string
          opens_at?: string
          policy?: Json
          reference?: string
          status?: string
          updated_at?: string
          version?: number
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
      applicant_identities: {
        Row: {
          account_id: string
          created_at: string
          id: string
          purpose: string
          reference: string
          status: string
          updated_at: string
          verified_contact: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          purpose: string
          reference?: string
          status?: string
          updated_at?: string
          verified_contact: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          purpose?: string
          reference?: string
          status?: string
          updated_at?: string
          verified_contact?: string
        }
        Relationships: [
          {
            foreignKeyName: "applicant_identities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
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
          approved_at: string | null
          approved_by_account_id: string
          created_at: string
          id: string
          invoice_id: string
          reason: string
          requested_by_account_id: string | null
          status: string
          type: string
          version: number
        }
        Insert: {
          amount_paise: number
          approved_at?: string | null
          approved_by_account_id: string
          created_at?: string
          id?: string
          invoice_id: string
          reason: string
          requested_by_account_id?: string | null
          status?: string
          type?: string
          version?: number
        }
        Update: {
          amount_paise?: number
          approved_at?: string | null
          approved_by_account_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          reason?: string
          requested_by_account_id?: string | null
          status?: string
          type?: string
          version?: number
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
          {
            foreignKeyName: "concessions_requested_by_account_id_fkey"
            columns: ["requested_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
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
          current_version_id: string | null
          id: string
          kind: string
          owner_account_id: string | null
          reference: string
          slug: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          current_status?: string
          current_version_id?: string | null
          id?: string
          kind?: string
          owner_account_id?: string | null
          reference?: string
          slug: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          current_status?: string
          current_version_id?: string | null
          id?: string
          kind?: string
          owner_account_id?: string | null
          reference?: string
          slug?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_items_owner_account_id_fkey"
            columns: ["owner_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_versions: {
        Row: {
          approved_at: string | null
          author_account_id: string
          body: Json
          content_item_id: string
          created_at: string
          id: string
          idempotency_key: string | null
          published_at: string | null
          review_status: string
          reviewed_by_account_id: string | null
          title: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          author_account_id: string
          body?: Json
          content_item_id: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          published_at?: string | null
          review_status?: string
          reviewed_by_account_id?: string | null
          title: string
          version: number
        }
        Update: {
          approved_at?: string | null
          author_account_id?: string
          body?: Json
          content_item_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          published_at?: string | null
          review_status?: string
          reviewed_by_account_id?: string | null
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
          {
            foreignKeyName: "content_versions_reviewed_by_account_id_fkey"
            columns: ["reviewed_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      data_export_catalogs: {
        Row: {
          available_columns: Json
          created_at: string
          description: string
          display_name: string
          domain: string
          id: string
          is_active: boolean
          max_rows: number
          optional_filters: Json
          reference: string
          required_filters: Json
          updated_at: string
        }
        Insert: {
          available_columns: Json
          created_at?: string
          description?: string
          display_name: string
          domain: string
          id?: string
          is_active?: boolean
          max_rows?: number
          optional_filters?: Json
          reference?: string
          required_filters?: Json
          updated_at?: string
        }
        Update: {
          available_columns?: Json
          created_at?: string
          description?: string
          display_name?: string
          domain?: string
          id?: string
          is_active?: boolean
          max_rows?: number
          optional_filters?: Json
          reference?: string
          required_filters?: Json
          updated_at?: string
        }
        Relationships: []
      }
      data_export_events: {
        Row: {
          actor_account_id: string | null
          created_at: string
          detail: string | null
          event_type: string
          id: string
          request_id: string
        }
        Insert: {
          actor_account_id?: string | null
          created_at?: string
          detail?: string | null
          event_type: string
          id?: string
          request_id: string
        }
        Update: {
          actor_account_id?: string | null
          created_at?: string
          detail?: string | null
          event_type?: string
          id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_export_events_actor_account_id_fkey"
            columns: ["actor_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_export_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "data_export_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      data_export_requests: {
        Row: {
          artifact_checksum: string | null
          artifact_key: string | null
          columns: Json
          completed_at: string | null
          created_at: string
          document_id: string | null
          domain: string
          expires_at: string | null
          filters: Json
          format: string
          generation_attempts: number
          generation_started_at: string | null
          id: string
          idempotency_key: string | null
          purpose: string
          reason: string
          reference: string
          requested_by_account_id: string
          row_count: number | null
          state: string
          updated_at: string
          version: number
        }
        Insert: {
          artifact_checksum?: string | null
          artifact_key?: string | null
          columns?: Json
          completed_at?: string | null
          created_at?: string
          document_id?: string | null
          domain: string
          expires_at?: string | null
          filters?: Json
          format?: string
          generation_attempts?: number
          generation_started_at?: string | null
          id?: string
          idempotency_key?: string | null
          purpose: string
          reason: string
          reference?: string
          requested_by_account_id: string
          row_count?: number | null
          state?: string
          updated_at?: string
          version?: number
        }
        Update: {
          artifact_checksum?: string | null
          artifact_key?: string | null
          columns?: Json
          completed_at?: string | null
          created_at?: string
          document_id?: string | null
          domain?: string
          expires_at?: string | null
          filters?: Json
          format?: string
          generation_attempts?: number
          generation_started_at?: string | null
          id?: string
          idempotency_key?: string | null
          purpose?: string
          reason?: string
          reference?: string
          requested_by_account_id?: string
          row_count?: number | null
          state?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "data_export_requests_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_export_requests_requested_by_account_id_fkey"
            columns: ["requested_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      data_health_snapshots: {
        Row: {
          checks: Json
          created_by_account_id: string | null
          id: string
          overall_status: string
          reference: string
          snapshot_at: string
        }
        Insert: {
          checks: Json
          created_by_account_id?: string | null
          id?: string
          overall_status: string
          reference?: string
          snapshot_at?: string
        }
        Update: {
          checks?: Json
          created_by_account_id?: string | null
          id?: string
          overall_status?: string
          reference?: string
          snapshot_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_health_snapshots_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      data_import_batches: {
        Row: {
          academic_year_id: string
          authority_confirmation: boolean
          cancel_reason: string | null
          commit_result: Json | null
          committed_at: string | null
          created_at: string
          created_by_account_id: string
          error_count: number
          id: string
          idempotency_key: string | null
          preview_computed_at: string | null
          preview_digest: string | null
          privacy_confirmation: boolean
          reference: string
          row_count: number
          scan_column_count: number | null
          scan_detected_encoding: string | null
          scan_error: string | null
          scan_headers: Json | null
          scan_row_count: number | null
          source_document_id: string | null
          source_system: string
          state: string
          updated_at: string
          version: number
          warning_count: number
        }
        Insert: {
          academic_year_id: string
          authority_confirmation?: boolean
          cancel_reason?: string | null
          commit_result?: Json | null
          committed_at?: string | null
          created_at?: string
          created_by_account_id: string
          error_count?: number
          id?: string
          idempotency_key?: string | null
          preview_computed_at?: string | null
          preview_digest?: string | null
          privacy_confirmation?: boolean
          reference?: string
          row_count?: number
          scan_column_count?: number | null
          scan_detected_encoding?: string | null
          scan_error?: string | null
          scan_headers?: Json | null
          scan_row_count?: number | null
          source_document_id?: string | null
          source_system: string
          state?: string
          updated_at?: string
          version?: number
          warning_count?: number
        }
        Update: {
          academic_year_id?: string
          authority_confirmation?: boolean
          cancel_reason?: string | null
          commit_result?: Json | null
          committed_at?: string | null
          created_at?: string
          created_by_account_id?: string
          error_count?: number
          id?: string
          idempotency_key?: string | null
          preview_computed_at?: string | null
          preview_digest?: string | null
          privacy_confirmation?: boolean
          reference?: string
          row_count?: number
          scan_column_count?: number | null
          scan_detected_encoding?: string | null
          scan_error?: string | null
          scan_headers?: Json | null
          scan_row_count?: number | null
          source_document_id?: string | null
          source_system?: string
          state?: string
          updated_at?: string
          version?: number
          warning_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "data_import_batches_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_import_batches_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_import_batches_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      data_import_issues: {
        Row: {
          batch_id: string
          code: string
          created_at: string
          field: string | null
          id: string
          message: string
          resolution_hint: string | null
          resolved_at: string | null
          row_id: string | null
          row_number: number | null
          severity: string
        }
        Insert: {
          batch_id: string
          code: string
          created_at?: string
          field?: string | null
          id?: string
          message: string
          resolution_hint?: string | null
          resolved_at?: string | null
          row_id?: string | null
          row_number?: number | null
          severity: string
        }
        Update: {
          batch_id?: string
          code?: string
          created_at?: string
          field?: string | null
          id?: string
          message?: string
          resolution_hint?: string | null
          resolved_at?: string | null
          row_id?: string | null
          row_number?: number | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_import_issues_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "data_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_import_issues_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "data_import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      data_import_mapping_templates: {
        Row: {
          column_mappings: Json
          created_at: string
          created_by_account_id: string
          entity: string
          id: string
          is_active: boolean
          name: string
          reference: string
          updated_at: string
          version: number
        }
        Insert: {
          column_mappings: Json
          created_at?: string
          created_by_account_id: string
          entity: string
          id?: string
          is_active?: boolean
          name: string
          reference?: string
          updated_at?: string
          version?: number
        }
        Update: {
          column_mappings?: Json
          created_at?: string
          created_by_account_id?: string
          entity?: string
          id?: string
          is_active?: boolean
          name?: string
          reference?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "data_import_mapping_templates_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      data_import_mappings: {
        Row: {
          column_mappings: Json
          created_at: string
          created_by_account_id: string | null
          entity: string
          id: string
          reference: string
          source_system: string
          source_version: string
          version: number
        }
        Insert: {
          column_mappings?: Json
          created_at?: string
          created_by_account_id?: string | null
          entity: string
          id?: string
          reference?: string
          source_system: string
          source_version: string
          version?: number
        }
        Update: {
          column_mappings?: Json
          created_at?: string
          created_by_account_id?: string | null
          entity?: string
          id?: string
          reference?: string
          source_system?: string
          source_version?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "data_import_mappings_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      data_import_resolutions: {
        Row: {
          batch_id: string
          id: string
          issue_id: string
          note: string | null
          resolution: string
          resolved_at: string
          resolved_by_account_id: string
          resolved_value: Json | null
          row_id: string
        }
        Insert: {
          batch_id: string
          id?: string
          issue_id: string
          note?: string | null
          resolution: string
          resolved_at?: string
          resolved_by_account_id: string
          resolved_value?: Json | null
          row_id: string
        }
        Update: {
          batch_id?: string
          id?: string
          issue_id?: string
          note?: string | null
          resolution?: string
          resolved_at?: string
          resolved_by_account_id?: string
          resolved_value?: Json | null
          row_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_import_resolutions_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "data_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_import_resolutions_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "data_import_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_import_resolutions_resolved_by_account_id_fkey"
            columns: ["resolved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_import_resolutions_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "data_import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      data_import_rows: {
        Row: {
          batch_id: string
          committed_at: string | null
          committed_record_id: string | null
          created_at: string
          entity: string
          id: string
          normalized: Json
          outcome: string | null
          row_number: number
          source_key: string
          status: string
        }
        Insert: {
          batch_id: string
          committed_at?: string | null
          committed_record_id?: string | null
          created_at?: string
          entity: string
          id?: string
          normalized?: Json
          outcome?: string | null
          row_number: number
          source_key: string
          status?: string
        }
        Update: {
          batch_id?: string
          committed_at?: string | null
          committed_record_id?: string | null
          created_at?: string
          entity?: string
          id?: string
          normalized?: Json
          outcome?: string | null
          row_number?: number
          source_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "data_import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      document_generation_records: {
        Row: {
          attempts: number
          content_checksum: string | null
          created_at: string
          document_id: string | null
          document_type: string
          id: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          object_key: string
          ready_at: string | null
          reference: string
          source_checksum: string
          source_domain: string
          source_record_id: string
          source_reference: string
          status: string
          storage_bucket: string
          template_version: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          content_checksum?: string | null
          created_at?: string
          document_id?: string | null
          document_type: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          object_key: string
          ready_at?: string | null
          reference?: string
          source_checksum: string
          source_domain: string
          source_record_id: string
          source_reference: string
          status?: string
          storage_bucket?: string
          template_version: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          content_checksum?: string | null
          created_at?: string
          document_id?: string | null
          document_type?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          object_key?: string
          ready_at?: string | null
          reference?: string
          source_checksum?: string
          source_domain?: string
          source_record_id?: string
          source_reference?: string
          status?: string
          storage_bucket?: string
          template_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_generation_records_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_processing_events: {
        Row: {
          created_at: string
          detail: string | null
          document_id: string | null
          event_type: string
          id: string
          idempotency_key: string | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          document_id?: string | null
          event_type: string
          id?: string
          idempotency_key?: string | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          document_id?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string | null
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
          actual_mime_type: string | null
          actual_size_bytes: number | null
          allowed_mime_types: string[]
          attachment_code: string | null
          category: string
          checksum: string | null
          checksum_algorithm: string
          checksum_verified: boolean
          created_at: string
          declared_mime_type: string | null
          deleted_at: string | null
          finalized_at: string | null
          id: string
          legal_hold_until: string | null
          max_bytes: number
          mime_type: string
          object_key: string
          owner_domain: string
          owner_record_id: string
          reference: string
          retention_class: string
          retention_until: string | null
          safe_filename: string
          scan_status: string
          size_bytes: number
          storage_bucket: string
          storage_etag: string | null
          storage_stat_at: string | null
          updated_at: string
          uploaded_by_account_id: string | null
          version: number
          visibility: string
        }
        Insert: {
          actual_mime_type?: string | null
          actual_size_bytes?: number | null
          allowed_mime_types?: string[]
          attachment_code?: string | null
          category: string
          checksum?: string | null
          checksum_algorithm?: string
          checksum_verified?: boolean
          created_at?: string
          declared_mime_type?: string | null
          deleted_at?: string | null
          finalized_at?: string | null
          id?: string
          legal_hold_until?: string | null
          max_bytes?: number
          mime_type: string
          object_key: string
          owner_domain: string
          owner_record_id: string
          reference?: string
          retention_class?: string
          retention_until?: string | null
          safe_filename: string
          scan_status?: string
          size_bytes: number
          storage_bucket?: string
          storage_etag?: string | null
          storage_stat_at?: string | null
          updated_at?: string
          uploaded_by_account_id?: string | null
          version?: number
          visibility?: string
        }
        Update: {
          actual_mime_type?: string | null
          actual_size_bytes?: number | null
          allowed_mime_types?: string[]
          attachment_code?: string | null
          category?: string
          checksum?: string | null
          checksum_algorithm?: string
          checksum_verified?: boolean
          created_at?: string
          declared_mime_type?: string | null
          deleted_at?: string | null
          finalized_at?: string | null
          id?: string
          legal_hold_until?: string | null
          max_bytes?: number
          mime_type?: string
          object_key?: string
          owner_domain?: string
          owner_record_id?: string
          reference?: string
          retention_class?: string
          retention_until?: string | null
          safe_filename?: string
          scan_status?: string
          size_bytes?: number
          storage_bucket?: string
          storage_etag?: string | null
          storage_stat_at?: string | null
          updated_at?: string
          uploaded_by_account_id?: string | null
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
          created_by_account_id: string | null
          email_hash: string
          id: string
          note: string | null
          reason: string
          suppressed_at: string
        }
        Insert: {
          created_by_account_id?: string | null
          email_hash: string
          id?: string
          note?: string | null
          reason: string
          suppressed_at?: string
        }
        Update: {
          created_by_account_id?: string | null
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
          publication_note: string | null
          published_at: string | null
          published_by_account_id: string | null
          reference: string
          status: string
          version: number
        }
        Insert: {
          created_at?: string
          grade_section_id: string
          id?: string
          publication_note?: string | null
          published_at?: string | null
          published_by_account_id?: string | null
          reference?: string
          status?: string
          version?: number
        }
        Update: {
          created_at?: string
          grade_section_id?: string
          id?: string
          publication_note?: string | null
          published_at?: string | null
          published_by_account_id?: string | null
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
          {
            foreignKeyName: "exam_schedule_versions_published_by_account_id_fkey"
            columns: ["published_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      external_record_keys: {
        Row: {
          created_at: string
          entity: string
          id: string
          record_id: string
          source_key: string
          source_system: string
        }
        Insert: {
          created_at?: string
          entity: string
          id?: string
          record_id: string
          source_key: string
          source_system: string
        }
        Update: {
          created_at?: string
          entity?: string
          id?: string
          record_id?: string
          source_key?: string
          source_system?: string
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
      finance_adjustment_requests: {
        Row: {
          amount_paise: number
          approved_by_account_id: string | null
          created_at: string
          decided_at: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string
          kind: string
          posted_at: string | null
          reason: string
          reference: string
          requested_by_account_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          amount_paise: number
          approved_by_account_id?: string | null
          created_at?: string
          decided_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          kind: string
          posted_at?: string | null
          reason: string
          reference?: string
          requested_by_account_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          amount_paise?: number
          approved_by_account_id?: string | null
          created_at?: string
          decided_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          kind?: string
          posted_at?: string | null
          reason?: string
          reference?: string
          requested_by_account_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_adjustment_requests_approved_by_account_id_fkey"
            columns: ["approved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_adjustment_requests_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_adjustment_requests_requested_by_account_id_fkey"
            columns: ["requested_by_account_id"]
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
      guardian_campaigns: {
        Row: {
          academic_year_id: string | null
          created_at: string
          created_by_account_id: string
          delivery_channel: string
          eligible_count: number
          id: string
          label: string
          missing_contact_count: number
          reference: string
          shared_contact_count: number
          state: string
          updated_at: string
        }
        Insert: {
          academic_year_id?: string | null
          created_at?: string
          created_by_account_id: string
          delivery_channel?: string
          eligible_count?: number
          id?: string
          label: string
          missing_contact_count?: number
          reference?: string
          shared_contact_count?: number
          state?: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: string | null
          created_at?: string
          created_by_account_id?: string
          delivery_channel?: string
          eligible_count?: number
          id?: string
          label?: string
          missing_contact_count?: number
          reference?: string
          shared_contact_count?: number
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_campaigns_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_campaigns_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_claim_deliveries: {
        Row: {
          attempts: number
          channel: string
          claim_id: string
          created_at: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          state: string
        }
        Insert: {
          attempts?: number
          channel: string
          claim_id: string
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          state?: string
        }
        Update: {
          attempts?: number
          channel?: string
          claim_id?: string
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_claim_deliveries_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "guardian_claim_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_claim_invitations: {
        Row: {
          campaign_id: string | null
          channel: string
          claimed_at: string | null
          consent_version: number
          created_at: string
          created_by_account_id: string
          expires_at: string
          guardian_contact_id: string
          guardian_id: string
          id: string
          provider_subject: string | null
          reference: string
          secret_hash: string
          status: string
          token_hash: string | null
          updated_at: string
          use_count: number
        }
        Insert: {
          campaign_id?: string | null
          channel: string
          claimed_at?: string | null
          consent_version?: number
          created_at?: string
          created_by_account_id: string
          expires_at: string
          guardian_contact_id: string
          guardian_id: string
          id?: string
          provider_subject?: string | null
          reference?: string
          secret_hash: string
          status?: string
          token_hash?: string | null
          updated_at?: string
          use_count?: number
        }
        Update: {
          campaign_id?: string | null
          channel?: string
          claimed_at?: string | null
          consent_version?: number
          created_at?: string
          created_by_account_id?: string
          expires_at?: string
          guardian_contact_id?: string
          guardian_id?: string
          id?: string
          provider_subject?: string | null
          reference?: string
          secret_hash?: string
          status?: string
          token_hash?: string | null
          updated_at?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "guardian_claim_invitations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "guardian_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_claim_invitations_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_claim_invitations_guardian_contact_id_fkey"
            columns: ["guardian_contact_id"]
            isOneToOne: false
            referencedRelation: "guardian_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_claim_invitations_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_claim_links: {
        Row: {
          claim_id: string
          link_id: string
        }
        Insert: {
          claim_id: string
          link_id: string
        }
        Update: {
          claim_id?: string
          link_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_claim_links_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "guardian_claim_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_claim_links_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "guardian_student_links"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_contact_changes: {
        Row: {
          account_id: string
          approved_by_account_id: string | null
          change_reason: string | null
          created_at: string
          decided_at: string | null
          decided_by_account_id: string | null
          guardian_contact_id: string
          guardian_id: string | null
          id: string
          new_contact_id: string | null
          old_contact_id: string | null
          pending_value: string
          reference: string
          requested_at: string
          requested_by_account_id: string | null
          review_reason: string | null
          state: string
          status: string | null
          verification_method: string | null
          version: number
        }
        Insert: {
          account_id: string
          approved_by_account_id?: string | null
          change_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_account_id?: string | null
          guardian_contact_id: string
          guardian_id?: string | null
          id?: string
          new_contact_id?: string | null
          old_contact_id?: string | null
          pending_value: string
          reference?: string
          requested_at?: string
          requested_by_account_id?: string | null
          review_reason?: string | null
          state?: string
          status?: string | null
          verification_method?: string | null
          version?: number
        }
        Update: {
          account_id?: string
          approved_by_account_id?: string | null
          change_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_account_id?: string | null
          guardian_contact_id?: string
          guardian_id?: string | null
          id?: string
          new_contact_id?: string | null
          old_contact_id?: string | null
          pending_value?: string
          reference?: string
          requested_at?: string
          requested_by_account_id?: string | null
          review_reason?: string | null
          state?: string
          status?: string | null
          verification_method?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "guardian_contact_changes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_contact_changes_approved_by_account_id_fkey"
            columns: ["approved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_contact_changes_decided_by_account_id_fkey"
            columns: ["decided_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_contact_changes_guardian_contact_id_fkey"
            columns: ["guardian_contact_id"]
            isOneToOne: false
            referencedRelation: "guardian_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_contact_changes_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_contact_changes_new_contact_id_fkey"
            columns: ["new_contact_id"]
            isOneToOne: false
            referencedRelation: "guardian_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_contact_changes_old_contact_id_fkey"
            columns: ["old_contact_id"]
            isOneToOne: false
            referencedRelation: "guardian_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_contact_changes_requested_by_account_id_fkey"
            columns: ["requested_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_contacts: {
        Row: {
          channel: string
          created_at: string
          guardian_id: string
          id: string
          shared_contact_flag: boolean
          state: string
          updated_at: string
          value: string
          verified_at: string | null
          version: number
        }
        Insert: {
          channel: string
          created_at?: string
          guardian_id: string
          id?: string
          shared_contact_flag?: boolean
          state?: string
          updated_at?: string
          value: string
          verified_at?: string | null
          version?: number
        }
        Update: {
          channel?: string
          created_at?: string
          guardian_id?: string
          id?: string
          shared_contact_flag?: boolean
          state?: string
          updated_at?: string
          value?: string
          verified_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "guardian_contacts_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardians"
            referencedColumns: ["id"]
          },
        ]
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
      guardian_preferences: {
        Row: {
          active_student_id: string | null
          guardian_id: string
          updated_at: string
          version: number
        }
        Insert: {
          active_student_id?: string | null
          guardian_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          active_student_id?: string | null
          guardian_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "guardian_preferences_active_student_id_fkey"
            columns: ["active_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_preferences_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: true
            referencedRelation: "guardians"
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
          import_batch_id: string | null
          import_row_id: string | null
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
          import_batch_id?: string | null
          import_row_id?: string | null
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
          import_batch_id?: string | null
          import_row_id?: string | null
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
            foreignKeyName: "guardian_student_links_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "data_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_student_links_import_row_id_fkey"
            columns: ["import_row_id"]
            isOneToOne: false
            referencedRelation: "data_import_rows"
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
          idempotency_key: string | null
          kind: string
          read_at: string | null
          recipient_account_id: string
          source_event_id: string | null
          target_reference: string | null
          target_type: string | null
          title: string
          version: number
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          kind: string
          read_at?: string | null
          recipient_account_id: string
          source_event_id?: string | null
          target_reference?: string | null
          target_type?: string | null
          title: string
          version?: number
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          kind?: string
          read_at?: string | null
          recipient_account_id?: string
          source_event_id?: string | null
          target_reference?: string | null
          target_type?: string | null
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "in_app_notifications_recipient_account_id_fkey"
            columns: ["recipient_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "in_app_notifications_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "outbox_events"
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
          waived_at: string | null
          waived_by_account_id: string | null
          waiver_reason: string | null
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
          waived_at?: string | null
          waived_by_account_id?: string | null
          waiver_reason?: string | null
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
          waived_at?: string | null
          waived_by_account_id?: string | null
          waiver_reason?: string | null
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
          {
            foreignKeyName: "invoices_waived_by_account_id_fkey"
            columns: ["waived_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_decisions: {
        Row: {
          action: string
          actor_account_id: string
          application_id: string
          created_at: string
          from_status: string
          id: string
          private_note: string | null
          reason: string | null
          reference: string
          to_status: string
          version: number
        }
        Insert: {
          action: string
          actor_account_id: string
          application_id: string
          created_at?: string
          from_status: string
          id?: string
          private_note?: string | null
          reason?: string | null
          reference?: string
          to_status: string
          version: number
        }
        Update: {
          action?: string
          actor_account_id?: string
          application_id?: string
          created_at?: string
          from_status?: string
          id?: string
          private_note?: string | null
          reason?: string | null
          reference?: string
          to_status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_application_decisions_actor_account_id_fkey"
            columns: ["actor_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_application_decisions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_application_drafts: {
        Row: {
          application_id: string
          draft: Json
          expires_at: string
          id: string
          schema_version: number
          updated_at: string
          version: number
        }
        Insert: {
          application_id: string
          draft?: Json
          expires_at: string
          id?: string
          schema_version?: number
          updated_at?: string
          version?: number
        }
        Update: {
          application_id?: string
          draft?: Json
          expires_at?: string
          id?: string
          schema_version?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_application_drafts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "job_applications"
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
          requirement_code: string | null
        }
        Insert: {
          application_id: string
          document_id: string
          id?: string
          requirement_code?: string | null
        }
        Update: {
          application_id?: string
          document_id?: string
          id?: string
          requirement_code?: string | null
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
      job_retention_records: {
        Row: {
          application_id: string
          created_at: string
          eligible_at: string
          id: string
          legal_hold_until: string | null
          reason: string | null
          reference: string
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          eligible_at: string
          id?: string
          legal_hold_until?: string | null
          reason?: string | null
          reference?: string
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          eligible_at?: string
          id?: string
          legal_hold_until?: string | null
          reason?: string | null
          reference?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_retention_records_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
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
      job_scorecard_versions: {
        Row: {
          application_id: string
          created_at: string
          id: string
          notes: string | null
          reviewer_account_id: string
          score: number
          scorecard_id: string
          version: number
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          notes?: string | null
          reviewer_account_id: string
          score: number
          scorecard_id: string
          version: number
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          reviewer_account_id?: string
          score?: number
          scorecard_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_scorecard_versions_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_scorecard_versions_reviewer_account_id_fkey"
            columns: ["reviewer_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_scorecard_versions_scorecard_id_fkey"
            columns: ["scorecard_id"]
            isOneToOne: false
            referencedRelation: "job_scorecards"
            referencedColumns: ["id"]
          },
        ]
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
          approved_by_account_id: string | null
          category: string
          content_item_id: string
          created_at: string
          expires_at: string | null
          id: string
          published_at: string | null
          published_by_account_id: string | null
          reference: string
          review_due: string | null
          scheduled_at: string | null
          starts_at: string | null
          status: string
          unpublished_at: string | null
          updated_at: string
          urgent: boolean
        }
        Insert: {
          approved_by_account_id?: string | null
          category?: string
          content_item_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          published_at?: string | null
          published_by_account_id?: string | null
          reference?: string
          review_due?: string | null
          scheduled_at?: string | null
          starts_at?: string | null
          status?: string
          unpublished_at?: string | null
          updated_at?: string
          urgent?: boolean
        }
        Update: {
          approved_by_account_id?: string | null
          category?: string
          content_item_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          published_at?: string | null
          published_by_account_id?: string | null
          reference?: string
          review_due?: string | null
          scheduled_at?: string | null
          starts_at?: string | null
          status?: string
          unpublished_at?: string | null
          updated_at?: string
          urgent?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "notices_approved_by_account_id_fkey"
            columns: ["approved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_content_item_id_fkey"
            columns: ["content_item_id"]
            isOneToOne: true
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_published_by_account_id_fkey"
            columns: ["published_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
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
          failure_class: string | null
          id: string
          last_error: string | null
          next_attempt_at: string | null
          provider_event_at: string | null
          provider_event_rank: number
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
          failure_class?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          provider_event_at?: string | null
          provider_event_rank?: number
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
          failure_class?: string | null
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          provider_event_at?: string | null
          provider_event_rank?: number
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
          expected_version: number
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string
          method: string
          provider_code: string
          provider_order_ref: string | null
          reference: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          currency?: string
          expected_version?: number
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          method: string
          provider_code?: string
          provider_order_ref?: string | null
          reference?: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          currency?: string
          expected_version?: number
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          method?: string
          provider_code?: string
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
      provider_jobs: {
        Row: {
          attempts: number
          correlation_id: string | null
          created_at: string
          document_id: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          job_kind: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          reference: string
          started_at: string | null
          status: string
          target_reference: string | null
          target_type: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          correlation_id?: string | null
          created_at?: string
          document_id?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          job_kind: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          reference?: string
          started_at?: string | null
          status?: string
          target_reference?: string | null
          target_type?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          correlation_id?: string | null
          created_at?: string
          document_id?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          job_kind?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          reference?: string
          started_at?: string | null
          status?: string
          target_reference?: string | null
          target_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_jobs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
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
      reconciliation_evidence: {
        Row: {
          amount_paise: number
          currency: string
          evidence: Json
          id: string
          imported_at: string
          invoice_reference: string | null
          provider_code: string
          provider_event_id: string
          provider_txn_id: string | null
          reference: string
          run_id: string
          state: string
        }
        Insert: {
          amount_paise: number
          currency?: string
          evidence?: Json
          id?: string
          imported_at?: string
          invoice_reference?: string | null
          provider_code?: string
          provider_event_id: string
          provider_txn_id?: string | null
          reference?: string
          run_id: string
          state: string
        }
        Update: {
          amount_paise?: number
          currency?: string
          evidence?: Json
          id?: string
          imported_at?: string
          invoice_reference?: string | null
          provider_code?: string
          provider_event_id?: string
          provider_txn_id?: string | null
          reference?: string
          run_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_evidence_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_exceptions: {
        Row: {
          created_at: string
          detail: Json | null
          evidence_id: string | null
          id: string
          kind: string
          resolution_reason: string | null
          resolved_at: string | null
          resolved_by_account_id: string | null
          run_id: string
          status: string
          version: number
        }
        Insert: {
          created_at?: string
          detail?: Json | null
          evidence_id?: string | null
          id?: string
          kind: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by_account_id?: string | null
          run_id: string
          status?: string
          version?: number
        }
        Update: {
          created_at?: string
          detail?: Json | null
          evidence_id?: string | null
          id?: string
          kind?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by_account_id?: string | null
          run_id?: string
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_exceptions_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_exceptions_resolved_by_account_id_fkey"
            columns: ["resolved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_exceptions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_imports: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          request_hash: string
          result: Json
          run_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          request_hash: string
          result?: Json
          run_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          request_hash?: string
          result?: Json
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_imports_run_id_fkey"
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
          idempotency_key: string | null
          reference: string
          request_hash: string | null
          run_at: string
          status: string
          summary: Json | null
        }
        Insert: {
          created_by_account_id?: string | null
          id?: string
          idempotency_key?: string | null
          reference?: string
          request_hash?: string | null
          run_at?: string
          status?: string
          summary?: Json | null
        }
        Update: {
          created_by_account_id?: string | null
          id?: string
          idempotency_key?: string | null
          reference?: string
          request_hash?: string | null
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
      recoverable_error_log: {
        Row: {
          account_id: string | null
          context: Json | null
          created_at: string
          error_code: string
          error_message: string
          id: string
          recoverable_action: string
          reference: string
          resolved_at: string | null
          route: string | null
        }
        Insert: {
          account_id?: string | null
          context?: Json | null
          created_at?: string
          error_code: string
          error_message: string
          id?: string
          recoverable_action: string
          reference?: string
          resolved_at?: string | null
          route?: string | null
        }
        Update: {
          account_id?: string | null
          context?: Json | null
          created_at?: string
          error_code?: string
          error_message?: string
          id?: string
          recoverable_action?: string
          reference?: string
          resolved_at?: string | null
          route?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recoverable_error_log_account_id_fkey"
            columns: ["account_id"]
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
          idempotency_key: string | null
          payment_id: string
          reason: string
          reference: string
          request_hash: string | null
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
          idempotency_key?: string | null
          payment_id: string
          reason: string
          reference?: string
          request_hash?: string | null
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
          idempotency_key?: string | null
          payment_id?: string
          reason?: string
          reference?: string
          request_hash?: string | null
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
          attempts: number
          created_at: string
          event_time: string
          event_type: string
          id: string
          last_error: string | null
          next_attempt_at: string | null
          normalized: Json | null
          payload_hash: string
          processed_at: string | null
          received_at: string
          status: string
          svix_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_time: string
          event_type: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          normalized?: Json | null
          payload_hash: string
          processed_at?: string | null
          received_at?: string
          status?: string
          svix_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_time?: string
          event_type?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          normalized?: Json | null
          payload_hash?: string
          processed_at?: string | null
          received_at?: string
          status?: string
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
          approved_at: string | null
          created_at: string
          decided_at: string | null
          decided_by_account_id: string | null
          id: string
          new_entry_sheet_id: string | null
          publication_id: string
          reason: string
          release_id: string | null
          requested_by_account_id: string
          source_entry_sheet_id: string | null
          status: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_account_id?: string | null
          id?: string
          new_entry_sheet_id?: string | null
          publication_id: string
          reason: string
          release_id?: string | null
          requested_by_account_id: string
          source_entry_sheet_id?: string | null
          status?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_account_id?: string | null
          id?: string
          new_entry_sheet_id?: string | null
          publication_id?: string
          reason?: string
          release_id?: string | null
          requested_by_account_id?: string
          source_entry_sheet_id?: string | null
          status?: string
          version?: number
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
            foreignKeyName: "result_correction_requests_new_entry_sheet_id_fkey"
            columns: ["new_entry_sheet_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheets"
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
            foreignKeyName: "result_correction_requests_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "result_report_releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_correction_requests_requested_by_account_id_fkey"
            columns: ["requested_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_correction_requests_source_entry_sheet_id_fkey"
            columns: ["source_entry_sheet_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheets"
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
      result_entry_sheet_components: {
        Row: {
          assessment_component_id: string
          component_order: number
          id: string
          max_marks: number
          name: string
          reference: string
          sheet_id: string
          weight: number | null
        }
        Insert: {
          assessment_component_id: string
          component_order?: number
          id?: string
          max_marks: number
          name: string
          reference?: string
          sheet_id: string
          weight?: number | null
        }
        Update: {
          assessment_component_id?: string
          component_order?: number
          id?: string
          max_marks?: number
          name?: string
          reference?: string
          sheet_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "result_entry_sheet_components_assessment_component_id_fkey"
            columns: ["assessment_component_id"]
            isOneToOne: false
            referencedRelation: "assessment_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheet_components_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      result_entry_sheet_marks: {
        Row: {
          component_id: string
          created_at: string
          id: string
          mark_status: string
          obtained: number | null
          remark: string | null
          roster_id: string
          sheet_id: string
          updated_at: string
        }
        Insert: {
          component_id: string
          created_at?: string
          id?: string
          mark_status?: string
          obtained?: number | null
          remark?: string | null
          roster_id: string
          sheet_id: string
          updated_at?: string
        }
        Update: {
          component_id?: string
          created_at?: string
          id?: string
          mark_status?: string
          obtained?: number | null
          remark?: string | null
          roster_id?: string
          sheet_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_entry_sheet_marks_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheet_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheet_marks_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheet_rosters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheet_marks_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      result_entry_sheet_rosters: {
        Row: {
          enrollment_id: string
          frozen_at: string
          id: string
          reference: string
          roster_order: number
          sheet_id: string
          student_id: string
        }
        Insert: {
          enrollment_id: string
          frozen_at?: string
          id?: string
          reference?: string
          roster_order?: number
          sheet_id: string
          student_id: string
        }
        Update: {
          enrollment_id?: string
          frozen_at?: string
          id?: string
          reference?: string
          roster_order?: number
          sheet_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_entry_sheet_rosters_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheet_rosters_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheet_rosters_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      result_entry_sheet_versions: {
        Row: {
          actor_account_id: string
          created_at: string
          id: string
          note: string | null
          sheet_id: string
          state: string
          version: number
        }
        Insert: {
          actor_account_id: string
          created_at?: string
          id?: string
          note?: string | null
          sheet_id: string
          state: string
          version: number
        }
        Update: {
          actor_account_id?: string
          created_at?: string
          id?: string
          note?: string | null
          sheet_id?: string
          state?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "result_entry_sheet_versions_actor_account_id_fkey"
            columns: ["actor_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheet_versions_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      result_entry_sheets: {
        Row: {
          academic_year_id: string
          correction_request_id: string | null
          created_at: string
          exam_definition_id: string
          grade_section_id: string
          id: string
          last_entry_by_account_id: string | null
          legacy_batch_id: string | null
          moderated_by_account_id: string | null
          published_by_account_id: string | null
          reference: string
          source_sheet_id: string | null
          state: string
          subject_id: string
          updated_at: string
          version: number
        }
        Insert: {
          academic_year_id: string
          correction_request_id?: string | null
          created_at?: string
          exam_definition_id: string
          grade_section_id: string
          id?: string
          last_entry_by_account_id?: string | null
          legacy_batch_id?: string | null
          moderated_by_account_id?: string | null
          published_by_account_id?: string | null
          reference?: string
          source_sheet_id?: string | null
          state?: string
          subject_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          academic_year_id?: string
          correction_request_id?: string | null
          created_at?: string
          exam_definition_id?: string
          grade_section_id?: string
          id?: string
          last_entry_by_account_id?: string | null
          legacy_batch_id?: string | null
          moderated_by_account_id?: string | null
          published_by_account_id?: string | null
          reference?: string
          source_sheet_id?: string | null
          state?: string
          subject_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "result_entry_sheets_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheets_exam_definition_id_fkey"
            columns: ["exam_definition_id"]
            isOneToOne: false
            referencedRelation: "exam_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheets_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheets_last_entry_by_account_id_fkey"
            columns: ["last_entry_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheets_legacy_batch_id_fkey"
            columns: ["legacy_batch_id"]
            isOneToOne: true
            referencedRelation: "result_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheets_moderated_by_account_id_fkey"
            columns: ["moderated_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheets_published_by_account_id_fkey"
            columns: ["published_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheets_source_sheet_id_fkey"
            columns: ["source_sheet_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entry_sheets_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
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
          batch_id: string | null
          created_at: string
          id: string
          published_at: string
          published_by_account_id: string
          reference: string
          report_release_id: string | null
          source_entry_sheet_id: string | null
          status: string
          version: number
          withdrawal_reason: string | null
          withdrawn_at: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          id?: string
          published_at?: string
          published_by_account_id: string
          reference?: string
          report_release_id?: string | null
          source_entry_sheet_id?: string | null
          status?: string
          version: number
          withdrawal_reason?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          id?: string
          published_at?: string
          published_by_account_id?: string
          reference?: string
          report_release_id?: string | null
          source_entry_sheet_id?: string | null
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
          {
            foreignKeyName: "result_publications_report_release_id_fkey"
            columns: ["report_release_id"]
            isOneToOne: false
            referencedRelation: "result_report_releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_publications_source_entry_sheet_id_fkey"
            columns: ["source_entry_sheet_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      result_report_release_events: {
        Row: {
          actor_account_id: string
          created_at: string
          event_type: string
          id: string
          reason: string | null
          release_id: string
        }
        Insert: {
          actor_account_id: string
          created_at?: string
          event_type: string
          id?: string
          reason?: string | null
          release_id: string
        }
        Update: {
          actor_account_id?: string
          created_at?: string
          event_type?: string
          id?: string
          reason?: string | null
          release_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_report_release_events_actor_account_id_fkey"
            columns: ["actor_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_report_release_events_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "result_report_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      result_report_release_items: {
        Row: {
          created_at: string
          entry_sheet_id: string | null
          id: string
          publication_id: string
          publication_version: number
          release_id: string
          snapshot: Json
          subject_id: string
        }
        Insert: {
          created_at?: string
          entry_sheet_id?: string | null
          id?: string
          publication_id: string
          publication_version: number
          release_id: string
          snapshot: Json
          subject_id: string
        }
        Update: {
          created_at?: string
          entry_sheet_id?: string | null
          id?: string
          publication_id?: string
          publication_version?: number
          release_id?: string
          snapshot?: Json
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_report_release_items_entry_sheet_id_fkey"
            columns: ["entry_sheet_id"]
            isOneToOne: false
            referencedRelation: "result_entry_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_report_release_items_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "result_publications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_report_release_items_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "result_report_releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_report_release_items_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      result_report_releases: {
        Row: {
          academic_year_id: string
          created_at: string
          enrollment_id: string
          grade_section_id: string
          id: string
          published_at: string
          published_by_account_id: string
          reference: string
          release_version: number
          status: string
          student_id: string
          superseded_at: string | null
          supersedes_release_id: string | null
          term: string
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          enrollment_id: string
          grade_section_id: string
          id?: string
          published_at?: string
          published_by_account_id: string
          reference?: string
          release_version?: number
          status?: string
          student_id: string
          superseded_at?: string | null
          supersedes_release_id?: string | null
          term: string
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          enrollment_id?: string
          grade_section_id?: string
          id?: string
          published_at?: string
          published_by_account_id?: string
          reference?: string
          release_version?: number
          status?: string
          student_id?: string
          superseded_at?: string | null
          supersedes_release_id?: string | null
          term?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_report_releases_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_report_releases_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_report_releases_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_report_releases_published_by_account_id_fkey"
            columns: ["published_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_report_releases_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_report_releases_supersedes_release_id_fkey"
            columns: ["supersedes_release_id"]
            isOneToOne: false
            referencedRelation: "result_report_releases"
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
          is_assignable: boolean
          label: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_assignable?: boolean
          label: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_assignable?: boolean
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
          approved_at: string | null
          approved_by_account_id: string | null
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
          approved_at?: string | null
          approved_by_account_id?: string | null
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
          approved_at?: string | null
          approved_by_account_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "settings_versions_approved_by_account_id_fkey"
            columns: ["approved_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_access_profile_roles: {
        Row: {
          profile_code: string
          role_code: string
          sort_order: number
        }
        Insert: {
          profile_code: string
          role_code: string
          sort_order?: number
        }
        Update: {
          profile_code?: string
          role_code?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_access_profile_roles_profile_code_fkey"
            columns: ["profile_code"]
            isOneToOne: false
            referencedRelation: "staff_access_profiles"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "staff_access_profile_roles_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "role_definitions"
            referencedColumns: ["code"]
          },
        ]
      }
      staff_access_profiles: {
        Row: {
          code: string
          created_at: string
          description: string
          is_active: boolean
          label: string
          updated_at: string
          version: number
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          is_active?: boolean
          label: string
          updated_at?: string
          version?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          is_active?: boolean
          label?: string
          updated_at?: string
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
      staff_invitation_roles: {
        Row: {
          invitation_id: string
          role_code: string
        }
        Insert: {
          invitation_id: string
          role_code: string
        }
        Update: {
          invitation_id?: string
          role_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invitation_roles_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "account_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invitation_roles_role_code_fkey"
            columns: ["role_code"]
            isOneToOne: false
            referencedRelation: "role_definitions"
            referencedColumns: ["code"]
          },
        ]
      }
      staff_members: {
        Row: {
          access_profile_code: string | null
          access_profile_version: number | null
          created_at: string
          employment_status: string
          id: string
          person_id: string
          reference: string
          title: string | null
          updated_at: string
        }
        Insert: {
          access_profile_code?: string | null
          access_profile_version?: number | null
          created_at?: string
          employment_status?: string
          id?: string
          person_id: string
          reference?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          access_profile_code?: string | null
          access_profile_version?: number | null
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
            foreignKeyName: "staff_members_access_profile_code_fkey"
            columns: ["access_profile_code"]
            isOneToOne: false
            referencedRelation: "staff_access_profiles"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "staff_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_orphan_records: {
        Row: {
          bucket: string
          detail: string | null
          discovered_at: string
          id: string
          last_seen_at: string
          object_key: string
          status: string
        }
        Insert: {
          bucket: string
          detail?: string | null
          discovered_at?: string
          id?: string
          last_seen_at?: string
          object_key: string
          status?: string
        }
        Update: {
          bucket?: string
          detail?: string | null
          discovered_at?: string
          id?: string
          last_seen_at?: string
          object_key?: string
          status?: string
        }
        Relationships: []
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
          school_student_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          person_id: string
          reference?: string
          school_student_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          person_id?: string
          reference?: string
          school_student_number?: string | null
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
          author_account_id: string | null
          author_label: string | null
          body: string
          created_at: string
          id: string
          idempotency_key: string | null
          is_staff: boolean
          support_request_id: string
          visibility: string
        }
        Insert: {
          author_account_id?: string | null
          author_label?: string | null
          body: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          is_staff?: boolean
          support_request_id: string
          visibility?: string
        }
        Update: {
          author_account_id?: string | null
          author_label?: string | null
          body?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          is_staff?: boolean
          support_request_id?: string
          visibility?: string
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
          idempotency_key: string | null
          support_request_id: string
        }
        Insert: {
          author_account_id: string
          body: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          support_request_id: string
        }
        Update: {
          author_account_id?: string
          body?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
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
          captcha_provider: string | null
          captcha_verified_at: string | null
          category: string
          created_at: string
          id: string
          intake_key_hash: string | null
          last_public_intake_at: string | null
          priority: string
          public_intake_key: string | null
          reference: string
          requester_account_id: string | null
          requester_contact: string | null
          requester_name: string | null
          resolution_code: string | null
          resolved_at: string | null
          sla_due_at: string | null
          status: string
          subject: string
          updated_at: string
          version: number
        }
        Insert: {
          assignee_account_id?: string | null
          captcha_provider?: string | null
          captcha_verified_at?: string | null
          category: string
          created_at?: string
          id?: string
          intake_key_hash?: string | null
          last_public_intake_at?: string | null
          priority?: string
          public_intake_key?: string | null
          reference?: string
          requester_account_id?: string | null
          requester_contact?: string | null
          requester_name?: string | null
          resolution_code?: string | null
          resolved_at?: string | null
          sla_due_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          version?: number
        }
        Update: {
          assignee_account_id?: string | null
          captcha_provider?: string | null
          captcha_verified_at?: string | null
          category?: string
          created_at?: string
          id?: string
          intake_key_hash?: string | null
          last_public_intake_at?: string | null
          priority?: string
          public_intake_key?: string | null
          reference?: string
          requester_account_id?: string | null
          requester_contact?: string | null
          requester_name?: string | null
          resolution_code?: string | null
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
      teaching_assignments: {
        Row: {
          academic_year_id: string
          created_at: string
          created_by_account_id: string | null
          created_reason: string
          effective_from: string
          effective_to: string | null
          grade_section_id: string
          id: string
          provenance: string
          reference: string
          source_ref: string | null
          staff_member_id: string
          status: string
          subject_id: string
          updated_at: string
          updated_by_account_id: string | null
          version: number
        }
        Insert: {
          academic_year_id: string
          created_at?: string
          created_by_account_id?: string | null
          created_reason?: string
          effective_from?: string
          effective_to?: string | null
          grade_section_id: string
          id?: string
          provenance?: string
          reference?: string
          source_ref?: string | null
          staff_member_id: string
          status?: string
          subject_id: string
          updated_at?: string
          updated_by_account_id?: string | null
          version?: number
        }
        Update: {
          academic_year_id?: string
          created_at?: string
          created_by_account_id?: string | null
          created_reason?: string
          effective_from?: string
          effective_to?: string | null
          grade_section_id?: string
          id?: string
          provenance?: string
          reference?: string
          source_ref?: string | null
          staff_member_id?: string
          status?: string
          subject_id?: string
          updated_at?: string
          updated_by_account_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "teaching_assignments_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teaching_assignments_updated_by_account_id_fkey"
            columns: ["updated_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_overrides: {
        Row: {
          created_at: string
          created_by_account_id: string | null
          day_of_week: number
          grade_section_id: string
          id: string
          kind: string
          note: string | null
          override_date: string
          period_number: number
          reference: string
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by_account_id: string | null
          room_id: string | null
          subject_id: string | null
          substitute_teacher_assignment_id: string | null
          substitute_teaching_assignment_id: string | null
          teaching_assignment_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by_account_id?: string | null
          day_of_week: number
          grade_section_id: string
          id?: string
          kind: string
          note?: string | null
          override_date: string
          period_number: number
          reference?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by_account_id?: string | null
          room_id?: string | null
          subject_id?: string | null
          substitute_teacher_assignment_id?: string | null
          substitute_teaching_assignment_id?: string | null
          teaching_assignment_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by_account_id?: string | null
          day_of_week?: number
          grade_section_id?: string
          id?: string
          kind?: string
          note?: string | null
          override_date?: string
          period_number?: number
          reference?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by_account_id?: string | null
          room_id?: string | null
          subject_id?: string | null
          substitute_teacher_assignment_id?: string | null
          substitute_teaching_assignment_id?: string | null
          teaching_assignment_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "timetable_overrides_created_by_account_id_fkey"
            columns: ["created_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_overrides_grade_section_id_fkey"
            columns: ["grade_section_id"]
            isOneToOne: false
            referencedRelation: "grade_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_overrides_revoked_by_account_id_fkey"
            columns: ["revoked_by_account_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
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
          {
            foreignKeyName: "timetable_overrides_substitute_teaching_assignment_id_fkey"
            columns: ["substitute_teaching_assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_overrides_teaching_assignment_id_fkey"
            columns: ["teaching_assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
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
          teaching_assignment_id: string | null
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
          teaching_assignment_id?: string | null
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
          teaching_assignment_id?: string | null
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
            foreignKeyName: "timetable_periods_teaching_assignment_id_fkey"
            columns: ["teaching_assignment_id"]
            isOneToOne: false
            referencedRelation: "teaching_assignments"
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
          revision: number
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
          revision?: number
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
          revision?: number
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
          mfa_status: string
          mfa_verified_at: string | null
          person_id: string
          status: string
          updated_at: string
          verified_contact: string | null
        }
        Insert: {
          created_at?: string
          id: string
          mfa_status?: string
          mfa_verified_at?: string | null
          person_id: string
          status?: string
          updated_at?: string
          verified_contact?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          mfa_status?: string
          mfa_verified_at?: string | null
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
  app: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
