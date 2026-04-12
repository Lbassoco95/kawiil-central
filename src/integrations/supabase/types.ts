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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accounting_periods: {
        Row: {
          created_at: string
          id: string
          month: number
          notes: string | null
          organization_id: string
          project_id: string
          status: string
          steps: Json
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          month: number
          notes?: string | null
          organization_id: string
          project_id: string
          status?: string
          steps?: Json
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          month?: number
          notes?: string | null
          organization_id?: string
          project_id?: string
          status?: string
          steps?: Json
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "accounting_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_periods_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string
          entity_type: string
          id: string
          organization_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id: string
          entity_type: string
          id?: string
          organization_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string
          entity_type?: string
          id?: string
          organization_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_feedback: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          chat_message_id: string | null
          rating: string
          created_at: string
          feedback_category: string | null
          feedback_comment: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          chat_message_id?: string | null
          rating: string
          created_at?: string
          feedback_category?: string | null
          feedback_comment?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          chat_message_id?: string | null
          rating?: string
          created_at?: string
          feedback_category?: string | null
          feedback_comment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_user_memories: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          memory_type: string
          content: string
          content_hash: string
          source_conversation_id: string | null
          enabled: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          memory_type: string
          content: string
          content_hash: string
          source_conversation_id?: string | null
          enabled?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          memory_type?: string
          content?: string
          content_hash?: string
          source_conversation_id?: string | null
          enabled?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_user_memories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      improvement_suggestions: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          conversation_id: string
          chat_message_id: string
          suggestion_text: string
          category: string
          summary: Json | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          conversation_id: string
          chat_message_id: string
          suggestion_text: string
          category: string
          summary?: Json | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          conversation_id?: string
          chat_message_id?: string
          suggestion_text?: string
          category?: string
          summary?: Json | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "improvement_suggestions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_declarations: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          project_id: string
          status: string
          steps: Json
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          project_id: string
          status?: string
          steps?: Json
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          project_id?: string
          status?: string
          steps?: Json
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "annual_declarations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_declarations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      celulas: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          responsible_user_id: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          responsible_user_id?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          responsible_user_id?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "areas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          folder: string | null
          id: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          folder?: string | null
          id?: string
          organization_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          folder?: string | null
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_compliance_config: {
        Row: {
          authorization_date: string | null
          client_id: string
          compliance_officer_name: string | null
          created_at: string
          entity_type_id: string
          id: string
          is_active: boolean
          organization_id: string
          registration_number: string | null
          updated_at: string
        }
        Insert: {
          authorization_date?: string | null
          client_id: string
          compliance_officer_name?: string | null
          created_at?: string
          entity_type_id: string
          id?: string
          is_active?: boolean
          organization_id: string
          registration_number?: string | null
          updated_at?: string
        }
        Update: {
          authorization_date?: string | null
          client_id?: string
          compliance_officer_name?: string | null
          created_at?: string
          entity_type_id?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          registration_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_compliance_config_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_compliance_config_entity_type_id_fkey"
            columns: ["entity_type_id"]
            isOneToOne: false
            referencedRelation: "compliance_entity_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_compliance_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_collaborators: {
        Row: {
          client_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_collaborators_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          client_type: Database["public"]["Enums"]["client_type"]
          contact_name: string | null
          contact_position: string | null
          created_at: string
          created_by: string | null
          dropbox_folder_path: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          payroll_type: string | null
          phone: string | null
          primary_area: Database["public"]["Enums"]["service_area"] | null
          responsible_user_id: string | null
          rfc: string | null
          sat_fiel_location_hint: string | null
          sat_fiel_managed_by_firm: boolean
          services: Database["public"]["Enums"]["service_area"][]
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
        }
        Insert: {
          address?: string | null
          client_type?: Database["public"]["Enums"]["client_type"]
          contact_name?: string | null
          contact_position?: string | null
          created_at?: string
          created_by?: string | null
          dropbox_folder_path?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          payroll_type?: string | null
          phone?: string | null
          primary_area?: Database["public"]["Enums"]["service_area"] | null
          responsible_user_id?: string | null
          rfc?: string | null
          sat_fiel_location_hint?: string | null
          sat_fiel_managed_by_firm?: boolean
          services?: Database["public"]["Enums"]["service_area"][]
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
        }
        Update: {
          address?: string | null
          client_type?: Database["public"]["Enums"]["client_type"]
          contact_name?: string | null
          contact_position?: string | null
          created_at?: string
          created_by?: string | null
          dropbox_folder_path?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          payroll_type?: string | null
          phone?: string | null
          primary_area?: Database["public"]["Enums"]["service_area"] | null
          responsible_user_id?: string | null
          rfc?: string | null
          sat_fiel_location_hint?: string | null
          sat_fiel_managed_by_firm?: boolean
          services?: Database["public"]["Enums"]["service_area"][]
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_entity_types: {
        Row: {
          code: string
          created_at: string
          description: string | null
          group_name: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          group_name: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          group_name?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      compliance_task_templates: {
        Row: {
          category: string
          created_at: string
          description: string | null
          due_day: number | null
          due_description: string | null
          due_month: number | null
          due_month_2: number | null
          entity_type_id: string
          id: string
          is_active: boolean
          legal_basis: string | null
          periodicity: string
          sort_order: number
          task_name: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          due_day?: number | null
          due_description?: string | null
          due_month?: number | null
          due_month_2?: number | null
          entity_type_id: string
          id?: string
          is_active?: boolean
          legal_basis?: string | null
          periodicity: string
          sort_order?: number
          task_name: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          due_day?: number | null
          due_description?: string | null
          due_month?: number | null
          due_month_2?: number | null
          entity_type_id?: string
          id?: string
          is_active?: boolean
          legal_basis?: string | null
          periodicity?: string
          sort_order?: number
          task_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_task_templates_entity_type_id_fkey"
            columns: ["entity_type_id"]
            isOneToOne: false
            referencedRelation: "compliance_entity_types"
            referencedColumns: ["id"]
          },
        ]
      }
      document_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          client_id: string | null
          created_at: string
          document_type: string | null
          external_id: string | null
          external_path: string | null
          file_path: string | null
          file_size: number | null
          id: string
          mime_type: string | null
          name: string
          organization_id: string
          project_id: string | null
          source: Database["public"]["Enums"]["document_source"]
          tags: string[] | null
          task_id: string | null
          updated_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          document_type?: string | null
          external_id?: string | null
          external_path?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          name: string
          organization_id: string
          project_id?: string | null
          source?: Database["public"]["Enums"]["document_source"]
          tags?: string[] | null
          task_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          document_type?: string | null
          external_id?: string | null
          external_path?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          name?: string
          organization_id?: string
          project_id?: string | null
          source?: Database["public"]["Enums"]["document_source"]
          tags?: string[] | null
          task_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_income_viewers: {
        Row: {
          can_write_savio: boolean
          created_at: string
          organization_id: string
          user_id: string
        }
        Insert: {
          can_write_savio?: boolean
          created_at?: string
          organization_id: string
          user_id: string
        }
        Update: {
          can_write_savio?: boolean
          created_at?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_income_viewers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          category: string
          client_id: string | null
          created_at: string
          currency: string
          description: string
          attachments: Json
          expense_date: string
          id: string
          notes: string | null
          organization_id: string
          paid_at: string | null
          paid_by: string | null
          project_id: string | null
          receipt_path: string | null
          rejection_reason: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json
          category: string
          client_id?: string | null
          created_at?: string
          currency?: string
          description: string
          expense_date?: string
          id?: string
          notes?: string | null
          organization_id: string
          paid_at?: string | null
          paid_by?: string | null
          project_id?: string | null
          receipt_path?: string | null
          rejection_reason?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json
          category?: string
          client_id?: string | null
          created_at?: string
          currency?: string
          description?: string
          expense_date?: string
          id?: string
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          paid_by?: string | null
          project_id?: string | null
          receipt_path?: string | null
          rejection_reason?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      extracted_documents: {
        Row: {
          ai_observations: Json | null
          ai_summary: string | null
          cfdi_type: string | null
          client_id: string | null
          confidence_score: number | null
          created_at: string
          currency: string | null
          declaration_type: string | null
          document_date: string | null
          document_id: string
          document_type: string
          extracted_data: Json
          extraction_error: string | null
          extraction_model: string | null
          extraction_status: string
          fiscal_period: string | null
          id: string
          isr_amount: number | null
          iva_amount: number | null
          organization_id: string
          processing_time_ms: number | null
          project_id: string | null
          retenciones_amount: number | null
          rfc_emisor: string | null
          rfc_receptor: string | null
          tax_amount: number | null
          total_amount: number | null
          updated_at: string
          uuid_fiscal: string | null
        }
        Insert: {
          ai_observations?: Json | null
          ai_summary?: string | null
          cfdi_type?: string | null
          client_id?: string | null
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          declaration_type?: string | null
          document_date?: string | null
          document_id: string
          document_type?: string
          extracted_data?: Json
          extraction_error?: string | null
          extraction_model?: string | null
          extraction_status?: string
          fiscal_period?: string | null
          id?: string
          isr_amount?: number | null
          iva_amount?: number | null
          organization_id: string
          processing_time_ms?: number | null
          project_id?: string | null
          retenciones_amount?: number | null
          rfc_emisor?: string | null
          rfc_receptor?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string
          uuid_fiscal?: string | null
        }
        Update: {
          ai_observations?: Json | null
          ai_summary?: string | null
          cfdi_type?: string | null
          client_id?: string | null
          confidence_score?: number | null
          created_at?: string
          currency?: string | null
          declaration_type?: string | null
          document_date?: string | null
          document_id?: string
          document_type?: string
          extracted_data?: Json
          extraction_error?: string | null
          extraction_model?: string | null
          extraction_status?: string
          fiscal_period?: string | null
          id?: string
          isr_amount?: number | null
          iva_amount?: number | null
          organization_id?: string
          processing_time_ms?: number | null
          project_id?: string | null
          retenciones_amount?: number | null
          rfc_emisor?: string | null
          rfc_receptor?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string
          uuid_fiscal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extracted_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          extracted_document_id: string | null
          id: string
          organization_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          extracted_document_id?: string | null
          id?: string
          organization_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          extracted_document_id?: string | null
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_logs_extracted_document_id_fkey"
            columns: ["extracted_document_id"]
            isOneToOne: false
            referencedRelation: "extracted_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          config: Json | null
          created_at: string
          id: string
          is_active: boolean
          organization_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_comunicados: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          id: string
          is_pinned: boolean
          organization_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          organization_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          organization_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_comunicados_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_procedures: {
        Row: {
          created_at: string
          current_version: number
          description: string | null
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          organization_id: string
          title: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          current_version?: number
          description?: string | null
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id: string
          title: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          current_version?: number
          description?: string | null
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          organization_id?: string
          title?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internal_procedures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          id: string
          organization_id: string
          lead_id: string
          template_id: string | null
          sequence_step_id: string | null
          to_email: string
          additional_to_emails: string[]
          subject: string
          status: string
          scheduled_at: string | null
          sent_at: string | null
          opened_at: string | null
          clicked_at: string | null
          error_message: string | null
          graph_message_id: string | null
          created_at: string
          body_html: string | null
          body_text: string | null
          direction: string
          from_email: string | null
          from_name: string | null
          thread_id: string | null
          conversation_id: string | null
          in_reply_to: string | null
          is_read: boolean
          has_attachments: boolean
          attachments: Json
          received_at: string | null
          headers: Json
        }
        Insert: {
          id?: string
          organization_id?: string
          lead_id: string
          template_id?: string | null
          sequence_step_id?: string | null
          to_email: string
          additional_to_emails?: string[]
          subject: string
          status?: string
          scheduled_at?: string | null
          sent_at?: string | null
          opened_at?: string | null
          clicked_at?: string | null
          error_message?: string | null
          graph_message_id?: string | null
          created_at?: string
          body_html?: string | null
          body_text?: string | null
          direction?: string
          from_email?: string | null
          from_name?: string | null
          thread_id?: string | null
          conversation_id?: string | null
          in_reply_to?: string | null
          is_read?: boolean
          has_attachments?: boolean
          attachments?: Json
          received_at?: string | null
          headers?: Json
        }
        Update: {
          id?: string
          organization_id?: string
          lead_id?: string
          template_id?: string | null
          sequence_step_id?: string | null
          to_email?: string
          additional_to_emails?: string[]
          subject?: string
          status?: string
          scheduled_at?: string | null
          sent_at?: string | null
          opened_at?: string | null
          clicked_at?: string | null
          error_message?: string | null
          graph_message_id?: string | null
          created_at?: string
          body_html?: string | null
          body_text?: string | null
          direction?: string
          from_email?: string | null
          from_name?: string | null
          thread_id?: string | null
          conversation_id?: string | null
          in_reply_to?: string | null
          is_read?: boolean
          has_attachments?: boolean
          attachments?: Json
          received_at?: string | null
          headers?: Json
        }
        Relationships: []
      }
      email_sync_state: {
        Row: {
          id: string
          organization_id: string
          mailbox_email: string
          last_sync_at: string | null
          delta_link: string | null
          next_sync_at: string | null
          sync_status: string
          error_message: string | null
          total_synced: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          mailbox_email?: string
          last_sync_at?: string | null
          delta_link?: string | null
          next_sync_at?: string | null
          sync_status?: string
          error_message?: string | null
          total_synced?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          mailbox_email?: string
          last_sync_at?: string | null
          delta_link?: string | null
          next_sync_at?: string | null
          sync_status?: string
          error_message?: string | null
          total_synced?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_tracking_events: {
        Row: {
          id: string
          email_log_id: string
          lead_id: string
          event_type: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          email_log_id: string
          lead_id: string
          event_type: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          email_log_id?: string
          lead_id?: string
          event_type?: string
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      email_sequence_steps: {
        Row: {
          id: string
          sequence_id: string
          template_id: string
          step_order: number
          delay_hours: number
          condition: Json | null
        }
        Insert: {
          id?: string
          sequence_id: string
          template_id: string
          step_order: number
          delay_hours?: number
          condition?: Json | null
        }
        Update: {
          id?: string
          sequence_id?: string
          template_id?: string
          step_order?: number
          delay_hours?: number
          condition?: Json | null
        }
        Relationships: []
      }
      email_sequences: {
        Row: {
          id: string
          organization_id: string
          name: string
          description: string | null
          trigger_stage: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          description?: string | null
          trigger_stage?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          description?: string | null
          trigger_stage?: string | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          id: string
          organization_id: string
          name: string
          subject: string
          body_html: string
          body_text: string | null
          category: string
          is_active: boolean
          default_attachment_key: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          subject: string
          body_html: string
          body_text?: string | null
          category?: string
          is_active?: boolean
          default_attachment_key?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          subject?: string
          body_html?: string
          body_text?: string | null
          category?: string
          is_active?: boolean
          default_attachment_key?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_activities: {
        Row: {
          id: string
          organization_id: string
          lead_id: string
          user_id: string | null
          type: string
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id?: string
          lead_id: string
          user_id?: string | null
          type: string
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          lead_id?: string
          user_id?: string | null
          type?: string
          metadata?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          id: string
          organization_id: string
          created_at: string
          meta_lead_id: string | null
          meta_created_at: string | null
          campaign_name: string | null
          form_name: string | null
          full_name: string
          email: string | null
          phone: string | null
          whatsapp: string | null
          company_name: string | null
          country_code: string | null
          country_name: string | null
          preferred_contact: string | null
          preferred_time: string | null
          stage_id: string
          owner_id: string | null
          priority: string
          score: number
          tags: string[] | null
          source: string
          is_active: boolean
          notes: string | null
          updated_at: string
          calendly_booked_at: string | null
          calendly_event_uri: string | null
          calendly_status: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          created_at?: string
          meta_lead_id?: string | null
          meta_created_at?: string | null
          campaign_name?: string | null
          form_name?: string | null
          full_name: string
          email?: string | null
          phone?: string | null
          whatsapp?: string | null
          company_name?: string | null
          country_code?: string | null
          country_name?: string | null
          preferred_contact?: string | null
          preferred_time?: string | null
          stage_id: string
          owner_id?: string | null
          priority?: string
          score?: number
          tags?: string[] | null
          source?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
          calendly_booked_at?: string | null
          calendly_event_uri?: string | null
          calendly_status?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          created_at?: string
          meta_lead_id?: string | null
          meta_created_at?: string | null
          campaign_name?: string | null
          form_name?: string | null
          full_name?: string
          email?: string | null
          phone?: string | null
          whatsapp?: string | null
          company_name?: string | null
          country_code?: string | null
          country_name?: string | null
          preferred_contact?: string | null
          preferred_time?: string | null
          stage_id?: string
          owner_id?: string | null
          priority?: string
          score?: number
          tags?: string[] | null
          source?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
          calendly_booked_at?: string | null
          calendly_event_uri?: string | null
          calendly_status?: string | null
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          id: string
          organization_id: string
          name: string
          slug: string
          position: number
          color: string
          is_terminal: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          slug: string
          position?: number
          color?: string
          is_terminal?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          slug?: string
          position?: number
          color?: string
          is_terminal?: boolean
          created_at?: string
        }
        Relationships: []
      }
      microsoft_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      moffin_consults: {
        Row: {
          id: string
          organization_id: string
          project_id: string
          client_id: string | null
          rfc: string
          consult_type: string
          moffin_service: string | null
          status: string
          error_message: string | null
          summary: string | null
          raw_response: Json
          moffin_query_id: string | null
          moffin_uuid: string | null
          document_id: string | null
          requested_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          project_id: string
          client_id?: string | null
          rfc: string
          consult_type: string
          moffin_service?: string | null
          status: string
          error_message?: string | null
          summary?: string | null
          raw_response?: Json
          moffin_query_id?: string | null
          moffin_uuid?: string | null
          document_id?: string | null
          requested_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          project_id?: string
          client_id?: string | null
          rfc?: string
          consult_type?: string
          moffin_service?: string | null
          status?: string
          error_message?: string | null
          summary?: string | null
          raw_response?: Json
          moffin_query_id?: string | null
          moffin_uuid?: string | null
          document_id?: string | null
          requested_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moffin_consults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moffin_consults_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moffin_consults_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moffin_consults_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      mood_checkins: {
        Row: {
          celula: string | null
          check_date: string
          created_at: string
          id: string
          mood: number
          organization_id: string
          reason: string | null
          time_of_day: string
          user_id: string
        }
        Insert: {
          celula?: string | null
          check_date?: string
          created_at?: string
          id?: string
          mood: number
          organization_id: string
          reason?: string | null
          time_of_day?: string
          user_id: string
        }
        Update: {
          celula?: string | null
          check_date?: string
          created_at?: string
          id?: string
          mood?: number
          organization_id?: string
          reason?: string | null
          time_of_day?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mood_checkins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          is_read: boolean
          organization_id: string
          source_user_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          organization_id: string
          source_user_id?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          organization_id?: string
          source_user_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      personalized_phrases: {
        Row: {
          created_at: string
          id: string
          mood_score: number | null
          organization_id: string
          phrase: string
          phrase_date: string
          time_of_day: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mood_score?: number | null
          organization_id: string
          phrase: string
          phrase_date?: string
          time_of_day?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mood_score?: number | null
          organization_id?: string
          phrase?: string
          phrase_date?: string
          time_of_day?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personalized_phrases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          procedure_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          procedure_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          procedure_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "procedure_comments_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "internal_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      procedure_versions: {
        Row: {
          change_notes: string | null
          created_at: string
          file_path: string
          file_size: number | null
          id: string
          mime_type: string | null
          procedure_id: string
          uploaded_by: string | null
          version_number: number
        }
        Insert: {
          change_notes?: string | null
          created_at?: string
          file_path: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          procedure_id: string
          uploaded_by?: string | null
          version_number?: number
        }
        Update: {
          change_notes?: string | null
          created_at?: string
          file_path?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          procedure_id?: string
          uploaded_by?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "procedure_versions_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "internal_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          area: string | null
          avatar_url: string | null
          created_at: string
          dropbox_personal_folder: string | null
          email: string
          full_name: string
          id: string
          invitation_accepted: boolean
          is_active: boolean
          microsoft_email: string | null
          microsoft_user_id: string | null
          onboarding_status: string
          organization_id: string
          phone: string | null
          proactive_ai_notifications: boolean
          reminders_hourly_digest: boolean
          in_app_toast_notifications: boolean
          notification_sound_enabled: boolean
          desktop_browser_notifications: boolean
          desktop_push_notifications: boolean
          notify_slack_mentions: boolean
          notify_slack_channel_watch: boolean
          notify_slack_vip: boolean
          notify_slack_dm: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          area?: string | null
          avatar_url?: string | null
          created_at?: string
          dropbox_personal_folder?: string | null
          email: string
          full_name: string
          id?: string
          invitation_accepted?: boolean
          is_active?: boolean
          microsoft_email?: string | null
          microsoft_user_id?: string | null
          onboarding_status?: string
          organization_id: string
          phone?: string | null
          proactive_ai_notifications?: boolean
          reminders_hourly_digest?: boolean
          in_app_toast_notifications?: boolean
          notification_sound_enabled?: boolean
          desktop_browser_notifications?: boolean
          desktop_push_notifications?: boolean
          notify_slack_mentions?: boolean
          notify_slack_channel_watch?: boolean
          notify_slack_vip?: boolean
          notify_slack_dm?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: string | null
          avatar_url?: string | null
          created_at?: string
          dropbox_personal_folder?: string | null
          email?: string
          full_name?: string
          id?: string
          invitation_accepted?: boolean
          is_active?: boolean
          microsoft_email?: string | null
          microsoft_user_id?: string | null
          onboarding_status?: string
          organization_id?: string
          phone?: string | null
          proactive_ai_notifications?: boolean
          reminders_hourly_digest?: boolean
          in_app_toast_notifications?: boolean
          notification_sound_enabled?: boolean
          desktop_browser_notifications?: boolean
          desktop_push_notifications?: boolean
          notify_slack_mentions?: boolean
          notify_slack_channel_watch?: boolean
          notify_slack_vip?: boolean
          notify_slack_dm?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_comments: {
        Row: {
          attachments: Json | null
          content: string
          created_at: string
          id: string
          mentions: string[] | null
          project_id: string
          step_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attachments?: Json | null
          content: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          project_id: string
          step_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attachments?: Json | null
          content?: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          project_id?: string
          step_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          area: Database["public"]["Enums"]["service_area"] | null
          client_id: string | null
          constitution_details: Json | null
          created_at: string
          created_by: string | null
          criticality_level: string | null
          delay_category: string | null
          delay_notes: string | null
          description: string | null
          end_date: string | null
          id: string
          lawsuit_details: Json | null
          name: string
          organization_id: string
          responsible_user_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          tax_obligations: Json | null
          updated_at: string
        }
        Insert: {
          area?: Database["public"]["Enums"]["service_area"] | null
          client_id?: string | null
          constitution_details?: Json | null
          created_at?: string
          created_by?: string | null
          criticality_level?: string | null
          delay_category?: string | null
          delay_notes?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          lawsuit_details?: Json | null
          name: string
          organization_id: string
          responsible_user_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          tax_obligations?: Json | null
          updated_at?: string
        }
        Update: {
          area?: Database["public"]["Enums"]["service_area"] | null
          client_id?: string | null
          constitution_details?: Json | null
          created_at?: string
          created_by?: string | null
          criticality_level?: string | null
          delay_category?: string | null
          delay_notes?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          lawsuit_details?: Json | null
          name?: string
          organization_id?: string
          responsible_user_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          tax_obligations?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          due_time: string | null
          id: string
          is_completed: boolean
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          is_completed?: boolean
          organization_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          id?: string
          is_completed?: boolean
          organization_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_mail_jobs: {
        Row: {
          id: string
          user_id: string
          status: Database["public"]["Enums"]["scheduled_mail_job_status"]
          scheduled_at: string
          kind: Database["public"]["Enums"]["scheduled_mail_job_kind"]
          draft_id: string
          payload: Json
          error_message: string | null
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          status?: Database["public"]["Enums"]["scheduled_mail_job_status"]
          scheduled_at: string
          kind?: Database["public"]["Enums"]["scheduled_mail_job_kind"]
          draft_id: string
          payload?: Json
          error_message?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          status?: Database["public"]["Enums"]["scheduled_mail_job_status"]
          scheduled_at?: string
          kind?: Database["public"]["Enums"]["scheduled_mail_job_kind"]
          draft_id?: string
          payload?: Json
          error_message?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      savio_webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          organization_id: string
          payload: Json
          processed_at: string | null
          savio_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          organization_id: string
          payload?: Json
          processed_at?: string | null
          savio_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          savio_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "savio_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      savio_write_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          ok: boolean
          operation: string
          organization_id: string
          request_summary: Json
          savio_http_status: number | null
          savio_path: string
          savio_response_excerpt: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          ok?: boolean
          operation: string
          organization_id: string
          request_summary?: Json
          savio_http_status?: number | null
          savio_path: string
          savio_response_excerpt?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          ok?: boolean
          operation?: string
          organization_id?: string
          request_summary?: Json
          savio_http_status?: number | null
          savio_path?: string
          savio_response_excerpt?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "savio_write_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          created_at: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          mentions: string[] | null
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          mentions?: string[] | null
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          area: string | null
          assigned_to: string | null
          checklist: Json | null
          client_id: string | null
          completed_at: string | null
          compliance_period: string | null
          compliance_periodicity: string | null
          compliance_template_id: string | null
          created_at: string
          created_by: string | null
          criticality_level: string | null
          delay_category: string | null
          delay_notes: string | null
          description: string | null
          dropbox_links: Json | null
          due_date: string | null
          id: string
          is_recurring: boolean
          is_subtask: boolean
          organization_id: string
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          phase_key: string | null
          project_id: string | null
          recurrence_pattern: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          tags: string[] | null
          template_id: string | null
          time_spent_seconds: number | null
          title: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          assigned_to?: string | null
          checklist?: Json | null
          client_id?: string | null
          completed_at?: string | null
          compliance_period?: string | null
          compliance_periodicity?: string | null
          compliance_template_id?: string | null
          created_at?: string
          created_by?: string | null
          criticality_level?: string | null
          delay_category?: string | null
          delay_notes?: string | null
          description?: string | null
          dropbox_links?: Json | null
          due_date?: string | null
          id?: string
          is_recurring?: boolean
          is_subtask?: boolean
          organization_id: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          phase_key?: string | null
          project_id?: string | null
          recurrence_pattern?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          template_id?: string | null
          time_spent_seconds?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          assigned_to?: string | null
          checklist?: Json | null
          client_id?: string | null
          completed_at?: string | null
          compliance_period?: string | null
          compliance_periodicity?: string | null
          compliance_template_id?: string | null
          created_at?: string
          created_by?: string | null
          criticality_level?: string | null
          delay_category?: string | null
          delay_notes?: string | null
          description?: string | null
          dropbox_links?: Json | null
          due_date?: string | null
          id?: string
          is_recurring?: boolean
          is_subtask?: boolean
          organization_id?: string
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          phase_key?: string | null
          project_id?: string | null
          recurrence_pattern?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          template_id?: string | null
          time_spent_seconds?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_compliance_template_id_fkey"
            columns: ["compliance_template_id"]
            isOneToOne: false
            referencedRelation: "compliance_task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_obligation_types: {
        Row: {
          created_at: string
          description: string | null
          frequency: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_obligation_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          endpoint?: string
          p256dh?: string
          auth?: string
          user_agent?: string | null
          created_at?: string
        }
        Relationships: []
      }
      slack_channel_watches: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          channel_id: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          channel_id: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string
          channel_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_channel_watches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_communication_prefs: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          channel_id: string
          is_vip: boolean
          is_starred: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          channel_id: string
          is_vip?: boolean
          is_starred?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string
          channel_id?: string
          is_vip?: boolean
          is_starred?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_communication_prefs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_sidebar_group_channels: {
        Row: {
          id: string
          group_id: string
          channel_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          group_id: string
          channel_id: string
          sort_order?: number
        }
        Update: {
          id?: string
          group_id?: string
          channel_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "slack_sidebar_group_channels_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "slack_sidebar_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_sidebar_groups: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          title: string
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          title?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string
          title?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_sidebar_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_slack_connections: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          slack_team_id: string
          slack_user_id: string
          access_token: string
          refresh_token: string | null
          token_expires_at: string | null
          scopes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          slack_team_id: string
          slack_user_id: string
          access_token: string
          refresh_token?: string | null
          token_expires_at?: string | null
          scopes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string
          slack_team_id?: string
          slack_user_id?: string
          access_token?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          scopes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_slack_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_celulas: {
        Row: {
          celula_id: string
          created_at: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          celula_id: string
          created_at?: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          celula_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_celulas_celula_id_fkey"
            columns: ["celula_id"]
            isOneToOne: false
            referencedRelation: "celulas"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          answers: Json
          completed_at: string | null
          created_at: string
          id: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          completed_at?: string | null
          created_at?: string
          id?: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          completed_at?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_mail_directory: {
        Row: {
          user_id: string
          email: string
          display_name: string | null
          last_seen_at: string
          created_at: string
        }
        Insert: {
          user_id: string
          email: string
          display_name?: string | null
          last_seen_at?: string
          created_at?: string
        }
        Update: {
          user_id?: string
          email?: string
          display_name?: string | null
          last_seen_at?: string
          created_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_lead: {
        Args: { p_lead_id: string; p_owner_id: string | null }
        Returns: Json
      }
      bulk_assign_leads: {
        Args: { p_lead_ids: string[]; p_owner_id: string | null }
        Returns: Json
      }
      cancel_sequence: {
        Args: { p_lead_id: string; p_sequence_id: string }
        Returns: Json
      }
      detect_duplicates: {
        Args: { p_email: string | null; p_phone: string | null }
        Returns: Json
      }
      enqueue_sequence: {
        Args: { p_lead_id: string; p_sequence_id: string }
        Returns: Json
      }
      enqueue_sequence_system: {
        Args: {
          p_lead_id: string
          p_organization_id: string
          p_sequence_id: string
        }
        Returns: Json
      }
      get_activity_adoption_stats: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_ai_learning_stats_for_org: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      get_celula_mood_stats: {
        Args: { _end_date: string; _org_id: string; _start_date: string }
        Returns: {
          avg_mood: number
          celula: string
          check_date: string
          time_of_day: string
          total_responses: number
        }[]
      }
      get_pipeline_stats: {
        Args: { p_date_from?: string | null; p_date_to?: string | null }
        Returns: Json
      }
      pipeline_calendly_apply_system: {
        Args: {
          p_booked_at?: string | null
          p_event_uri?: string | null
          p_lead_id: string
          p_new_stage_id?: string | null
          p_organization_id: string
          p_status: string
        }
        Returns: Json
      }
      get_user_org_id: { Args: { _user_id: string }; Returns: string }
      can_view_savio_finance: { Args: { _user_id: string }; Returns: boolean }
      can_write_savio_finance: { Args: { _user_id: string }; Returns: boolean }
      has_finance_access: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_manager: { Args: { _user_id: string }; Returns: boolean }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      move_lead_stage: {
        Args: { p_lead_id: string; p_new_stage_id: string }
        Returns: Json
      }
      score_lead: {
        Args: { p_lead_id: string; p_reason?: string | null; p_score: number }
        Returns: Json
      }
      user_in_celula: {
        Args: { _celula_slug: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      scheduled_mail_job_kind: "send_draft"
      scheduled_mail_job_status: "pending" | "processing" | "sent" | "failed" | "cancelled"
      app_role: "transformador" | "referente" | "ejecutor" | "en_formacion"
      client_status: "activo" | "inactivo" | "prospecto"
      client_type: "persona_moral" | "persona_fisica"
      document_source: "supabase" | "dropbox"
      project_status: "activo" | "pausado" | "completado" | "cancelado"
      service_area:
        | "contabilidad"
        | "legal"
        | "softlanding"
        | "pld_ft"
        | "juicios"
        | "gestoria"
        | "constitucion_nacional"
        | "cumplimiento"
        | "representacion"
      task_priority: "urgente" | "alta" | "media" | "baja"
      task_status:
        | "pendiente"
        | "en_progreso"
        | "en_revision"
        | "completada"
        | "cancelada"
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
  public: {
    Enums: {
      scheduled_mail_job_kind: ["send_draft"],
      scheduled_mail_job_status: ["pending", "processing", "sent", "failed", "cancelled"],
      app_role: ["transformador", "referente", "ejecutor", "en_formacion"],
      client_status: ["activo", "inactivo", "prospecto"],
      client_type: ["persona_moral", "persona_fisica"],
      document_source: ["supabase", "dropbox"],
      project_status: ["activo", "pausado", "completado", "cancelado"],
      service_area: [
        "contabilidad",
        "legal",
        "softlanding",
        "pld_ft",
        "juicios",
        "gestoria",
        "constitucion_nacional",
        "cumplimiento",
        "representacion",
      ],
      task_priority: ["urgente", "alta", "media", "baja"],
      task_status: [
        "pendiente",
        "en_progreso",
        "en_revision",
        "completada",
        "cancelada",
      ],
    },
  },
} as const
