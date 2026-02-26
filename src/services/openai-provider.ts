import { requestUrl } from 'obsidian';
import { AIProvider, OpenAIChatRequest, OpenAIChatResponse } from '../types.js';

export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl: string,
    private extraHeaders: Record<string, string> = {}
  ) {}

  async generate(prompt: string, context: string): Promise<string> {
    const fullPrompt = context
      ? `Context:\n${context}\n\n${prompt}`
      : prompt;

    const request: OpenAIChatRequest = {
      model: this.model,
      messages: [
        { role: 'user', content: fullPrompt }
      ],
      max_tokens: 500,
      temperature: 0.7,
    };

    const response = await requestUrl({
      url: `${this.baseUrl}/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(request),
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(`API request failed with status ${response.status}: ${response.text}`);
    }

    const data = response.json as OpenAIChatResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error('Invalid response: no choices returned');
    }

    return data.choices[0].message.content.trim();
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await requestUrl({
        url: `${this.baseUrl}/models`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        throw: false,
      });

      return response.status === 200;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await requestUrl({
        url: `${this.baseUrl}/models`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        throw: false,
      });

      if (response.status !== 200) {
        return [this.model];
      }

      const data = response.json as { data: Array<{ id: string }> };

      if (!data.data || !Array.isArray(data.data)) {
        return [this.model];
      }

      return data.data.map(m => m.id);
    } catch {
      return [this.model];
    }
  }
}
