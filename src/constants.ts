import { DetailedCanvasSettings } from './types';

// Provider base URLs
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const CLAUDE_BASE_URL = 'https://api.anthropic.com/v1';

// Default models per provider
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
export const DEFAULT_GROQ_MODEL = 'llama-3.1-8b-instant';
export const DEFAULT_CLAUDE_MODEL = 'claude-3-haiku-20240307';

// Environment variable names
export const ENV_OPENAI_API_KEY = 'OPENAI_API_KEY';
export const ENV_OPENROUTER_API_KEY = 'OPENROUTER_API_KEY';
export const ENV_GROQ_API_KEY = 'GROQ_API_KEY';
export const ENV_ANTHROPIC_API_KEY = 'ANTHROPIC_API_KEY';

// Claude available models (hardcoded - no list-models API)
export const CLAUDE_MODELS = [
  'claude-3-haiku-20240307',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'claude-sonnet-4-20250514',
];

// Ollama endpoints
export const OLLAMA_GENERATE_ENDPOINT = '/api/generate';
export const OLLAMA_TAGS_ENDPOINT = '/api/tags';

// Timeouts
export const REQUEST_TIMEOUT = 30000; // 30 seconds
export const AI_TIMEOUT = 60000; // 60 seconds for AI generation

export const DEFAULT_SETTINGS: DetailedCanvasSettings = {
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  autoEnrichOnPaste: true,
  notesFolder: 'Canvas Notes',
  descriptionPrompt: 'Summarize this web page content in 2-3 sentences. Focus on the main topic and key points. Be concise and informative.',
  maxDescriptionLength: 500,
  showNotifications: true,
  aiProvider: 'ollama',
  openaiApiKey: '',
  openaiModel: DEFAULT_OPENAI_MODEL,
  openaiBaseUrl: '',
  openrouterApiKey: '',
  openrouterModel: DEFAULT_OPENROUTER_MODEL,
  groqApiKey: '',
  groqModel: DEFAULT_GROQ_MODEL,
  claudeApiKey: '',
  claudeModel: DEFAULT_CLAUDE_MODEL,
  useEnvVariables: false,
};
