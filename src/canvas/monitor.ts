import { App, TFile, Events, EventRef } from 'obsidian';
import { CanvasData, CanvasLinkData } from '../types';

export class CanvasMonitor extends Events {
	private seenNodes: Map<string, Set<string>> = new Map(); // canvasPath -> nodeIds
	private initializedCanvases: Set<string> = new Set(); // canvases that have been scanned at least once
	private modifyHandler: EventRef | null = null;

	constructor(
		private app: App,
		private onNewLinkNode: (file: TFile, node: CanvasLinkData) => void
	) {
		super();
	}

	startWatching(): void {
		this.modifyHandler = this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'canvas') {
				this.checkForNewLinks(file);
			}
		});
	}

	stopWatching(): void {
		if (this.modifyHandler) {
			this.app.vault.offref(this.modifyHandler);
			this.modifyHandler = null;
		}
		this.seenNodes.clear();
		this.initializedCanvases.clear();
	}

	private async checkForNewLinks(file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			const canvasData: CanvasData = JSON.parse(content);

			const canvasPath = file.path;
			const isFirstScan = !this.initializedCanvases.has(canvasPath);
			const previouslySeen = this.seenNodes.get(canvasPath) || new Set<string>();
			const currentNodes = new Set<string>();

			// Find all link nodes
			const linkNodes = canvasData.nodes.filter(
				(node): node is CanvasLinkData => node.type === 'link'
			);

			for (const node of linkNodes) {
				currentNodes.add(node.id);

				// On first scan, only populate cache without triggering callbacks
				// On subsequent scans, trigger callbacks for genuinely new nodes
				if (!isFirstScan && !previouslySeen.has(node.id)) {
					this.onNewLinkNode(file, node);
				}
			}

			// Update the seen nodes for this canvas
			this.seenNodes.set(canvasPath, currentNodes);

			// Mark this canvas as initialized
			if (isFirstScan) {
				this.initializedCanvases.add(canvasPath);
			}
		} catch (error) {
			console.error('Error checking for new links in canvas:', error);
		}
	}

	clearCache(canvasPath?: string): void {
		if (canvasPath) {
			this.seenNodes.delete(canvasPath);
			this.initializedCanvases.delete(canvasPath);
		} else {
			this.seenNodes.clear();
			this.initializedCanvases.clear();
		}
	}
}
