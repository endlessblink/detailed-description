import { App, PluginSettingTab, Setting, Notice, Plugin, Modal } from 'obsidian';
import { DetailedCanvasSettings, AIProviderType } from './types';
import { DEFAULT_SETTINGS, CLAUDE_MODELS } from './constants';
import { createProvider } from './services/provider-factory';

interface DetailedCanvasPlugin extends Plugin {
  settings: DetailedCanvasSettings;
  saveSettings(): Promise<void>;
}

export class DetailedCanvasSettingTab extends PluginSettingTab {
  plugin: DetailedCanvasPlugin;

  constructor(app: App, plugin: DetailedCanvasPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // AI Provider selection
    new Setting(containerEl).setName('AI provider').setHeading();

    new Setting(containerEl)
      .setName('Provider')
      .setDesc('Choose your AI provider for generating descriptions')
      .addDropdown(dropdown => {
        dropdown
          .addOption('ollama', 'Ollama (local)')
          .addOption('openai', 'OpenAI')
          .addOption('claude', 'Claude (Anthropic)')
          .addOption('openrouter', 'OpenRouter')
          .addOption('groq', 'Groq')
          .setValue(this.plugin.settings.aiProvider)
          .onChange(async (value) => {
            this.plugin.settings.aiProvider = value as AIProviderType;
            await this.plugin.saveSettings();
            this.display(); // Re-render to show/hide provider fields
          });
      });

    // Provider-specific settings
    this.displayProviderSettings(containerEl);

    // Behavior section
    new Setting(containerEl).setName('Behavior').setHeading();

    new Setting(containerEl)
      .setName('Auto-enrich on paste')
      .setDesc('Automatically enrich link cards when added to canvas')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoEnrichOnPaste)
        .onChange(async (value) => {
          this.plugin.settings.autoEnrichOnPaste = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Notes folder')
      .setDesc('Folder where generated notes will be stored')
      .addText(text => text
        .setPlaceholder(DEFAULT_SETTINGS.notesFolder)
        .setValue(this.plugin.settings.notesFolder)
        .onChange(async (value) => {
          this.plugin.settings.notesFolder = value || DEFAULT_SETTINGS.notesFolder;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show notifications')
      .setDesc('Display progress notifications during enrichment')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showNotifications)
        .onChange(async (value) => {
          this.plugin.settings.showNotifications = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Max description length')
      .setDesc('Maximum number of characters for generated descriptions')
      .addText(text => text
        .setPlaceholder(DEFAULT_SETTINGS.maxDescriptionLength.toString())
        .setValue(this.plugin.settings.maxDescriptionLength.toString())
        .onChange(async (value) => {
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.maxDescriptionLength = numValue;
            await this.plugin.saveSettings();
          }
        }));

    // Advanced section
    new Setting(containerEl).setName('Advanced').setHeading();

    new Setting(containerEl)
      .setName('AI prompt')
      .setDesc('Instructions for the AI when generating descriptions. Use this to customize the style and content of generated summaries.')
      .addTextArea(text => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.descriptionPrompt)
          .setValue(this.plugin.settings.descriptionPrompt)
          .onChange(async (value) => {
            this.plugin.settings.descriptionPrompt = value || DEFAULT_SETTINGS.descriptionPrompt;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;
        return text;
      });

    // Environment variables toggle
    new Setting(containerEl)
      .setName('Use environment variables')
      .setDesc('Read API keys from environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY). Stored keys are used as fallback.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useEnvVariables)
        .onChange(async (value) => {
          this.plugin.settings.useEnvVariables = value;
          await this.plugin.saveSettings();
        }));

    // Reset to defaults
    new Setting(containerEl)
      .setName('Reset to defaults')
      .setDesc('Reset all settings to their default values')
      .addButton(button => button
        .setButtonText('Reset')
        .setWarning()
        .onClick(() => {
          new ConfirmResetModal(this.app, () => {
            Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
            void this.plugin.saveSettings().then(() => {
              this.display();
              new Notice('Settings reset to defaults');
            });
          }).open();
        }));
  }

  private displayProviderSettings(containerEl: HTMLElement): void {
    switch (this.plugin.settings.aiProvider) {
      case 'ollama':
        this.displayOllamaSettings(containerEl);
        break;
      case 'openai':
        this.displayOpenAISettings(containerEl);
        break;
      case 'claude':
        this.displayClaudeSettings(containerEl);
        break;
      case 'openrouter':
        this.displayOpenRouterSettings(containerEl);
        break;
      case 'groq':
        this.displayGroqSettings(containerEl);
        break;
    }
  }

  private displayOllamaSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Ollama endpoint')
      .setDesc('URL of your Ollama server (e.g., http://localhost:11434)')
      .addText(text => text
        .setPlaceholder(DEFAULT_SETTINGS.ollamaEndpoint)
        .setValue(this.plugin.settings.ollamaEndpoint)
        .onChange(async (value) => {
          this.plugin.settings.ollamaEndpoint = value || DEFAULT_SETTINGS.ollamaEndpoint;
          await this.plugin.saveSettings();
        }))
      .addButton(button => button
        .setButtonText('Test connection')
        .onClick(async () => {
          await this.testConnection();
        }));

    const modelSetting = new Setting(containerEl)
      .setName('Model')
      .setDesc('Ollama model for generating descriptions');

    modelSetting.addDropdown(async dropdown => {
      dropdown.addOption(
        this.plugin.settings.ollamaModel,
        this.plugin.settings.ollamaModel
      );

      try {
        const provider = createProvider(this.plugin.settings);
        const models = await provider.getModels();

        dropdown.selectEl.empty();

        if (models.length === 0) {
          dropdown.addOption('', 'No models available');
          dropdown.setDisabled(true);
        } else {
          for (const model of models) {
            dropdown.addOption(model, model);
          }
          dropdown.setValue(this.plugin.settings.ollamaModel);
        }
      } catch {
        dropdown.selectEl.empty();
        dropdown.addOption('', 'Failed to fetch models');
        dropdown.addOption(
          this.plugin.settings.ollamaModel,
          this.plugin.settings.ollamaModel
        );
        dropdown.setValue(this.plugin.settings.ollamaModel);
      }

      dropdown.onChange(async (value) => {
        this.plugin.settings.ollamaModel = value;
        await this.plugin.saveSettings();
      });
    });

    modelSetting.addButton(button => button
      .setButtonText('Refresh')
      .setTooltip('Refresh available models')
      .onClick(() => {
        this.display();
      }));
  }

  private displayOpenAISettings(containerEl: HTMLElement): void {
    this.addApiKeySetting(containerEl, 'OpenAI API key', 'openaiApiKey');

    this.addModelDropdown(containerEl, 'openaiModel', DEFAULT_SETTINGS.openaiModel);

    new Setting(containerEl)
      .setName('Custom base URL')
      .setDesc('Optional: override the API base URL (for Azure OpenAI or compatible APIs)')
      .addText(text => text
        .setPlaceholder('https://api.openai.com/v1')
        .setValue(this.plugin.settings.openaiBaseUrl)
        .onChange(async (value) => {
          this.plugin.settings.openaiBaseUrl = value;
          await this.plugin.saveSettings();
        }));

    this.addTestConnectionButton(containerEl);
  }

  private displayClaudeSettings(containerEl: HTMLElement): void {
    this.addApiKeySetting(containerEl, 'Anthropic API key', 'claudeApiKey');

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Claude model to use')
      .addDropdown(dropdown => {
        for (const model of CLAUDE_MODELS) {
          dropdown.addOption(model, model);
        }
        dropdown.setValue(this.plugin.settings.claudeModel);
        dropdown.onChange(async (value) => {
          this.plugin.settings.claudeModel = value;
          await this.plugin.saveSettings();
        });
      });

    this.addTestConnectionButton(containerEl);
  }

  private displayOpenRouterSettings(containerEl: HTMLElement): void {
    this.addApiKeySetting(containerEl, 'OpenRouter API key', 'openrouterApiKey');

    this.addModelDropdown(containerEl, 'openrouterModel', DEFAULT_SETTINGS.openrouterModel);

    this.addTestConnectionButton(containerEl);
  }

  private displayGroqSettings(containerEl: HTMLElement): void {
    this.addApiKeySetting(containerEl, 'Groq API key', 'groqApiKey');

    this.addModelDropdown(containerEl, 'groqModel', DEFAULT_SETTINGS.groqModel);

    this.addTestConnectionButton(containerEl);
  }

  private addModelDropdown(
    containerEl: HTMLElement,
    settingsKey: 'openaiModel' | 'openrouterModel' | 'groqModel' | 'ollamaModel',
    defaultModel: string
  ): void {
    const modelSetting = new Setting(containerEl)
      .setName('Model')
      .setDesc('Select a model or type a custom model name');

    modelSetting.addDropdown(async dropdown => {
      // Show current model first as fallback
      const currentModel = this.plugin.settings[settingsKey] || defaultModel;
      dropdown.addOption(currentModel, currentModel);

      // Try to fetch available models from the API
      try {
        const provider = createProvider(this.plugin.settings);
        const models = await provider.getModels();

        dropdown.selectEl.empty();

        if (models.length === 0) {
          dropdown.addOption(currentModel, currentModel);
        } else {
          for (const model of models) {
            dropdown.addOption(model, model);
          }
        }
        dropdown.setValue(currentModel);
      } catch {
        // Keep the current model on failure
        dropdown.selectEl.empty();
        dropdown.addOption(currentModel, currentModel);
        dropdown.setValue(currentModel);
      }

      dropdown.onChange(async (value) => {
        this.plugin.settings[settingsKey] = value;
        await this.plugin.saveSettings();
      });
    });

    modelSetting.addButton(button => button
      .setButtonText('Refresh')
      .setTooltip('Refresh available models')
      .onClick(() => {
        this.display();
      }));
  }

  private addApiKeySetting(
    containerEl: HTMLElement,
    name: string,
    settingsKey: 'openaiApiKey' | 'openrouterApiKey' | 'groqApiKey' | 'claudeApiKey'
  ): void {
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc('API keys are stored locally in your vault\'s plugin data. For additional security, enable environment variables in the advanced section.');

    setting.addText(text => {
      text.inputEl.type = 'password';
      text.inputEl.addClass('detailed-canvas-api-key-input');
      text
        .setPlaceholder('Enter API key...')
        .setValue(this.plugin.settings[settingsKey])
        .onChange(async (value) => {
          this.plugin.settings[settingsKey] = value;
          await this.plugin.saveSettings();
        });
    });

    // Toggle visibility button
    setting.addButton(button => {
      let visible = false;
      button
        .setIcon('eye')
        .setTooltip('Show/hide API key')
        .onClick(() => {
          visible = !visible;
          const inputEl = setting.controlEl.querySelector('input');
          if (inputEl) {
            inputEl.type = visible ? 'text' : 'password';
          }
          button.setIcon(visible ? 'eye-off' : 'eye');
        });
    });
  }

  private addTestConnectionButton(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .addButton(button => button
        .setButtonText('Test connection')
        .onClick(async () => {
          await this.testConnection();
        }));
  }

  private async testConnection(): Promise<void> {
    try {
      const provider = createProvider(this.plugin.settings);
      const isConnected = await provider.checkConnection();
      if (isConnected) {
        new Notice('Connection successful!');
      } else {
        new Notice('Connection failed. Check your settings and API key.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Connection error: ${message}`);
    }
  }
}

class ConfirmResetModal extends Modal {
  private onConfirm: () => void;

  constructor(app: App, onConfirm: () => void) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('p', {
      text: 'Are you sure you want to reset all settings to their default values? This cannot be undone.'
    });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText('Reset')
        .setWarning()
        .onClick(() => {
          this.onConfirm();
          this.close();
        }));
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
