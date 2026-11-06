export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface KeyValueItem {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export type RequestBodyType = 'none' | 'json' | 'text' | 'urlencoded' | 'graphql';

export interface RequestBodyConfig {
  body_type: RequestBodyType;
  raw?: string;
  url_encoded?: KeyValueItem[];
  graphql_query?: string;
  graphql_variables?: string;
}

export type AuthType = 'none' | 'inherit' | 'bearer' | 'basic' | 'apikey' | 'custom';
export type ApiKeyLocation = 'header' | 'query';

export interface AuthConfig {
  auth_type: AuthType;
  bearer_token?: string;
  basic_username?: string;
  basic_password?: string;
  api_key_name?: string;
  api_key_value?: string;
  api_key_in?: ApiKeyLocation;
  custom_header_name?: string;
  custom_header_value?: string;
}

export interface RequestScripts {
  pre_request: string;
  post_response: string;
}

export interface ScriptLogEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'pass' | 'fail';
  stage: 'pre-request' | 'post-response';
  message: string;
}

export interface RequestItem {
  id: string;
  name: string;
  description?: string;
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  path_variables?: KeyValueItem[];
  headers: KeyValueItem[];
  auth?: AuthConfig;
  body: RequestBodyConfig;
  scripts?: RequestScripts;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: string;
  name: string;
  description?: string;
  folders: Folder[];
  requests: RequestItem[];
  auth?: AuthConfig;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  variables: KeyValueItem[];
  auth?: AuthConfig;
  folders: Folder[];
  requests: RequestItem[];
  created_at: string;
  updated_at: string;
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
  secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
  created_at: string;
  updated_at: string;
}

export interface HttpResponse {
  status: number;
  status_text: string;
  headers: [string, string][];
  body: string;
  duration_ms: number;
  size_bytes: number;
  error?: string;
}

export interface ImportWarning {
  item_name: string;
  warning_type: string;
  message: string;
}

export interface ImportResult {
  collection: Collection;
  warnings: ImportWarning[];
}

export interface TabItem {
  id: string;
  request: RequestItem;
  collection_id?: string;
  is_dirty: boolean;
  response?: HttpResponse;
  loading?: boolean;
  script_logs?: ScriptLogEntry[];
}

export interface AppPreferences {
  active_environment_id?: string;
  active_tab_id?: string;
  open_tabs: string[];
  theme: string;
}
