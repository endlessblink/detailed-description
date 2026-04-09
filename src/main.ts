import { Plugin, TFile, Notice, Menu, ItemView, requestUrl } from 'obsidian';
import { DetailedCanvasSettings, AIProvider, CanvasLinkData, EnrichmentResult, CanvasNodeInstance } from './types';
import { DEFAULT_SETTINGS } from './constants';
import { DetailedCanvasSettingTab } from './settings';
import { createProvider } from './services/provider-factory';
import { ScraperService } from './services/scraper';
import { CanvasMonitor } from './canvas/monitor';
import { isValidUrl } from './canvas/utils';
import { organizeCanvas } from './canvas/organizer';

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
    await this.loadSettings();

    // Initialize services
    this.aiProvider = createProvider(this.settings);
    this.scraperService = new ScraperService();

    // Initialize canvas monitor
    this.canvasMonitor = new CanvasMonitor(
      this.app,
      (file, node) => { void this.handleNewLinkNode(file, node); },
      `${this.settings.notesFolder}/images`
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

    this.addCommand({
      id: 'organize-canvas',
      name: 'Organize canvas nodes into groups',
      checkCallback: (checking: boolean) => {
        const canvasView = this.getActiveCanvasView();
        const canvasFile = this.getActiveCanvasFile();
        if (!canvasView || !canvasFile) return false;

        if (!checking) {
          void organizeCanvas(this.app, canvasFile, this.aiProvider, this.settings);
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

    // Add ribbon icon with plugin action menu
    this.addRibbonIcon('layout-grid', 'Detailed Canvas', (evt: MouseEvent) => {
      const menu = new Menu();

      const canvasView = this.getActiveCanvasView();
      const canvasFile = this.getActiveCanvasFile();
      const hasCanvas = !!canvasView && !!canvasFile;

      menu.addItem((item) => {
        item
          .setTitle('Enrich selected cards')
          .setIcon('sparkles')
          .setDisabled(!hasCanvas)
          .onClick(() => {
            if (canvasView) {
              void this.enrichSelectedLinks(canvasView);
            }
          });
      });

      menu.addItem((item) => {
        item
          .setTitle('Enrich all link cards')
          .setIcon('sparkles')
          .setDisabled(!hasCanvas)
          .onClick(() => {
            if (canvasFile) {
              void this.enrichAllLinksInCanvas(canvasFile);
            }
          });
      });

      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle('Organize canvas')
          .setIcon('layout-grid')
          .setDisabled(!hasCanvas)
          .onClick(() => {
            if (canvasFile) {
              void organizeCanvas(this.app, canvasFile, this.aiProvider, this.settings);
            }
          });
      });

      menu.showAtMouseEvent(evt);
    });
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

    // Keep images folder in sync with settings
    if (this.canvasMonitor) {
      this.canvasMonitor.imagesFolder = `${this.settings.notesFolder}/images`;
    }

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
      // Show placeholder text on the card while processing
      await this.updateCanvasNodeText(canvasFile, node.id, `Loading...\n\n${node.url}`);

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

      // Download OG image locally to avoid broken remote images (429 rate limits etc.)
      let imageLine = '';
      if (metadata.ogImage) {
        try {
          const localImagePath = await this.downloadImage(metadata.ogImage, node.id);
          if (localImagePath) {
            imageLine = `![[${localImagePath}]]\n\n`;
          }
        } catch {
          // Fallback to remote URL if download fails
          imageLine = `![](${metadata.ogImage})\n\n`;
        }
      }

      const cardText = `${imageLine}## [${title}](${node.url})\n\n${desc}\n\n*${siteName}*`;

      // Step 4: Update the text node directly on the canvas
      const updated = await this.updateCanvasNodeText(canvasFile, node.id, cardText);

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

  // Update a canvas node's text content via file I/O — works on mobile and desktop
  private async updateCanvasNodeText(canvasFile: TFile, nodeId: string, newText: string): Promise<boolean> {
    try {
      await this.app.vault.process(canvasFile, (content) => {
        const canvasData = JSON.parse(content);
        const node = canvasData.nodes?.find((n: { id: string }) => n.id === nodeId);
        if (!node) return content; // Return unchanged if node not found
        node.text = newText;
        node.type = 'text'; // Convert link nodes to text nodes for enrichment
        return JSON.stringify(canvasData, null, '\t');
      });
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

  // Download an image from a URL and save it to the vault
  private async downloadImage(imageUrl: string, nodeId: string): Promise<string | null> {
    try {
      const response = await requestUrl({
        url: imageUrl,
        method: 'GET',
        throw: false,
      });

      if (response.status !== 200) return null;

      // Determine file extension from content-type or URL
      const contentType = response.headers?.['content-type'] ?? '';
      let ext = 'png';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
      else if (contentType.includes('gif')) ext = 'gif';
      else if (contentType.includes('webp')) ext = 'webp';
      else if (contentType.includes('svg')) ext = 'svg';

      // Save to the notes folder under an images subfolder
      const imagesFolder = `${this.settings.notesFolder}/images`;
      const fileName = `${nodeId}.${ext}`;
      const filePath = `${imagesFolder}/${fileName}`;

      // Ensure images folder exists
      const folder = this.app.vault.getAbstractFileByPath(imagesFolder);
      if (!folder) {
        await this.app.vault.createFolder(imagesFolder);
      }

      // Write the binary data
      const existingFile = this.app.vault.getAbstractFileByPath(filePath);
      if (existingFile) {
        return filePath;  // Already downloaded
      }

      await this.app.vault.createBinary(filePath, response.arrayBuffer);
      return filePath;
    } catch {
      return null;
    }
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
