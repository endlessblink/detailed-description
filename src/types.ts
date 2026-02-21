// Plugin Settings
export interface DetailedCanvasSettings {
  ollamaEndpoint: string;
  ollamaModel: string;
  autoEnrichOnPaste: boolean;
  notesFolder: string;
  descriptionPrompt: string;
  maxDescriptionLength: number;
  showNotifications: boolean;
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

export interface CanvasFileData extends CanvasNodeData {
  type: "file";
  file: string;
  subpath?: string;
}

export interface CanvasTextData extends CanvasNodeData {
  type: "text";
  text: string;
}

export type CanvasNode = CanvasLinkData | CanvasFileData | CanvasTextData;

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
  nodes: CanvasNode[];
  edges: CanvasEdgeData[];
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
