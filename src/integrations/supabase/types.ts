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
      agent_activity_logs: {
        Row: {
          action: string
          agent_id: string | null
          created_at: string | null
          details: Json | null
          id: string
          level: string | null
          message: string | null
          organization_id: string
          task_id: string | null
        }
        Insert: {
          action: string
          agent_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          level?: string | null
          message?: string | null
          organization_id: string
          task_id?: string | null
        }
        Update: {
          action?: string
          agent_id?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          level?: string | null
          message?: string | null
          organization_id?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_activity_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_activity_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_memories: {
        Row: {
          access_count: number | null
          agent_id: string | null
          category: string | null
          content: string
          created_at: string | null
          enabled: boolean | null
          expires_at: string | null
          id: string
          importance: number | null
          last_accessed_at: string | null
          memory_type: string
          organization_id: string
          source_description: string | null
          source_task_id: string | null
          updated_at: string | null
        }
        Insert: {
          access_count?: number | null
          agent_id?: string | null
          category?: string | null
          content: string
          created_at?: string | null
          enabled?: boolean | null
          expires_at?: string | null
          id?: string
          importance?: number | null
          last_accessed_at?: string | null
          memory_type: string
          organization_id: string
          source_description?: string | null
          source_task_id?: string | null
          updated_at?: string | null
        }
        Update: {
          access_count?: number | null
          agent_id?: string | null
          category?: string | null
          content?: string
          created_at?: string | null
          enabled?: boolean | null
          expires_at?: string | null
          id?: string
          importance?: number | null
          last_accessed_at?: string | null
          memory_type?: string
          organization_id?: string
          source_description?: string | null
          source_task_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_memories_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memories_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_registry: {
        Row: {
          capabilities: Json | null
          config: Json | null
          created_at: string | null
          description: string | null
          display_name: string
          id: string
          last_heartbeat: string | null
          last_task_at: string | null
          model: string | null
          name: string
          organization_id: string
          role: string
          status: string
          tasks_completed: number | null
          tasks_failed: number | null
          updated_at: string | null
        }
        Insert: {
          capabilities?: Json | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          display_name: string
          id?: string
          last_heartbeat?: string | null
          last_task_at?: string | null
          model?: string | null
          name: string
          organization_id: string
          role: string
          status?: string
          tasks_completed?: number | null
          tasks_failed?: number | null
          updated_at?: string | null
        }
        Update: {
          capabilities?: Json | null
          config?: Json | null
          created_at?: string | null
          description?: string | null
          display_name?: string
          id?: string
          last_heartbeat?: string | null
          last_task_at?: string | null
          model?: string | null
          name?: string
          organization_id?: string
          role?: string
          status?: string
          tasks_completed?: number | null
          tasks_failed?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      agent_scheduled_tasks: {
        Row: {
          agent_id: string | null
          created_at: string | null
          description: string | null
          id: string
          instructions: string | null
          is_active: boolean | null
          last_run_at: string | null
          next_run_at: string | null
          organization_id: string
          run_count: number | null
          schedule_config: Json
          schedule_type: string
          title: string
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          organization_id: string
          run_count?: number | null
          schedule_config: Json
          schedule_type: string
          title: string
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean | null
          last_run_at?: string | null
          next_run_at?: string | null
          organization_id?: string
          run_count?: number | null
          schedule_config?: Json
          schedule_type?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_scheduled_tasks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tasks: {
        Row: {
          agent_id: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          error_message: string | null
          execution_metadata: Json | null
          id: string
          input_context: Json | null
          instructions: string | null
          organization_id: string
          priority: string
          project_id: string | null
          result: Json | null
          result_summary: string | null
          source_task_id: string | null
          started_at: string | null
          status: string
          task_type: string
          title: string
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          error_message?: string | null
          execution_metadata?: Json | null
          id?: string
          input_context?: Json | null
          instructions?: string | null
          organization_id: string
          priority?: string
          project_id?: string | null
          result?: Json | null
          result_summary?: string | null
          source_task_id?: string | null
          started_at?: string | null
          status?: string
          task_type?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          error_message?: string | null
          execution_metadata?: Json | null
          id?: string
          input_context?: Json | null
          instructions?: string | null
          organization_id?: string
          priority?: string
          project_id?: string | null
          result?: Json | null
          result_summary?: string | null
          source_task_id?: string | null
          started_at?: string | null
          status?: string
          task_type?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_tasks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_artifacts: {
        Row: {
          ai_project_id: string | null
          content: string
          content_type: string
          conversation_id: string | null
          created_at: string
          external_file_id: string | null
          file_ext: string | null
          id: string
          mime_type: string | null
          office_kind: string | null
          organization_id: string
          output_formats: Json
          primary_format: string | null
          storage_bucket: string | null
          storage_path: string | null
          template_data: Json | null
          template_key: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_project_id?: string | null
          content: string
          content_type?: string
          conversation_id?: string | null
          created_at?: string
          external_file_id?: string | null
          file_ext?: string | null
          id?: string
          mime_type?: string | null
          office_kind?: string | null
          organization_id: string
          output_formats?: Json
          primary_format?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          template_data?: Json | null
          template_key?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_project_id?: string | null
          content?: string
          content_type?: string
          conversation_id?: string | null
          created_at?: string
          external_file_id?: string | null
          file_ext?: string | null
          id?: string
          mime_type?: string | null
          office_kind?: string | null
          organization_id?: string
          output_formats?: Json
          primary_format?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          template_data?: Json | null
          template_key?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_artifacts_ai_project_id_fkey"
            columns: ["ai_project_id"]
            isOneToOne: false
            referencedRelation: "ai_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_artifacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_module_briefings: {
        Row: {
          briefing_date: string
          content: string
          created_at: string
          id: string
          metadata: Json
          module: string
          organization_id: string
          payload_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          briefing_date: string
          content: string
          created_at?: string
          id?: string
          metadata?: Json
          module: string
          organization_id: string
          payload_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          briefing_date?: string
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          module?: string
          organization_id?: string
          payload_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_module_briefings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_feedback: {
        Row: {
          chat_message_id: string | null
          created_at: string
          feedback_category: string | null
          feedback_comment: string | null
          id: string
          organization_id: string
          rating: string
          user_id: string
        }
        Insert: {
          chat_message_id?: string | null
          created_at?: string
          feedback_category?: string | null
          feedback_comment?: string | null
          id?: string
          organization_id: string
          rating: string
          user_id: string
        }
        Update: {
          chat_message_id?: string | null
          created_at?: string
          feedback_category?: string | null
          feedback_comment?: string | null
          id?: string
          organization_id?: string
          rating?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_feedback_chat_message_id_fkey"
            columns: ["chat_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_project_documents: {
        Row: {
          ai_project_id: string
          created_at: string
          document_id: string | null
          dropbox_path: string | null
          id: string
          name: string
          source: string
        }
        Insert: {
          ai_project_id: string
          created_at?: string
          document_id?: string | null
          dropbox_path?: string | null
          id?: string
          name: string
          source?: string
        }
        Update: {
          ai_project_id?: string
          created_at?: string
          document_id?: string | null
          dropbox_path?: string | null
          id?: string
          name?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_project_documents_ai_project_id_fkey"
            columns: ["ai_project_id"]
            isOneToOne: false
            referencedRelation: "ai_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_project_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_project_members: {
        Row: {
          ai_project_id: string
          created_at: string
          id: string
          invited_by: string | null
          role: string
          user_id: string
        }
        Insert: {
          ai_project_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          user_id: string
        }
        Update: {
          ai_project_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_project_members_ai_project_id_fkey"
            columns: ["ai_project_id"]
            isOneToOne: false
            referencedRelation: "ai_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_project_memories: {
        Row: {
          ai_project_id: string | null
          content: string
          created_at: string
          id: string
          organization_id: string
          path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_project_id?: string | null
          content: string
          created_at?: string
          id?: string
          organization_id: string
          path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_project_id?: string | null
          content?: string
          created_at?: string
          id?: string
          organization_id?: string
          path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_project_memories_ai_project_id_fkey"
            columns: ["ai_project_id"]
            isOneToOne: false
            referencedRelation: "ai_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_project_memories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_project_shared_memories: {
        Row: {
          ai_project_id: string
          content: string
          created_at: string
          id: string
          organization_id: string
          path: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_project_id: string
          content: string
          created_at?: string
          id?: string
          organization_id: string
          path: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_project_id?: string
          content?: string
          created_at?: string
          id?: string
          organization_id?: string
          path?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_project_shared_memories_ai_project_id_fkey"
            columns: ["ai_project_id"]
            isOneToOne: false
            referencedRelation: "ai_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_project_shared_memories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_projects: {
        Row: {
          agent_context_mode: string
          agent_conversation_excerpt_max_messages: number
          agent_conversation_excerpt_mode: string
          agent_max_knowledge_bytes: number | null
          client_id: string | null
          created_at: string
          description: string | null
          id: string
          instructions: string | null
          is_archived: boolean
          name: string
          organization_id: string
          project_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_context_mode?: string
          agent_conversation_excerpt_max_messages?: number
          agent_conversation_excerpt_mode?: string
          agent_max_knowledge_bytes?: number | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          is_archived?: boolean
          name: string
          organization_id: string
          project_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_context_mode?: string
          agent_conversation_excerpt_max_messages?: number
          agent_conversation_excerpt_mode?: string
          agent_max_knowledge_bytes?: number | null
          client_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          is_archived?: boolean
          name?: string
          organization_id?: string
          project_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_user_memories: {
        Row: {
          content: string
          content_hash: string
          created_at: string
          enabled: boolean
          id: string
          memory_type: string
          organization_id: string
          source_conversation_id: string | null
          user_id: string
        }
        Insert: {
          content: string
          content_hash: string
          created_at?: string
          enabled?: boolean
          id?: string
          memory_type: string
          organization_id: string
          source_conversation_id?: string | null
          user_id: string
        }
        Update: {
          content?: string
          content_hash?: string
          created_at?: string
          enabled?: boolean
          id?: string
          memory_type?: string
          organization_id?: string
          source_conversation_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_user_memories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_user_memories_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
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
          agent_session: Json | null
          ai_project_id: string | null
          created_at: string
          folder: string | null
          id: string
          organization_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_session?: Json | null
          ai_project_id?: string | null
          created_at?: string
          folder?: string | null
          id?: string
          organization_id: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_session?: Json | null
          ai_project_id?: string | null
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
            foreignKeyName: "chat_conversations_ai_project_id_fkey"
            columns: ["ai_project_id"]
            isOneToOne: false
            referencedRelation: "ai_projects"
            referencedColumns: ["id"]
          },
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
          attachments: Json
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          attachments?: Json
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role?: string
        }
        Update: {
          attachments?: Json
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
      client_group_members: {
        Row: {
          client_id: string
          created_at: string | null
          group_id: string
          id: string
        }
        Insert: {
          client_id: string
          created_at?: string | null
          group_id: string
          id?: string
        }
        Update: {
          client_id?: string
          created_at?: string | null
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_group_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      client_groups: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          savio_customer_id: string | null
          savio_customer_linked_at: string | null
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
          savio_customer_id?: string | null
          savio_customer_linked_at?: string | null
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
          savio_customer_id?: string | null
          savio_customer_linked_at?: string | null
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
      document_chunks: {
        Row: {
          client_id: string | null
          content: string
          created_at: string
          document_id: string | null
          embedding: string | null
          id: string
          metadata: Json | null
          organization_id: string
          project_id: string | null
          source_id: string | null
          source_type: string
          token_count: number | null
        }
        Insert: {
          client_id?: string | null
          content: string
          created_at?: string
          document_id?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          project_id?: string | null
          source_id?: string | null
          source_type: string
          token_count?: number | null
        }
        Update: {
          client_id?: string | null
          content?: string
          created_at?: string
          document_id?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          project_id?: string | null
          source_id?: string | null
          source_type?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_chunks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
          archive_path: string | null
          client_id: string | null
          created_at: string
          document_type: string | null
          document_type_id: string | null
          external_id: string | null
          external_path: string | null
          file_path: string | null
          file_size: number | null
          id: string
          metadata: Json
          mime_type: string | null
          name: string
          organization_id: string
          parent_document_id: string | null
          project_id: string | null
          source: Database["public"]["Enums"]["document_source"]
          tags: string[] | null
          task_id: string | null
          updated_at: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          archive_path?: string | null
          client_id?: string | null
          created_at?: string
          document_type?: string | null
          document_type_id?: string | null
          external_id?: string | null
          external_path?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          name: string
          organization_id: string
          parent_document_id?: string | null
          project_id?: string | null
          source?: Database["public"]["Enums"]["document_source"]
          tags?: string[] | null
          task_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          archive_path?: string | null
          client_id?: string | null
          created_at?: string
          document_type?: string | null
          document_type_id?: string | null
          external_id?: string | null
          external_path?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          name?: string
          organization_id?: string
          parent_document_id?: string | null
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
            foreignKeyName: "documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
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
            foreignKeyName: "documents_parent_document_id_fkey"
            columns: ["parent_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
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
          {
            foreignKeyName: "documents_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_task_all_assignees"
            referencedColumns: ["task_id"]
          },
        ]
      }
      email_log: {
        Row: {
          additional_to_emails: string[]
          attachments: Json | null
          body_html: string | null
          body_text: string | null
          clicked_at: string | null
          conversation_id: string | null
          created_at: string
          direction: string | null
          error_message: string | null
          from_email: string | null
          from_name: string | null
          graph_message_id: string | null
          has_attachments: boolean | null
          headers: Json | null
          id: string
          in_reply_to: string | null
          is_read: boolean | null
          lead_id: string
          opened_at: string | null
          organization_id: string
          received_at: string | null
          scheduled_at: string | null
          sent_at: string | null
          sequence_step_id: string | null
          status: string
          subject: string
          template_id: string | null
          thread_id: string | null
          to_email: string
        }
        Insert: {
          additional_to_emails?: string[]
          attachments?: Json | null
          body_html?: string | null
          body_text?: string | null
          clicked_at?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          error_message?: string | null
          from_email?: string | null
          from_name?: string | null
          graph_message_id?: string | null
          has_attachments?: boolean | null
          headers?: Json | null
          id?: string
          in_reply_to?: string | null
          is_read?: boolean | null
          lead_id: string
          opened_at?: string | null
          organization_id: string
          received_at?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sequence_step_id?: string | null
          status?: string
          subject: string
          template_id?: string | null
          thread_id?: string | null
          to_email: string
        }
        Update: {
          additional_to_emails?: string[]
          attachments?: Json | null
          body_html?: string | null
          body_text?: string | null
          clicked_at?: string | null
          conversation_id?: string | null
          created_at?: string
          direction?: string | null
          error_message?: string | null
          from_email?: string | null
          from_name?: string | null
          graph_message_id?: string | null
          has_attachments?: boolean | null
          headers?: Json | null
          id?: string
          in_reply_to?: string | null
          is_read?: boolean | null
          lead_id?: string
          opened_at?: string | null
          organization_id?: string
          received_at?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sequence_step_id?: string | null
          status?: string
          subject?: string
          template_id?: string | null
          thread_id?: string | null
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_sequence_step_id_fkey"
            columns: ["sequence_step_id"]
            isOneToOne: false
            referencedRelation: "email_sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequence_steps: {
        Row: {
          condition: Json | null
          delay_hours: number
          id: string
          sequence_id: string
          step_order: number
          template_id: string
        }
        Insert: {
          condition?: Json | null
          delay_hours?: number
          id?: string
          sequence_id: string
          step_order: number
          template_id: string
        }
        Update: {
          condition?: Json | null
          delay_hours?: number
          id?: string
          sequence_id?: string
          step_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sequences: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          trigger_stage: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          trigger_stage?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          trigger_stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequences_trigger_stage_fkey"
            columns: ["trigger_stage"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sync_state: {
        Row: {
          created_at: string
          delta_link: string | null
          error_message: string | null
          id: string
          last_sync_at: string | null
          mailbox_email: string
          next_sync_at: string | null
          organization_id: string
          sync_status: string
          total_synced: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          delta_link?: string | null
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          mailbox_email?: string
          next_sync_at?: string | null
          organization_id: string
          sync_status?: string
          total_synced?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          delta_link?: string | null
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          mailbox_email?: string
          next_sync_at?: string | null
          organization_id?: string
          sync_status?: string
          total_synced?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sync_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          body_text: string | null
          category: string
          created_at: string
          created_by: string | null
          default_attachment_key: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          scope: string
          subject: string
          updated_at: string
          variables: Json
        }
        Insert: {
          body_html: string
          body_text?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          default_attachment_key?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          scope?: string
          subject: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          body_html?: string
          body_text?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          default_attachment_key?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          scope?: string
          subject?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_tracking_events: {
        Row: {
          created_at: string
          email_log_id: string
          event_type: string
          id: string
          lead_id: string
          metadata: Json
        }
        Insert: {
          created_at?: string
          email_log_id: string
          event_type: string
          id?: string
          lead_id: string
          metadata?: Json
        }
        Update: {
          created_at?: string
          email_log_id?: string
          event_type?: string
          id?: string
          lead_id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "email_tracking_events_email_log_id_fkey"
            columns: ["email_log_id"]
            isOneToOne: false
            referencedRelation: "email_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_tracking_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          attachments: Json
          category: string
          client_id: string | null
          created_at: string
          currency: string
          description: string
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
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      improvement_suggestions: {
        Row: {
          category: string
          chat_message_id: string
          conversation_id: string
          created_at: string
          id: string
          organization_id: string
          status: string
          suggestion_text: string
          summary: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          chat_message_id: string
          conversation_id: string
          created_at?: string
          id?: string
          organization_id: string
          status?: string
          suggestion_text: string
          summary?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          chat_message_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          status?: string
          suggestion_text?: string
          summary?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "improvement_suggestions_chat_message_id_fkey"
            columns: ["chat_message_id"]
            isOneToOne: true
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "improvement_suggestions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "improvement_suggestions_organization_id_fkey"
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
      knowledge_feed: {
        Row: {
          created_at: string | null
          detail: string | null
          feed_type: string
          id: string
          is_read: boolean
          organization_id: string
          related_client_id: string | null
          related_project_id: string | null
          summary: string | null
          title: string
        }
        Insert: {
          created_at?: string | null
          detail?: string | null
          feed_type: string
          id?: string
          is_read?: boolean
          organization_id: string
          related_client_id?: string | null
          related_project_id?: string | null
          summary?: string | null
          title: string
        }
        Update: {
          created_at?: string | null
          detail?: string | null
          feed_type?: string
          id?: string
          is_read?: boolean
          organization_id?: string
          related_client_id?: string | null
          related_project_id?: string | null
          summary?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_feed_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_feed_related_client_id_fkey"
            columns: ["related_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_feed_related_project_id_fkey"
            columns: ["related_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_insights: {
        Row: {
          area: string | null
          client_id: string | null
          content: string
          created_at: string | null
          id: string
          insight_type: string
          metadata: Json | null
          organization_id: string
          project_id: string | null
          source_chunks: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          area?: string | null
          client_id?: string | null
          content?: string
          created_at?: string | null
          id?: string
          insight_type: string
          metadata?: Json | null
          organization_id: string
          project_id?: string | null
          source_chunks?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          area?: string | null
          client_id?: string | null
          content?: string
          created_at?: string | null
          id?: string
          insight_type?: string
          metadata?: Json | null
          organization_id?: string
          project_id?: string | null
          source_chunks?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_insights_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_insights_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_insights_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_sync_logs: {
        Row: {
          agent: string
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          organization_id: string
          started_at: string
          stats: Json | null
          status: string
        }
        Insert: {
          agent: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          started_at?: string
          stats?: Json | null
          status?: string
        }
        Update: {
          agent?: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          started_at?: string
          stats?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sync_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_activities: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          metadata: Json | null
          organization_id: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          metadata?: Json | null
          organization_id: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          metadata?: Json | null
          organization_id?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          due_date: string
          id: string
          is_completed: boolean | null
          lead_id: string
          notes: string | null
          priority: string | null
          result: string | null
          task_type: string
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date: string
          id?: string
          is_completed?: boolean | null
          lead_id: string
          notes?: string | null
          priority?: string | null
          result?: string | null
          task_type?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string
          id?: string
          is_completed?: boolean | null
          lead_id?: string
          notes?: string | null
          priority?: string | null
          result?: string | null
          task_type?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          calendly_booked_at: string | null
          calendly_event_uri: string | null
          calendly_status: string | null
          campaign_name: string | null
          company_name: string | null
          country_code: string | null
          country_name: string | null
          country_origin: string | null
          created_at: string
          email: string | null
          entity_type: string | null
          estimated_budget: string | null
          estimated_value: number | null
          form_name: string | null
          full_name: string
          id: string
          industry: string | null
          is_active: boolean
          last_activity_at: string | null
          meta_created_at: string | null
          meta_lead_id: string | null
          needs_visa: boolean | null
          next_task_at: string | null
          notes: string | null
          organization_id: string
          owner_id: string | null
          phone: string | null
          preferred_contact: string | null
          preferred_time: string | null
          priority: string
          score: number
          softlanding_notes: string | null
          source: string
          stage_id: string
          tags: string[] | null
          updated_at: string
          urgency: string | null
          whatsapp: string | null
        }
        Insert: {
          calendly_booked_at?: string | null
          calendly_event_uri?: string | null
          calendly_status?: string | null
          campaign_name?: string | null
          company_name?: string | null
          country_code?: string | null
          country_name?: string | null
          country_origin?: string | null
          created_at?: string
          email?: string | null
          entity_type?: string | null
          estimated_budget?: string | null
          estimated_value?: number | null
          form_name?: string | null
          full_name: string
          id?: string
          industry?: string | null
          is_active?: boolean
          last_activity_at?: string | null
          meta_created_at?: string | null
          meta_lead_id?: string | null
          needs_visa?: boolean | null
          next_task_at?: string | null
          notes?: string | null
          organization_id: string
          owner_id?: string | null
          phone?: string | null
          preferred_contact?: string | null
          preferred_time?: string | null
          priority?: string
          score?: number
          softlanding_notes?: string | null
          source?: string
          stage_id: string
          tags?: string[] | null
          updated_at?: string
          urgency?: string | null
          whatsapp?: string | null
        }
        Update: {
          calendly_booked_at?: string | null
          calendly_event_uri?: string | null
          calendly_status?: string | null
          campaign_name?: string | null
          company_name?: string | null
          country_code?: string | null
          country_name?: string | null
          country_origin?: string | null
          created_at?: string
          email?: string | null
          entity_type?: string | null
          estimated_budget?: string | null
          estimated_value?: number | null
          form_name?: string | null
          full_name?: string
          id?: string
          industry?: string | null
          is_active?: boolean
          last_activity_at?: string | null
          meta_created_at?: string | null
          meta_lead_id?: string | null
          needs_visa?: boolean | null
          next_task_at?: string | null
          notes?: string | null
          organization_id?: string
          owner_id?: string | null
          phone?: string | null
          preferred_contact?: string | null
          preferred_time?: string | null
          priority?: string
          score?: number
          softlanding_notes?: string | null
          source?: string
          stage_id?: string
          tags?: string[] | null
          updated_at?: string
          urgency?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
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
      moffin_client_fiel: {
        Row: {
          cert_ciphertext: string
          cert_fingerprint_sha256: string | null
          client_id: string
          id: string
          key_ciphertext: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cert_ciphertext: string
          cert_fingerprint_sha256?: string | null
          client_id: string
          id?: string
          key_ciphertext: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cert_ciphertext?: string
          cert_fingerprint_sha256?: string | null
          client_id?: string
          id?: string
          key_ciphertext?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moffin_client_fiel_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moffin_client_fiel_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      moffin_client_sat_ciec: {
        Row: {
          ciec_ciphertext: string
          client_id: string
          id: string
          moffin_profile_id: number | null
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ciec_ciphertext: string
          client_id: string
          id?: string
          moffin_profile_id?: number | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ciec_ciphertext?: string
          client_id?: string
          id?: string
          moffin_profile_id?: number | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moffin_client_sat_ciec_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moffin_client_sat_ciec_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      moffin_consults: {
        Row: {
          client_id: string | null
          consult_type: string
          created_at: string
          document_id: string | null
          error_message: string | null
          id: string
          moffin_query_id: string | null
          moffin_service: string | null
          moffin_uuid: string | null
          organization_id: string
          project_id: string
          raw_response: Json
          requested_by: string | null
          rfc: string
          status: string
          summary: string | null
        }
        Insert: {
          client_id?: string | null
          consult_type: string
          created_at?: string
          document_id?: string | null
          error_message?: string | null
          id?: string
          moffin_query_id?: string | null
          moffin_service?: string | null
          moffin_uuid?: string | null
          organization_id: string
          project_id: string
          raw_response?: Json
          requested_by?: string | null
          rfc: string
          status: string
          summary?: string | null
        }
        Update: {
          client_id?: string | null
          consult_type?: string
          created_at?: string
          document_id?: string | null
          error_message?: string | null
          id?: string
          moffin_query_id?: string | null
          moffin_service?: string | null
          moffin_uuid?: string | null
          organization_id?: string
          project_id?: string
          raw_response?: Json
          requested_by?: string | null
          rfc?: string
          status?: string
          summary?: string | null
        }
        Relationships: [
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
      pipeline_automations: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          key: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          key: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          key?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          id: string
          is_terminal: boolean
          name: string
          organization_id: string
          position: number
          slug: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_terminal?: boolean
          name: string
          organization_id: string
          position?: number
          slug: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_terminal?: boolean
          name?: string
          organization_id?: string
          position?: number
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
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
          desktop_browser_notifications: boolean
          desktop_push_notifications: boolean
          dropbox_personal_folder: string | null
          email: string
          full_name: string
          id: string
          in_app_toast_notifications: boolean
          invitation_accepted: boolean
          is_active: boolean
          kawiiler_permissions: Json
          microsoft_email: string | null
          microsoft_user_id: string | null
          notification_sound_enabled: boolean
          notify_slack_all_channels: boolean
          notify_slack_channel_watch: boolean
          notify_slack_dm: boolean
          notify_slack_mentions: boolean
          notify_slack_vip: boolean
          onboarding_status: string
          organization_id: string
          outlook_signature_html: string | null
          phone: string | null
          proactive_ai_notifications: boolean
          reminders_hourly_digest: boolean
          slack_message_sound_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          area?: string | null
          avatar_url?: string | null
          created_at?: string
          desktop_browser_notifications?: boolean
          desktop_push_notifications?: boolean
          dropbox_personal_folder?: string | null
          email: string
          full_name: string
          id?: string
          in_app_toast_notifications?: boolean
          invitation_accepted?: boolean
          is_active?: boolean
          kawiiler_permissions?: Json
          microsoft_email?: string | null
          microsoft_user_id?: string | null
          notification_sound_enabled?: boolean
          notify_slack_all_channels?: boolean
          notify_slack_channel_watch?: boolean
          notify_slack_dm?: boolean
          notify_slack_mentions?: boolean
          notify_slack_vip?: boolean
          onboarding_status?: string
          organization_id: string
          outlook_signature_html?: string | null
          phone?: string | null
          proactive_ai_notifications?: boolean
          reminders_hourly_digest?: boolean
          slack_message_sound_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: string | null
          avatar_url?: string | null
          created_at?: string
          desktop_browser_notifications?: boolean
          desktop_push_notifications?: boolean
          dropbox_personal_folder?: string | null
          email?: string
          full_name?: string
          id?: string
          in_app_toast_notifications?: boolean
          invitation_accepted?: boolean
          is_active?: boolean
          kawiiler_permissions?: Json
          microsoft_email?: string | null
          microsoft_user_id?: string | null
          notification_sound_enabled?: boolean
          notify_slack_all_channels?: boolean
          notify_slack_channel_watch?: boolean
          notify_slack_dm?: boolean
          notify_slack_mentions?: boolean
          notify_slack_vip?: boolean
          onboarding_status?: string
          organization_id?: string
          outlook_signature_html?: string | null
          phone?: string | null
          proactive_ai_notifications?: boolean
          reminders_hourly_digest?: boolean
          slack_message_sound_enabled?: boolean
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
      project_templates: {
        Row: {
          area: string | null
          avg_duration_days: number | null
          client_type: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_ai_generated: boolean
          name: string
          organization_id: string
          phases: Json
          service_tags: string[] | null
          suggested_tasks: Json
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          area?: string | null
          avg_duration_days?: number | null
          client_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_ai_generated?: boolean
          name: string
          organization_id: string
          phases?: Json
          service_tags?: string[] | null
          suggested_tasks?: Json
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          area?: string | null
          avg_duration_days?: number | null
          client_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_ai_generated?: boolean
          name?: string
          organization_id?: string
          phases?: Json
          service_tags?: string[] | null
          suggested_tasks?: Json
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          phases: Json | null
          responsible_user_id: string | null
          service_tags: string[] | null
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
          phases?: Json | null
          responsible_user_id?: string | null
          service_tags?: string[] | null
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
          phases?: Json | null
          responsible_user_id?: string | null
          service_tags?: string[] | null
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
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
          repeat_kind: string
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
          repeat_kind?: string
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
          repeat_kind?: string
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
      scheduled_mail_jobs: {
        Row: {
          created_at: string
          draft_id: string
          error_message: string | null
          id: string
          kind: Database["public"]["Enums"]["scheduled_mail_job_kind"]
          payload: Json
          scheduled_at: string
          sent_at: string | null
          status: Database["public"]["Enums"]["scheduled_mail_job_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          error_message?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["scheduled_mail_job_kind"]
          payload?: Json
          scheduled_at: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["scheduled_mail_job_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          error_message?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["scheduled_mail_job_kind"]
          payload?: Json
          scheduled_at?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["scheduled_mail_job_status"]
          user_id?: string
        }
        Relationships: []
      }
      slack_channel_watches: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          user_id?: string
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
          channel_id: string
          created_at: string
          id: string
          is_starred: boolean
          is_vip: boolean
          notifications_muted: boolean
          organization_id: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          is_starred?: boolean
          is_vip?: boolean
          notifications_muted?: boolean
          organization_id: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          is_starred?: boolean
          is_vip?: boolean
          notifications_muted?: boolean
          organization_id?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
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
      slack_saved_messages: {
        Row: {
          author_name: string | null
          author_slack_user_id: string | null
          channel_id: string
          channel_name: string | null
          id: string
          message_ts: string
          organization_id: string
          saved_at: string
          snippet: string | null
          status: string
          thread_ts: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          author_name?: string | null
          author_slack_user_id?: string | null
          channel_id: string
          channel_name?: string | null
          id?: string
          message_ts: string
          organization_id: string
          saved_at?: string
          snippet?: string | null
          status?: string
          thread_ts?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          author_name?: string | null
          author_slack_user_id?: string | null
          channel_id?: string
          channel_name?: string | null
          id?: string
          message_ts?: string
          organization_id?: string
          saved_at?: string
          snippet?: string | null
          status?: string
          thread_ts?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_saved_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      slack_sidebar_group_channels: {
        Row: {
          channel_id: string
          group_id: string
          id: string
          sort_order: number
        }
        Insert: {
          channel_id: string
          group_id: string
          id?: string
          sort_order?: number
        }
        Update: {
          channel_id?: string
          group_id?: string
          id?: string
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
          created_at: string
          id: string
          organization_id: string
          sort_order: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          sort_order?: number
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
          user_id?: string
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
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_task_all_assignees"
            referencedColumns: ["task_id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          depends_on_task_id: string
          id: string
          kind: string
          organization_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          depends_on_task_id: string
          id?: string
          kind?: string
          organization_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          depends_on_task_id?: string
          id?: string
          kind?: string
          organization_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fkey"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      project_team: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_team_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_task_all_assignees"
            referencedColumns: ["task_id"]
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
          estimated_hours: number | null
          id: string
          is_recurring: boolean
          is_subtask: boolean
          organization_id: string
          parent_task_id: string | null
          phase_key: string | null
          priority: Database["public"]["Enums"]["task_priority"]
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
          estimated_hours?: number | null
          id?: string
          is_recurring?: boolean
          is_subtask?: boolean
          organization_id: string
          parent_task_id?: string | null
          phase_key?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
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
          estimated_hours?: number | null
          id?: string
          is_recurring?: boolean
          is_subtask?: boolean
          organization_id?: string
          parent_task_id?: string | null
          phase_key?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
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
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "v_task_all_assignees"
            referencedColumns: ["task_id"]
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
          {
            foreignKeyName: "tasks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "v_task_all_assignees"
            referencedColumns: ["task_id"]
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
      user_mail_directory: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          last_seen_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          last_seen_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          last_seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_module_permissions: {
        Row: {
          created_at: string | null
          enabled: boolean
          granted_by: string | null
          id: string
          module_key: string
          organization_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean
          granted_by?: string | null
          id?: string
          module_key: string
          organization_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          enabled?: boolean
          granted_by?: string | null
          id?: string
          module_key?: string
          organization_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_module_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      user_slack_connections: {
        Row: {
          access_token: string
          created_at: string
          id: string
          organization_id: string
          refresh_token: string | null
          scopes: string | null
          slack_team_id: string
          slack_user_id: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          id?: string
          organization_id: string
          refresh_token?: string | null
          scopes?: string | null
          slack_team_id: string
          slack_user_id: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          id?: string
          organization_id?: string
          refresh_token?: string | null
          scopes?: string | null
          slack_team_id?: string
          slack_user_id?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
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
    }
    Views: {
      v_task_all_assignees: {
        Row: {
          assignment_type: string | null
          organization_id: string | null
          task_id: string | null
          title: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ai_project_user_can_edit: {
        Args: { _ai_project_id: string; _user_id: string }
        Returns: boolean
      }
      ai_project_user_has_access: {
        Args: { _ai_project_id: string; _user_id: string }
        Returns: boolean
      }
      ai_project_user_is_creator: {
        Args: { _ai_project_id: string; _user_id: string }
        Returns: boolean
      }
      assign_lead: {
        Args: { p_lead_id: string; p_owner_id: string }
        Returns: Json
      }
      auto_move_stale_leads: {
        Args: { days_threshold?: number }
        Returns: number
      }
      bulk_assign_leads: {
        Args: { p_lead_ids: string[]; p_owner_id: string }
        Returns: Json
      }
      can_edit_org_permission_settings: {
        Args: { _user_id: string }
        Returns: boolean
      }
      can_view_savio_finance: { Args: { _user_id: string }; Returns: boolean }
      can_write_savio_finance: { Args: { _user_id: string }; Returns: boolean }
      cancel_sequence: {
        Args: { p_lead_id: string; p_sequence_id: string }
        Returns: Json
      }
      cancel_sequence_emails: {
        Args: { p_lead_id: string; p_sequence_id?: string }
        Returns: number
      }
      cancel_sequence_emails_system: {
        Args: {
          p_lead_id: string
          p_organization_id: string
          p_sequence_id?: string
        }
        Returns: number
      }
      celula_knowledge_stats: {
        Args: { p_org_id: string }
        Returns: {
          celula_color: string
          celula_id: string
          celula_name: string
          celula_slug: string
          chunk_count: number
          client_count: number
          doc_count: number
          last_chunk_at: string
          project_count: number
        }[]
      }
      client_knowledge_stats: {
        Args: { p_org_id: string }
        Returns: {
          area: string
          chunk_count: number
          client_id: string
          client_name: string
          doc_count: number
          last_chunk_at: string
        }[]
      }
      detect_duplicates: {
        Args: { p_email: string; p_phone: string }
        Returns: {
          calendly_booked_at: string | null
          calendly_event_uri: string | null
          calendly_status: string | null
          campaign_name: string | null
          company_name: string | null
          country_code: string | null
          country_name: string | null
          country_origin: string | null
          created_at: string
          email: string | null
          entity_type: string | null
          estimated_budget: string | null
          form_name: string | null
          full_name: string
          id: string
          industry: string | null
          is_active: boolean
          last_activity_at: string | null
          meta_created_at: string | null
          meta_lead_id: string | null
          needs_visa: boolean | null
          next_task_at: string | null
          notes: string | null
          organization_id: string
          owner_id: string | null
          phone: string | null
          preferred_contact: string | null
          preferred_time: string | null
          priority: string
          score: number
          softlanding_notes: string | null
          source: string
          stage_id: string
          tags: string[] | null
          updated_at: string
          urgency: string | null
          whatsapp: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      embedding_stats: {
        Args: { org_id: string }
        Returns: {
          chunk_count: number
          earliest: string
          latest: string
          source_type: string
        }[]
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
      get_activity_adoption_stats: { Args: never; Returns: Json }
      get_ai_learning_stats_for_org: { Args: never; Returns: Json }
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
      get_my_ai_projects: {
        Args: never
        Returns: {
          agent_context_mode: string
          agent_conversation_excerpt_max_messages: number
          agent_conversation_excerpt_mode: string
          agent_max_knowledge_bytes: number | null
          client_id: string | null
          created_at: string
          description: string | null
          id: string
          instructions: string | null
          is_archived: boolean
          name: string
          organization_id: string
          project_id: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ai_projects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_pipeline_stats: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      get_user_org_id: { Args: { _user_id: string }; Returns: string }
      has_finance_access: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      invoke_ai_proactive_notifications_cron: {
        Args: never
        Returns: undefined
      }
      invoke_moffin_refresh_pending_cron: { Args: never; Returns: undefined }
      invoke_notification_digest_cron: { Args: never; Returns: undefined }
      invoke_process_email_queue_cron: { Args: never; Returns: undefined }
      invoke_process_scheduled_mail_cron: { Args: never; Returns: undefined }
      invoke_reminder_hourly_digest_cron: { Args: never; Returns: undefined }
      invoke_sync_inbox_emails_cron: { Args: never; Returns: undefined }
      is_admin_or_manager: { Args: { _user_id: string }; Returns: boolean }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      learning_progress_stats: {
        Args: { p_org_id: string }
        Returns: {
          clients_with_chunks: number
          document_chunks_count: number
          last_sync_at: string
          project_chunks: number
          projects_with_chunks: number
          task_chunks: number
          total_active_clients: number
          total_active_projects: number
          total_chunks: number
          total_docs: number
          total_feed_items: number
          total_insights: number
        }[]
      }
      match_document_chunks: {
        Args: {
          filter_client_id?: string
          filter_org_id?: string
          filter_project_id?: string
          filter_source_types?: string[]
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          client_id: string
          content: string
          document_id: string
          id: string
          metadata: Json
          project_id: string
          similarity: number
          source_id: string
          source_type: string
        }[]
      }
      match_document_chunks_for_agent: {
        Args: {
          filter_document_ids: string[]
          filter_org_id: string
          filter_source_types?: string[]
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          client_id: string
          content: string
          document_id: string
          id: string
          metadata: Json
          project_id: string
          similarity: number
          source_id: string
          source_type: string
        }[]
      }
      move_lead_stage: {
        Args: { p_lead_id: string; p_new_stage_id: string }
        Returns: Json
      }
      pipeline_calendly_apply_system: {
        Args: {
          p_booked_at: string
          p_event_uri: string
          p_lead_id: string
          p_new_stage_id?: string
          p_organization_id: string
          p_status: string
        }
        Returns: Json
      }
      project_knowledge_stats: {
        Args: { p_org_id: string }
        Returns: {
          area: string
          chunk_count: number
          client_name: string
          doc_count: number
          last_chunk_at: string
          project_id: string
          project_name: string
        }[]
      }
      score_lead: {
        Args: { p_lead_id: string; p_reason?: string; p_score: number }
        Returns: Json
      }
      user_can_manage_pipeline: { Args: never; Returns: boolean }
      user_in_celula: {
        Args: { _celula_slug: string; _user_id: string }
        Returns: boolean
      }
      user_pipeline_org_id: { Args: never; Returns: string }
    }
    Enums: {
      app_role: "transformador" | "referente" | "ejecutor" | "en_formacion"
      client_status: "activo" | "inactivo" | "prospecto"
      client_type: "persona_moral" | "persona_fisica"
      document_source: "supabase" | "dropbox"
      project_status: "activo" | "pausado" | "completado" | "cancelado"
      scheduled_mail_job_kind: "send_draft"
      scheduled_mail_job_status:
        | "pending"
        | "processing"
        | "sent"
        | "failed"
        | "cancelled"
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
      app_role: ["transformador", "referente", "ejecutor", "en_formacion"],
      client_status: ["activo", "inactivo", "prospecto"],
      client_type: ["persona_moral", "persona_fisica"],
      document_source: ["supabase", "dropbox"],
      project_status: ["activo", "pausado", "completado", "cancelado"],
      scheduled_mail_job_kind: ["send_draft"],
      scheduled_mail_job_status: [
        "pending",
        "processing",
        "sent",
        "failed",
        "cancelled",
      ],
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
