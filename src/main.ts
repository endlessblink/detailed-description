import { Plugin, TFile, Notice, Menu, ItemView } from 'obsidian';
import { DetailedCanvasSettings, AIProvider, CanvasLinkData, EnrichmentResult, CanvasNodeInstance } from './types';
import { DEFAULT_SETTINGS } from './constants';
import { DetailedCanvasSettingTab } from './settings';
import { createProvider } from './services/provider-factory';
import { ScraperService } from './services/scraper';
import { NoteGeneratorService } from './services/note-generator';
import { CanvasMonitor } from './canvas/monitor';
import { CanvasTransformer } from './canvas/transformer';
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
  private noteGenerator!: NoteGeneratorService;
  private canvasMonitor!: CanvasMonitor;
  private canvasTransformer!: CanvasTransformer;

  private processingNodes: Set<string> = new Set(); // Prevent duplicate processing

  async onload() {
    console.log('[DetailedCanvas] Plugin loading, version:', this.manifest.version);
    await this.loadSettings();
    console.log('[DetailedCanvas] Provider:', this.settings.aiProvider, '| Auto-enrich:', this.settings.autoEnrichOnPaste);

    // Initialize services
    this.aiProvider = createProvider(this.settings);
    this.scraperService = new ScraperService();
    this.noteGenerator = new NoteGeneratorService(this.app);
    this.canvasTransformer = new CanvasTransformer(this.app);

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
        if (nodeData && nodeData.type === 'link' && typeof nodeData.url === 'string' && isValidUrl(nodeData.url)) {
          menu.addItem((item) => {
            item
              .setTitle('Enrich with AI description')
              .setIcon('sparkles')
              .onClick(() => {
                const canvasFile = this.getActiveCanvasFile();
                if (canvasFile) {
                  void this.enrichLinkNode(canvasFile, nodeData as unknown as CanvasLinkData);
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

      // Step 3: Create the note
      const noteFile = await this.noteGenerator.createEnrichedNote(
        metadata,
        aiDescription,
        this.settings.notesFolder
      );

      // Step 4: Replace link node with file node
      const success = await this.canvasTransformer.replaceLinkWithFile(
        canvasFile,
        node.id,
        noteFile.path
      );

      if (!success) {
        throw new Error('Failed to update canvas');
      }

      if (this.settings.showNotifications) {
        new Notice(`Enriched: ${metadata.title || node.url}`);
      }

      return { success: true, notePath: noteFile.path };

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
    const linkNodes = await this.canvasTransformer.getLinkNodes(canvasFile);
    const validLinks = linkNodes.filter(n => isValidUrl(n.url));

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
        if (data && data.type === 'link' && typeof data.url === 'string' && isValidUrl(data.url)) {
          selected.push(data as unknown as CanvasLinkData);
        }
      }
      return selected;
    } catch {
      return [];
    }
  }
}
