import { requestUrl } from 'obsidian';
import { OllamaGenerateRequest, OllamaGenerateResponse } from '../types';
import { OLLAMA_GENERATE_ENDPOINT, OLLAMA_TAGS_ENDPOINT } from '../constants';

/**
 * Response type for Ollama tags endpoint
 */
interface OllamaTagsResponse {
  models: Array<{
    name: string;
    modified_at: string;
    size: number;
    digest: string;
  }>;
}

/**
 * Client for interacting with Ollama API
 */
export class OllamaClient {
  constructor(
    private endpoint: string,
    private model: string
  ) {}

  /**
   * Generate text using Ollama's /api/generate endpoint
   * @param prompt The prompt to send to the model
   * @param context Additional context for the generation
   * @returns The generated text response
   * @throws Error if the request fails or times out
   */
  async generate(prompt: string, context: string): Promise<string> {
    try {
      const fullPrompt = context
        ? `Context:\n${context}\n\n${prompt}`
        : prompt;

      const request: OllamaGenerateRequest = {
        model: this.model,
        prompt: fullPrompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 500,
        },
      };

      const response = await requestUrl({
        url: `${this.endpoint}${OLLAMA_GENERATE_ENDPOINT}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        throw: false,
      });

      if (response.status !== 200) {
        throw new Error(
          `Ollama API request failed with status ${response.status}: ${response.text}`
        );
      }

      const data = response.json as OllamaGenerateResponse;

      if (!data.response) {
        throw new Error('Invalid response from Ollama API: missing response field');
      }

      return data.response.trim();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to generate text: ${error.message}`);
      }
      throw new Error('Failed to generate text: Unknown error');
    }
  }

  /**
   * Check if Ollama is running and accessible
   * @returns true if connection is successful, false otherwise
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await requestUrl({
        url: `${this.endpoint}${OLLAMA_TAGS_ENDPOINT}`,
        method: 'GET',
        throw: false,
      });

      return response.status === 200;
    } catch (error) {
      console.error('Failed to check Ollama connection:', error);
      return false;
    }
  }

  /**
   * Get list of available models from Ollama
   * @returns Array of model names
   * @throws Error if the request fails
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await requestUrl({
        url: `${this.endpoint}${OLLAMA_TAGS_ENDPOINT}`,
        method: 'GET',
        throw: false,
      });

      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch models: status ${response.status}`
        );
      }

      const data = response.json as OllamaTagsResponse;

      if (!data.models || !Array.isArray(data.models)) {
        throw new Error('Invalid response from Ollama API: missing models field');
      }

      return data.models.map(model => model.name);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch models: ${error.message}`);
      }
      throw new Error('Failed to fetch models: Unknown error');
    }
  }

  /**
   * Update the endpoint URL
   * @param endpoint New endpoint URL
   */
  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
  }

  /**
   * Update the model name
   * @param model New model name
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Get current endpoint
   */
  getEndpoint(): string {
    return this.endpoint;
  }

  /**
   * Get current model
   */
  getModel(): string {
    return this.model;
  }
}
