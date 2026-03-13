// Plugin Settings
export interface DetailedCanvasSettings {
  ollamaEndpoint: string;
  ollamaModel: string;
  autoEnrichOnPaste: boolean;
  notesFolder: string;
  descriptionPrompt: string;
  maxDescriptionLength: number;
  showNotifications: boolean;
  aiProvider: AIProviderType;
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
  openrouterApiKey: string;
  openrouterModel: string;
  groqApiKey: string;
  groqModel: string;
  claudeApiKey: string;
  claudeModel: string;
  useEnvVariables: boolean;
  organizePrompt: string;
  maxCategories: number;
  colorGroupsByImportance: boolean;
}

export type AIProviderType = 'ollama' | 'openai' | 'openrouter' | 'groq' | 'claude';

export interface AIGenerateOptions {
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface AIProvider {
  generate(prompt: string, context: string, options?: AIGenerateOptions): Promise<string>;
  checkConnection(): Promise<boolean>;
  getModels(): Promise<string[]>;
}

// URL Metadata from scraping
export interface UrlMetadata {
  url: string;
  title: string | null;
  description: string | null;
  ogImage: string | null;
  siteName: string | null;
  favicon: string | null;
  textContent: string;
}

// Ollama API types
export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: false;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface OpenAIChatResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
}

export interface ClaudeMessageRequest {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

export interface ClaudeMessageResponse {
  id: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  stop_reason: string;
}

// Canvas node types
export interface CanvasNodeData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export interface CanvasLinkData extends CanvasNodeData {
  type: "link";
  url: string;
}

export interface CanvasTextData extends CanvasNodeData {
  type: "text";
  text: string;
}

export interface CanvasFileData extends CanvasNodeData {
  type: 'file';
  file: string;
  subpath?: string;
}

export interface CanvasGroupData extends CanvasNodeData {
  type: 'group';
  label?: string;
  background?: string;
  backgroundStyle?: 'cover' | 'ratio' | 'repeat';
}

export type AllCanvasNodeData = CanvasLinkData | CanvasTextData | CanvasFileData | CanvasGroupData;
export type CanvasNode = AllCanvasNodeData;

export interface CanvasEdgeData {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toSide?: "top" | "right" | "bottom" | "left";
  color?: string;
  label?: string;
}

export interface CanvasData {
  nodes: AllCanvasNodeData[];
  edges: CanvasEdgeData[];
}

// LLM classification types for canvas organization
export interface LLMMember {
  node_id: string;
  importance_score: number;
}

export interface LLMCategory {
  id: string;
  label: string;
  group_color: string;
  importance_score: number;
  members: LLMMember[];
}

export interface LLMClassificationResponse {
  categories: LLMCategory[];
}

// Enrichment result
export interface EnrichmentResult {
  success: boolean;
  notePath?: string;
  error?: string;
}

// Internal canvas types (not in official Obsidian API)
export interface CanvasNodeInstance {
  getData?(): Record<string, unknown> | undefined;
}
