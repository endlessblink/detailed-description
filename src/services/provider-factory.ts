import { AIProvider, DetailedCanvasSettings } from '../types.js';
import { OllamaClient } from './ollama.js';
import { OpenAICompatibleProvider } from './openai-provider.js';
import { ClaudeProvider } from './claude-provider.js';
import {
  OPENAI_BASE_URL,
  OPENROUTER_BASE_URL,
  GROQ_BASE_URL,
  ENV_OPENAI_API_KEY,
  ENV_OPENROUTER_API_KEY,
  ENV_GROQ_API_KEY,
  ENV_ANTHROPIC_API_KEY,
} from '../constants.js';

function getApiKey(storedKey: string, envVarName: string, useEnv: boolean): string {
  if (useEnv && typeof process !== 'undefined' && process.env) {
    const envKey = process.env[envVarName];
    if (envKey) return envKey;
  }
  return storedKey;
}

export function createProvider(settings: DetailedCanvasSettings): AIProvider {
  switch (settings.aiProvider) {
    case 'openai': {
      const apiKey = getApiKey(settings.openaiApiKey, ENV_OPENAI_API_KEY, settings.useEnvVariables);
      const baseUrl = settings.openaiBaseUrl || OPENAI_BASE_URL;
      return new OpenAICompatibleProvider(apiKey, settings.openaiModel, baseUrl);
    }

    case 'openrouter': {
      const apiKey = getApiKey(settings.openrouterApiKey, ENV_OPENROUTER_API_KEY, settings.useEnvVariables);
      return new OpenAICompatibleProvider(apiKey, settings.openrouterModel, OPENROUTER_BASE_URL, {
        'HTTP-Referer': 'https://obsidian.md',
      });
    }

    case 'groq': {
      const apiKey = getApiKey(settings.groqApiKey, ENV_GROQ_API_KEY, settings.useEnvVariables);
      return new OpenAICompatibleProvider(apiKey, settings.groqModel, GROQ_BASE_URL);
    }

    case 'claude': {
      const apiKey = getApiKey(settings.claudeApiKey, ENV_ANTHROPIC_API_KEY, settings.useEnvVariables);
      return new ClaudeProvider(apiKey, settings.claudeModel);
    }

    case 'ollama':
    default:
      return new OllamaClient(settings.ollamaEndpoint, settings.ollamaModel);
  }
}
