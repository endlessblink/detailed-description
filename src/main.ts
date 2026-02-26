import { Plugin, TFile, Notice, Menu, ItemView } from 'obsidian';
import { DetailedCanvasSettings, AIProvider, CanvasLinkData, EnrichmentResult, CanvasNodeInstance } from './types';
import { DEFAULT_SETTINGS } from './constants';
import { DetailedCanvasSettingTab } from './settings';
import { createProvider } from './services/provider-factory';
import { ScraperService } from './services/scraper';
import { CanvasMonitor } from './canvas/monitor';
import { isValidUrl } from './canvas/utils';

// Module augmentation for internal canvas events
declare module 'obsidian' {
  interface Workspace {
    on(name: 'canvas:node-menu', callback: (menu: Menu, node: CanvasNodeInstance) => void): EventRef;
  }
}

export default class DetailedCanvasPlugin extends Plugin {
  settings!: DetailedCanvasSettings;

  private aiProvider!: AIProvider;
  private scraperService!: ScraperService;
  private canvasMonitor!: CanvasMonitor;
  private processingNodes: Set<string> = new Set(); // Prevent duplicate processing

  async onload() {
    console.log('[DetailedCanvas] Plugin loading, version:', this.manifest.version);
    await this.loadSettings();
    console.log('[DetailedCanvas] Provider:', this.settings.aiProvider, '| Auto-enrich:', this.settings.autoEnrichOnPaste);

    // Initialize services
    this.aiProvider = createProvider(this.settings);
    this.scraperService = new ScraperService();

    // Initialize canvas monitor
    this.canvasMonitor = new CanvasMonitor(
      this.app,
      (file, node) => { void this.handleNewLinkNode(file, node); }
    );

    // Start watching if auto-enrich is enabled
    if (this.settings.autoEnrichOnPaste) {
      this.canvasMonitor.startWatching();
    }

    // Register commands
    this.addCommand({
      id: 'enrich-selected-link',
      name: 'Enrich selected link card',
      checkCallback: (checking: boolean) => {
        const canvasView = this.getActiveCanvasView();
        if (!canvasView) return false;

        const selection = this.getSelectedLinkNodes(canvasView);
        if (selection.length === 0) return false;

        if (!checking) {
          void this.enrichSelectedLinks(canvasView);
        }
        return true;
      }
    });

    this.addCommand({
      id: 'enrich-all-links',
      name: 'Enrich all link cards in canvas',
      checkCallback: (checking: boolean) => {
        const canvasFile = this.getActiveCanvasFile();
        if (!canvasFile) return false;

        if (!checking) {
          void this.enrichAllLinksInCanvas(canvasFile);
        }
        return true;
      }
    });

    // Register context menu for canvas nodes
    // Note: 'canvas:node-menu' is not in the official Obsidian API types, but works in practice
    this.registerEvent(
      this.app.workspace.on('canvas:node-menu', (menu: Menu, node: CanvasNodeInstance) => {
        const nodeData = node.getData?.();
        const isLinkNode = nodeData && nodeData.type === 'link' && typeof nodeData.url === 'string' && isValidUrl(nodeData.url);
        const isTextNodeWithUrl = nodeData && nodeData.type === 'text' && 'text' in nodeData && typeof (nodeData as unknown as { text: string }).text === 'string' && isValidUrl((nodeData as unknown as { text: string }).text.trim());
        if (isLinkNode || isTextNodeWithUrl) {
          menu.addItem((item) => {
            item
              .setTitle('Enrich with AI description')
              .setIcon('sparkles')
              .onClick(() => {
                const canvasFile = this.getActiveCanvasFile();
                if (canvasFile) {
                  let linkData: CanvasLinkData;
                  if (nodeData.type === 'link') {
                    linkData = nodeData as unknown as CanvasLinkData;
                  } else {
                    const textData = nodeData as unknown as { id: string; text: string; x: number; y: number; width: number; height: number };
                    linkData = {
                      id: textData.id, type: 'link', url: textData.text.trim(),
                      x: textData.x, y: textData.y, width: textData.width, height: textData.height,
                    } as CanvasLinkData;
                  }
                  void this.enrichLinkNode(canvasFile, linkData);
                }
              });
          });
        }
      })
    );

    // Add settings tab
    this.addSettingTab(new DetailedCanvasSettingTab(this.app, this));
  }

  onunload() {
    this.canvasMonitor?.stopWatching();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);

    // Update services with new settings
    this.aiProvider = createProvider(this.settings);

