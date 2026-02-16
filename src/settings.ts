import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { DetailedCanvasSettings } from './types';
import { DEFAULT_SETTINGS } from './constants';
import { OllamaClient } from './services/ollama';

/**
 * Type for the plugin interface used in settings
 */
interface DetailedCanvasPlugin {
  settings: DetailedCanvasSettings;
  saveSettings(): Promise<void>;
}

/**
 * Settings tab for the Detailed Canvas plugin
 * Provides UI for configuring Ollama connection, behavior, and AI prompts
 */
export class DetailedCanvasSettingTab extends PluginSettingTab {
  plugin: DetailedCanvasPlugin;

  constructor(app: App, plugin: DetailedCanvasPlugin) {
    super(app, plugin as any);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Ollama configuration section
    containerEl.createEl('h2', { text: 'Ollama configuration' });

    // Ollama endpoint with test connection button
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
          const client = new OllamaClient(
            this.plugin.settings.ollamaEndpoint,
            this.plugin.settings.ollamaModel
          );

          try {
            const isConnected = await client.checkConnection();
            if (isConnected) {
              new Notice('Successfully connected to Ollama!');
            } else {
              new Notice('Failed to connect to Ollama. Check your endpoint and ensure Ollama is running.');
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            new Notice(`Connection error: ${message}`);
          }
        }));

    // Model selection dropdown
    const modelSetting = new Setting(containerEl)
      .setName('Model')
      .setDesc('Ollama model for generating descriptions');

    modelSetting.addDropdown(async dropdown => {
      // Add current model first (in case we can't fetch the list)
      dropdown.addOption(
        this.plugin.settings.ollamaModel,
        this.plugin.settings.ollamaModel
      );

      // Try to fetch available models
      const client = new OllamaClient(
        this.plugin.settings.ollamaEndpoint,
        this.plugin.settings.ollamaModel
      );

      try {
        const models = await client.getModels();

        // Clear and repopulate with fetched models
        dropdown.selectEl.empty();

        if (models.length === 0) {
          dropdown.addOption('', 'No models available');
          dropdown.setDisabled(true);
        } else {
          models.forEach(model => {
            dropdown.addOption(model, model);
          });
          dropdown.setValue(this.plugin.settings.ollamaModel);
        }
      } catch (error) {
        // If we can't fetch models, show error in dropdown
        dropdown.selectEl.empty();
        dropdown.addOption('', 'Failed to fetch models');
        dropdown.addOption(
          this.plugin.settings.ollamaModel,
          this.plugin.settings.ollamaModel
        );
        dropdown.setValue(this.plugin.settings.ollamaModel);

        console.error('Failed to fetch Ollama models:', error);
      }

      dropdown.onChange(async (value) => {
        this.plugin.settings.ollamaModel = value;
        await this.plugin.saveSettings();
      });
    });

    // Add refresh button for models
    modelSetting.addButton(button => button
      .setButtonText('Refresh')
      .setTooltip('Refresh available models')
      .onClick(() => {
        this.display(); // Reload the settings tab
      }));

    // Behavior section
    containerEl.createEl('h2', { text: 'Behavior' });

    // Auto-enrich toggle
    new Setting(containerEl)
      .setName('Auto-enrich on paste')
      .setDesc('Automatically enrich link cards when added to canvas')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoEnrichOnPaste)
        .onChange(async (value) => {
          this.plugin.settings.autoEnrichOnPaste = value;
          await this.plugin.saveSettings();
        }));

    // Notes folder
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

    // Show notifications toggle
    new Setting(containerEl)
      .setName('Show notifications')
      .setDesc('Display progress notifications during enrichment')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showNotifications)
        .onChange(async (value) => {
          this.plugin.settings.showNotifications = value;
          await this.plugin.saveSettings();
        }));

    // Max description length
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
    containerEl.createEl('h2', { text: 'Advanced' });

    // System prompt textarea
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

        // Make the textarea larger for better editing
        text.inputEl.rows = 6;
        text.inputEl.cols = 50;

        return text;
      });

    // Reset to defaults button
    new Setting(containerEl)
      .setName('Reset to defaults')
      .setDesc('Reset all settings to their default values')
      .addButton(button => button
        .setButtonText('Reset')
        .setWarning()
        .onClick(async () => {
          // Confirm before resetting
          const confirmed = confirm(
            'Are you sure you want to reset all settings to their default values? This cannot be undone.'
          );

          if (confirmed) {
            // Reset all settings
            Object.assign(this.plugin.settings, DEFAULT_SETTINGS);
            await this.plugin.saveSettings();

            // Reload the settings tab to show new values
            this.display();

            new Notice('Settings reset to defaults');
          }
        }));
  }
}
