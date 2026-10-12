export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ProviderProtocol =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export interface ModelConfigItem {
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ModelProviderConfig {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  apiKeyMasked?: string;
  hasApiKey?: boolean;
  enabled: boolean;
  models: ModelConfigItem[];
}

export type HostSecurityMode = "read_only" | "ask_confirmation" | "unrestricted";

export interface ConversationScope {
  kbIds: string[];
  hostIds: string[];
  hostSecurityModes: Record<string, HostSecurityMode>;
  webSearch: boolean;
  subagentEnabled: boolean;
}

export interface ConversationSummary {
  id: string;
  durableId: number;
  title: string;
  channel: "web" | "openai" | "qq";
  modelProvider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  scope: ConversationScope;
  created_at: string;
  updated_at: string;
}

export interface AvailableModelOption {
  provider: string;
  providerName: string;
  modelId: string;
  name: string;
  reasoning: boolean;
  supportedThinkingLevels: ThinkingLevel[];
}

export interface SettingsMap {
  openai_base_url: string;
  openai_api_key: string;
  external_api_token: string;
  embedding_model: string;
  llm_model: string;
  default_provider: string;
  default_thinking_level: ThinkingLevel;
  system_prompt: string;
  top_k: string;
  min_score: string;
  chunk_size: string;
  chunk_overlap: string;
  vault_sync_interval_minutes: string;
  host_dangerous_patterns: string;
  enable_web_search: string;
  web_search_provider: string;
  web_search_api_key: string;
  web_search_endpoint: string;
}