    // Toggle canvas monitoring based on settings
    if (this.settings.autoEnrichOnPaste) {
      this.canvasMonitor?.startWatching();
    } else {
      this.canvasMonitor?.stopWatching();
    }
  }

  // Handle new link node from canvas monitor
  private async handleNewLinkNode(file: TFile, node: CanvasLinkData) {
    if (!this.settings.autoEnrichOnPaste) return;
    if (!isValidUrl(node.url)) return;

    await this.enrichLinkNode(file, node);
  }

  // Main enrichment logic
  async enrichLinkNode(canvasFile: TFile, node: CanvasLinkData): Promise<EnrichmentResult> {
    const nodeKey = `${canvasFile.path}:${node.id}`;

    // Prevent duplicate processing
    if (this.processingNodes.has(nodeKey)) {
      return { success: false, error: 'Already processing' };
    }

    this.processingNodes.add(nodeKey);

    try {
      if (this.settings.showNotifications) {
        new Notice(`Enriching: ${node.url}`);
      }

      // Step 1: Scrape the URL
      const metadata = await this.scraperService.scrape(node.url);
      if (!metadata) {
        throw new Error('Failed to fetch URL content');
      }

      // Step 2: Generate AI description
      let aiDescription = '';
      try {
        aiDescription = await this.aiProvider.generate(
          this.settings.descriptionPrompt,
          metadata.textContent
        );
      } catch (err) {
        console.warn('AI generation failed, using metadata description:', err);
        aiDescription = metadata.description || 'No description available.';
      }

      // Step 3: Build enriched card text
      const title = metadata.title || new URL(node.url).hostname;
      const desc = aiDescription.substring(0, this.settings.maxDescriptionLength);
      const siteName = metadata.siteName || new URL(node.url).hostname;
      const imageLine = metadata.ogImage ? `![](${metadata.ogImage})\n\n` : '';
      const cardText = `${imageLine}## [${title}](${node.url})\n\n${desc}\n\n*${siteName}*`;

      // Step 4: Update the text node directly on the canvas
      const updated = this.updateCanvasNodeText(node.id, cardText);

      if (!updated) {
        throw new Error('Failed to update canvas node');
      }

      if (this.settings.showNotifications) {
        new Notice(`Enriched: ${title}`);
      }

      return { success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Enrichment failed:', errorMsg);

      if (this.settings.showNotifications) {
        new Notice(`Enrichment failed: ${errorMsg}`);
      }

      return { success: false, error: errorMsg };

    } finally {
      this.processingNodes.delete(nodeKey);
    }
  }

  // Update a canvas node's text content directly through the internal API
  private updateCanvasNodeText(nodeId: string, newText: string): boolean {
    try {
      const view = this.getActiveCanvasView();
      if (!view || !('canvas' in view)) return false;

      type CanvasInternal = {
        nodes: Map<string, { setText?: (text: string) => void; requestSave?: () => void }>;
        requestSave?: () => void;
      };

      const canvas = (view as ItemView & { canvas: CanvasInternal }).canvas;
      if (!canvas?.nodes) return false;

      const canvasNode = canvas.nodes.get(nodeId);
      if (!canvasNode) return false;

      if (canvasNode.setText) {
        canvasNode.setText(newText);
      }
      if (canvas.requestSave) {
        canvas.requestSave();
      }

      return true;
    } catch {
      return false;
    }
  }

  // Enrich selected links in canvas view
  private async enrichSelectedLinks(canvasView: ItemView) {
    const selection = this.getSelectedLinkNodes(canvasView);
    const canvasFile = this.getActiveCanvasFile();

    if (!canvasFile || selection.length === 0) return;

    for (const node of selection) {
      await this.enrichLinkNode(canvasFile, node);
    }
  }

  // Enrich all link nodes in canvas
  private async enrichAllLinksInCanvas(canvasFile: TFile) {
    const view = this.getActiveCanvasView();
    if (!view || !('canvas' in view)) {
      new Notice('No active canvas view');
      return;
    }

    type CanvasNodeInternal = {
      getData?: () => { id: string; type: string; url?: string; text?: string; x: number; y: number; width: number; height: number };
    };
    type CanvasInternal = {
      nodes: Map<string, CanvasNodeInternal>;
    };

    const canvas = (view as ItemView & { canvas: CanvasInternal }).canvas;
    if (!canvas?.nodes) {
      new Notice('No canvas nodes found');
      return;
    }

    const validLinks: CanvasLinkData[] = [];
    for (const [, node] of canvas.nodes) {
      const data = node.getData?.();
      if (!data) continue;

      if (data.type === 'link' && typeof data.url === 'string' && isValidUrl(data.url)) {
        validLinks.push(data as unknown as CanvasLinkData);
      } else if (data.type === 'text' && typeof data.text === 'string' && isValidUrl(data.text.trim())) {
        validLinks.push({
          id: data.id, type: 'link', url: data.text.trim(),
          x: data.x, y: data.y, width: data.width, height: data.height,
        } as CanvasLinkData);
      }
    }

    if (validLinks.length === 0) {
      new Notice('No link cards found in canvas');
      return;
    }

    new Notice(`Enriching ${validLinks.length} link cards...`);

    for (const node of validLinks) {
      await this.enrichLinkNode(canvasFile, node);
    }

    new Notice('Finished enriching all link cards');
  }

  // Helper: Get active canvas view
  private getActiveCanvasView(): ItemView | null {
    const view = this.app.workspace.getActiveViewOfType(ItemView);
    if (view?.getViewType() === 'canvas') {
      return view;
    }
    return null;
  }

  // Helper: Get active canvas file
  private getActiveCanvasFile(): TFile | null {
    const view = this.getActiveCanvasView();
    if (!view) return null;
    if ('file' in view && view.file instanceof TFile) {
      return view.file;
    }
    return null;
  }

  // Helper: Get selected link nodes from canvas view
  private getSelectedLinkNodes(canvasView: ItemView): CanvasLinkData[] {
    try {
      if (!('canvas' in canvasView)) return [];
      const { canvas } = canvasView as ItemView & { canvas: { selection?: Set<CanvasNodeInstance> } | undefined };
      if (!canvas?.selection) return [];

      const selected: CanvasLinkData[] = [];
      for (const node of canvas.selection) {
        const data = node.getData?.();
        if (!data) continue;

        if (data.type === 'link' && typeof data.url === 'string' && isValidUrl(data.url)) {
          selected.push(data as unknown as CanvasLinkData);
        } else if (data.type === 'text' && 'text' in data && typeof (data as unknown as { text: string }).text === 'string' && isValidUrl((data as unknown as { text: string }).text.trim())) {
          const textData = data as unknown as { id: string; text: string; x: number; y: number; width: number; height: number };
          selected.push({
            id: textData.id, type: 'link', url: textData.text.trim(),
            x: textData.x, y: textData.y, width: textData.width, height: textData.height,
          } as CanvasLinkData);
        }
      }
      return selected;
    } catch {
      return [];
    }
  }
}
