import { DetailedCanvasSettings } from './types';

export const DEFAULT_SETTINGS: DetailedCanvasSettings = {
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  autoEnrichOnPaste: true,
  notesFolder: 'Canvas Notes',
  descriptionPrompt: 'Summarize this web page content in 2-3 sentences. Focus on the main topic and key points. Be concise and informative.',
  maxDescriptionLength: 500,
  showNotifications: true,
};

export const OLLAMA_GENERATE_ENDPOINT = '/api/generate';
export const OLLAMA_TAGS_ENDPOINT = '/api/tags';

export const REQUEST_TIMEOUT = 30000; // 30 seconds
export const AI_TIMEOUT = 60000; // 60 seconds for AI generation
