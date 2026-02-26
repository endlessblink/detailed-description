import { requestUrl } from 'obsidian';
import { AIProvider, ClaudeMessageRequest, ClaudeMessageResponse } from '../types.js';
import { CLAUDE_BASE_URL, CLAUDE_MODELS } from '../constants.js';

export class ClaudeProvider implements AIProvider {
  constructor(
    private apiKey: string,
    private model: string
  ) {}

  async generate(prompt: string, context: string): Promise<string> {
    const fullPrompt = context
      ? `Context:\n${context}\n\n${prompt}`
      : prompt;

    const request: ClaudeMessageRequest = {
      model: this.model,
      max_tokens: 500,
      messages: [
        { role: 'user', content: fullPrompt }
      ],
    };

    const response = await requestUrl({
      url: `${CLAUDE_BASE_URL}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
      throw: false,
    });

    if (response.status !== 200) {
      throw new Error(`Claude API request failed with status ${response.status}: ${response.text}`);
    }

    const data = response.json as ClaudeMessageResponse;

    if (!data.content || data.content.length === 0) {
      throw new Error('Invalid response from Claude API: no content returned');
    }

    const textBlock = data.content.find(block => block.type === 'text');
    if (!textBlock) {
      throw new Error('Invalid response from Claude API: no text content');
    }

    return textBlock.text.trim();
  }

  async checkConnection(): Promise<boolean> {
    try {
      // Send a minimal request to verify the API key works
      const request: ClaudeMessageRequest = {
        model: this.model,
        max_tokens: 1,
        messages: [
          { role: 'user', content: 'Hi' }
        ],
      };

      const response = await requestUrl({
        url: `${CLAUDE_BASE_URL}/messages`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(request),
        throw: false,
      });

      return response.status === 200;
    } catch {
      return false;
    }
  }

  getModels(): Promise<string[]> {
    // Anthropic doesn't have a public list-models endpoint for simple API keys
    return Promise.resolve(CLAUDE_MODELS);
  }
}
