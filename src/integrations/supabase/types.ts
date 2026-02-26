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
          phone: string | null
          primary_area: Database["public"]["Enums"]["service_area"] | null
          responsible_user_id: string | null
          rfc: string | null
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
          phone?: string | null
          primary_area?: Database["public"]["Enums"]["service_area"] | null
          responsible_user_id?: string | null
          rfc?: string | null
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
          phone?: string | null
          primary_area?: Database["public"]["Enums"]["service_area"] | null
          responsible_user_id?: string | null
          rfc?: string | null
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
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          area: Database["public"]["Enums"]["service_area"] | null
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          area?: Database["public"]["Enums"]["service_area"] | null
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: Database["public"]["Enums"]["service_area"] | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          organization_id?: string
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
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
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
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
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
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
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
          area: Database["public"]["Enums"]["service_area"] | null
          assigned_to: string | null
          checklist: Json | null
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          dropbox_links: Json | null
          due_date: string | null
          id: string
          is_recurring: boolean
          organization_id: string
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string | null
          recurrence_pattern: string | null
          status: Database["public"]["Enums"]["task_status"]
          tags: string[] | null
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          area?: Database["public"]["Enums"]["service_area"] | null
          assigned_to?: string | null
          checklist?: Json | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dropbox_links?: Json | null
          due_date?: string | null
          id?: string
          is_recurring?: boolean
          organization_id: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          recurrence_pattern?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          area?: Database["public"]["Enums"]["service_area"] | null
          assigned_to?: string | null
          checklist?: Json | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          dropbox_links?: Json | null
          due_date?: string | null
          id?: string
          is_recurring?: boolean
          organization_id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          recurrence_pattern?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          template_id?: string | null
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
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      get_user_org_id: { Args: { _user_id: string }; Returns: string }
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
    }
    Enums: {
      app_role: "admin" | "manager" | "staff" | "viewer"
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
      app_role: ["admin", "manager", "staff", "viewer"],
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
