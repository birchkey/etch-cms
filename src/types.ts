export interface Env {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_HASH: string;
  JWT_SECRET: string;
  __STATIC_CONTENT: KVNamespace;
  PUBLIC_API_KEY?: string; // optional — if set, all /api/public/* requests require Authorization: Bearer <key>
}

// DB row types
export interface ContentTypeRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  preview_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface FieldRow {
  id: string;
  content_type_id: string;
  name: string;
  slug: string;
  type: FieldType;
  required: number; // 0 or 1
  sort_order: number;
  relation_content_type_id: string | null;
  relation_cardinality: 'one' | 'many' | null;
  multiple: number; // 0 or 1, for image and select fields
  rich_text_extensions: string | null; // JSON array of enabled extensions, null = all
  select_options: string | null; // JSON array of option strings
  min_length: number | null;
  max_length: number | null;
  min_value: number | null;
  max_value: number | null;
  pattern: string | null;
  phone_format: 'us' | 'international' | null;
  repeater_subfields: string | null; // JSON array of RepeaterSubfield definitions
  created_at: number;
}

export type FieldType = 'text' | 'rich_text' | 'image' | 'number' | 'datetime' | 'boolean' | 'relation' | 'select' | 'email' | 'phone' | 'color' | 'repeater';

export interface EntryRow {
  id: string;
  content_type_id: string;
  slug: string | null;
  status: 'draft' | 'published' | 'scheduled';
  has_unpublished_changes: number; // 0 or 1
  sort_order: number;
  created_at: number;
  updated_at: number;
  published_at: number | null;
  scheduled_at: number | null;
  protection_type: 'password' | 'jwt' | null;
  protection_password: string | null;
}

export interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  enabled: number; // 0 or 1
  created_at: number;
  updated_at: number;
}

export interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  status_code: number | null;
  success: number; // 0 or 1
  error: string | null;
  duration_ms: number;
  created_at: number;
}

export interface EntryFieldRow {
  entry_id: string;
  field_id: string;
  value: string | null;
}

export interface AssetRow {
  id: string;
  filename: string;
  original_name: string;
  content_type: string;
  size: number;
  r2_key: string;
  alt_text: string | null;
  created_at: number;
}

export interface UserRow {
  id: string;
  username: string;
  name: string;
  password_hash: string;
  role: 'editor';
  created_at: number;
  updated_at: number;
}

// JWT payload
export interface JWTPayload {
  sub: string;
  role: 'admin' | 'editor';
  name?: string;
  iat: number;
  exp: number;
}
