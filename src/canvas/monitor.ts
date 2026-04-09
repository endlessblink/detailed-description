import { App, TFile, TFolder, EventRef } from 'obsidian';
import { CanvasData, CanvasLinkData } from '../types';
import { isValidUrl } from './utils';

export class CanvasMonitor {
	private seenNodes: Map<string, Set<string>> = new Map(); // canvasPath -> nodeIds
	private initializedCanvases: Set<string> = new Set(); // canvases that have been scanned at least once
	private modifyHandler: EventRef | null = null;

	constructor(
		private app: App,
		private onNewLinkNode: (file: TFile, node: CanvasLinkData) => void,
		public imagesFolder: string
	) {}

	startWatching(): void {
		// Prevent duplicate listeners if called multiple times
		if (this.modifyHandler) {
			this.app.vault.offref(this.modifyHandler);
		}
		this.modifyHandler = this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.extension === 'canvas') {
				void this.checkForNewLinks(file);
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

			// Find native link nodes
			const linkNodes = canvasData.nodes.filter(
				(node): node is CanvasLinkData => node.type === 'link'
			);

			// Also find text nodes that contain just a URL (from Ctrl+V paste)
			for (const node of canvasData.nodes) {
				if (node.type === 'text' && 'text' in node) {
					const text = (node as unknown as { text: string }).text.trim();
					if (isValidUrl(text)) {
						linkNodes.push({
							id: node.id,
							type: 'link',
							url: text,
							x: node.x,
							y: node.y,
							width: node.width,
							height: node.height,
						});
					}
				}
			}

			for (const node of linkNodes) {
				currentNodes.add(node.id);

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

			void this.cleanupOrphanedImages();
		} catch (error) {
			console.error('Error checking for new links in canvas:', error);
		}
	}

	private async cleanupOrphanedImages(): Promise<void> {
		try {
			// Collect all node IDs from every canvas in the vault
			const allNodeIds = new Set<string>();
			const canvasFiles = this.app.vault.getFiles().filter(f => f.extension === 'canvas');

			for (const canvasFile of canvasFiles) {
				try {
					const content = await this.app.vault.read(canvasFile);
					const canvasData: CanvasData = JSON.parse(content);
					for (const node of canvasData.nodes) {
						allNodeIds.add(node.id);
					}
				} catch {
					// Skip unreadable canvas files
				}
			}

			// Check images folder for orphaned files
			const folder = this.app.vault.getAbstractFileByPath(this.imagesFolder);
			if (!(folder instanceof TFolder)) return;

			for (const child of folder.children) {
				if (!(child instanceof TFile)) continue;
				const nodeId = child.basename;
				if (!allNodeIds.has(nodeId)) {
					console.log(`[DetailedCanvas] Deleting orphaned image: ${child.path}`);
					await this.app.vault.trash(child, true);
				}
			}
		} catch (error) {
			console.error('Error during orphaned image cleanup:', error);
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
