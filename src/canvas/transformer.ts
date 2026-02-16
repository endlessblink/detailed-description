import { App, TFile } from 'obsidian';
import { CanvasData, CanvasLinkData, CanvasFileData } from '../types';

export class CanvasTransformer {
	constructor(private app: App) {}

	async replaceLinkWithFile(
		canvasFile: TFile,
		linkNodeId: string,
		notePath: string
	): Promise<boolean> {
		try {
			await this.app.vault.process(canvasFile, (content) => {
				const canvasData: CanvasData = JSON.parse(content);

				// Find the link node by ID
				const nodeIndex = canvasData.nodes.findIndex(
					(node) => node.id === linkNodeId
				);

				if (nodeIndex === -1) {
					console.warn(`Node with ID ${linkNodeId} not found`);
					return content; // Return unchanged
				}

				const linkNode = canvasData.nodes[nodeIndex];
				if (linkNode.type !== 'link') {
					console.warn(`Node ${linkNodeId} is not a link node`);
					return content; // Return unchanged
				}

				// Create file node with same properties
				const fileNode: CanvasFileData = {
					id: linkNode.id, // Keep same ID to preserve edges
					type: 'file',
					file: notePath,
					x: linkNode.x,
					y: linkNode.y,
					width: linkNode.width,
					height: linkNode.height,
				};

				// Preserve color if it exists
				if (linkNode.color) {
					fileNode.color = linkNode.color;
				}

				// Replace the node
				canvasData.nodes[nodeIndex] = fileNode;

				// Return updated JSON
				return JSON.stringify(canvasData, null, 2);
			});

			return true;
		} catch (error) {
			console.error('Error replacing link with file node:', error);
			return false;
		}
	}

	async getLinkNodes(canvasFile: TFile): Promise<CanvasLinkData[]> {
		try {
			const content = await this.app.vault.read(canvasFile);
			const canvasData: CanvasData = JSON.parse(content);

			return canvasData.nodes.filter(
				(node): node is CanvasLinkData => node.type === 'link'
			);
		} catch (error) {
			console.error('Error getting link nodes:', error);
			return [];
		}
	}
}
