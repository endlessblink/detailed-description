import { App, TFile, Notice } from 'obsidian';
import { AIProvider, CanvasData, AllCanvasNodeData, CanvasGroupData, DetailedCanvasSettings, LLMCategory } from '../types';
import { classifyNodes } from '../services/classifier';
import { layoutGroups } from './layout';
import { generateNodeId } from './utils';

const MIN_NODES_TO_ORGANIZE = 1;
const PLACEMENT_PADDING = 20;

/**
 * Extract meaningful text content from a canvas node.
 * Preserves titles, descriptions, and URLs — strips only image embeds and raw formatting.
 */
function getNodeContent(node: AllCanvasNodeData): string {
	if (node.type === 'text') {
		let text = node.text;
		// Remove image embeds: ![alt](url)
		text = text.replace(/!\[.*?\]\(.*?\)/g, '');
		// Convert markdown links to "title (url)" format
		text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
		// Remove remaining markdown formatting but keep the text
		text = text.replace(/^#{1,6}\s+/gm, '');
		text = text.replace(/[*_~`]/g, '');
		// Collapse whitespace
		text = text.replace(/\n{2,}/g, '\n').trim();
		return text;
	}
	if (node.type === 'link') {
		return node.url;
	}
	if (node.type === 'file') {
		// File nodes are embedded notes — use the file path as content
		// The path often contains a readable title (e.g., "Canvas Notes/My Article Title.md")
		const filePath = (node as unknown as { file: string }).file ?? '';
		// Extract readable name from path
		const name = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath;
		return name;
	}
	return '';
}

/**
 * Check if a node is spatially inside a group.
 */
function isInsideGroup(node: AllCanvasNodeData, group: CanvasGroupData): boolean {
	return (
		node.x >= group.x &&
		node.y >= group.y &&
		node.x + node.width <= group.x + group.width &&
		node.y + node.height <= group.y + group.height
	);
}

/**
 * Check if a node is inside any of the given groups.
 */
function isInsideAnyGroup(node: AllCanvasNodeData, groups: CanvasGroupData[]): boolean {
	return groups.some(g => isInsideGroup(node, g));
}

/**
 * Find the lowest available Y position inside a group (below existing members).
 */
function findNextYInGroup(group: CanvasGroupData, allNodes: AllCanvasNodeData[]): number {
	let maxBottomY = group.y + 50; // Start below the group label

	for (const node of allNodes) {
		if (node.type !== 'group' && isInsideGroup(node, group)) {
			const bottomY = node.y + node.height;
			if (bottomY > maxBottomY) {
				maxBottomY = bottomY;
			}
		}
	}

	return maxBottomY + PLACEMENT_PADDING;
}

/**
 * Organize canvas nodes into labeled groups using AI classification.
 * Prefers placing cards into existing groups; creates new groups only when needed.
 */
export async function organizeCanvas(
	app: App,
	canvasFile: TFile,
	provider: AIProvider,
	settings: DetailedCanvasSettings
): Promise<void> {
	// Step 1: Read canvas data
	const rawContent = await app.vault.read(canvasFile);
	const canvasData: CanvasData = JSON.parse(rawContent);

	// Step 2: Identify existing groups
	const existingGroups = canvasData.nodes.filter(
		(n): n is CanvasGroupData => n.type === 'group'
	);

	// Step 3: Find ungrouped nodes with content
	const ungroupedNodes = canvasData.nodes.filter(
		(n): n is Exclude<AllCanvasNodeData, CanvasGroupData> =>
			n.type !== 'group' &&
			getNodeContent(n).trim().length > 0 &&
			!isInsideAnyGroup(n, existingGroups)
	);

	if (ungroupedNodes.length < MIN_NODES_TO_ORGANIZE) {
		new Notice('No ungrouped cards to organize.');
		return;
	}

	new Notice(`Organizing ${ungroupedNodes.length} ungrouped cards...`);

	// Step 4: Build summaries
	const summaries = ungroupedNodes.map(n => ({
		id: n.id,
		content: getNodeContent(n),
	}));

	// Build group info with full content of what's already inside each group
	const existingGroupInfo = existingGroups
		.filter(g => g.label && g.label.trim().length > 0)
		.map(g => {
			const groupMembers = canvasData.nodes.filter(
				n => n.type !== 'group' && isInsideGroup(n, g)
			);
			const memberContent = groupMembers
				.map(n => getNodeContent(n))
				.filter(s => s.length > 0)
				.join(' | ');
			const label = memberContent
				? `${g.label} — existing members: ${memberContent}`
				: g.label as string;
			return { id: g.id, label };
		});

	// Step 5: Classify via AI (aware of existing groups)
	let classification;
	try {
		classification = await classifyNodes(
			provider,
			summaries,
			existingGroupInfo,
			settings.organizePrompt,
			settings.maxCategories
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		new Notice(`Organization failed: ${msg}`);
		return;
	}

	// Step 6: Build a map of existing group IDs for quick lookup
	const existingGroupMap = new Map<string, CanvasGroupData>();
	for (const g of existingGroups) {
		existingGroupMap.set(g.id, g);
	}

	// Step 7: Separate categories into "existing group" vs "new group"
	const assignToExisting: { group: CanvasGroupData; members: LLMCategory['members'] }[] = [];
	const newCategories: LLMCategory[] = [];

	for (const cat of classification.categories) {
		const existingGroup = existingGroupMap.get(cat.id);
		if (existingGroup) {
			assignToExisting.push({ group: existingGroup, members: cat.members });
		} else {
			newCategories.push(cat);
		}
	}

	// Step 8: Place cards into existing groups
	// We'll track which nodes get repositioned
	const movedNodeIds = new Set<string>();
	const updatedNodes = new Map<string, AllCanvasNodeData>();

	// For existing groups: position cards inside the group bounds
	for (const { group, members } of assignToExisting) {
		let nextY = findNextYInGroup(group, canvasData.nodes);
		const leftX = group.x + PLACEMENT_PADDING;

		for (const member of members) {
			const originalNode = ungroupedNodes.find(n => n.id === member.node_id);
			if (!originalNode) continue;

			const repositioned = { ...originalNode };
			repositioned.x = leftX;
			repositioned.y = nextY;
			nextY += repositioned.height + PLACEMENT_PADDING;

			// Expand group if card doesn't fit
			const needsWidth = repositioned.x + repositioned.width + PLACEMENT_PADDING;
			const needsHeight = nextY;

			if (needsWidth > group.x + group.width) {
				group.width = needsWidth - group.x;
			}
			if (needsHeight > group.y + group.height) {
				group.height = needsHeight - group.y;
			}

			updatedNodes.set(repositioned.id, repositioned);
			movedNodeIds.add(repositioned.id);
		}
	}

	// Step 9: For new categories, use the layout engine
	if (newCategories.length > 0) {
		const newCategoryNodeIds = new Set(newCategories.flatMap(c => c.members.map(m => m.node_id)));
		const nodeDimensions = new Map<string, { width: number; height: number }>();
		for (const node of ungroupedNodes) {
			if (newCategoryNodeIds.has(node.id)) {
				nodeDimensions.set(node.id, { width: node.width, height: node.height });
			}
		}

		const groupLayouts = layoutGroups(newCategories, nodeDimensions);

		// Offset new groups to the right of all existing content
		let maxRight = -Infinity;
		for (const n of canvasData.nodes) {
			const right = n.x + n.width;
			if (right > maxRight) maxRight = right;
		}
		const newGroupStartX = maxRight + 200;

		// Find vertical center of existing content
		let avgY = 0;
		for (const n of canvasData.nodes) {
			avgY += n.y + n.height / 2;
		}
		avgY /= canvasData.nodes.length;

		// Get new layout bounding box
		let layoutMinY = Infinity, layoutMaxY = -Infinity;
		for (const gl of groupLayouts) {
			layoutMinY = Math.min(layoutMinY, gl.y);
			layoutMaxY = Math.max(layoutMaxY, gl.y + gl.height);
		}
		const layoutCy = (layoutMinY + layoutMaxY) / 2;
		const offsetY = avgY - layoutCy;

		for (const gl of groupLayouts) {
			gl.x += newGroupStartX;
			gl.y += offsetY;
			for (const m of gl.members) {
				m.x += newGroupStartX;
				m.y += offsetY;
			}
		}

		for (const gl of groupLayouts) {
			const groupColor = settings.colorGroupsByImportance ? gl.category.group_color : undefined;
			const groupNode: CanvasGroupData = {
				id: generateNodeId(),
				type: 'group',
				x: gl.x,
				y: gl.y,
				width: gl.width,
				height: gl.height,
				label: gl.category.label,
				color: groupColor,
			};
			canvasData.nodes.push(groupNode);

			for (const memberRect of gl.members) {
				const originalNode = ungroupedNodes.find(n => n.id === memberRect.id);
				if (originalNode) {
					const repositioned = { ...originalNode };
					repositioned.x = memberRect.x;
					repositioned.y = memberRect.y;
					updatedNodes.set(repositioned.id, repositioned);
					movedNodeIds.add(repositioned.id);
				}
			}
		}
	}

	// Step 10: Build final canvas data
	const finalNodes: AllCanvasNodeData[] = [];
	for (const node of canvasData.nodes) {
		if (updatedNodes.has(node.id)) {
			finalNodes.push(updatedNodes.get(node.id) as AllCanvasNodeData);
		} else {
			finalNodes.push(node);
		}
	}

	const newCanvasData: CanvasData = {
		nodes: finalNodes,
		edges: canvasData.edges,
	};

	// Step 11: Write back
	await app.vault.process(canvasFile, () => JSON.stringify(newCanvasData, null, '\t'));

	const existingCount = assignToExisting.reduce((sum, a) => sum + a.members.length, 0);
	const newCount = movedNodeIds.size - existingCount;
	const parts: string[] = [];
	if (existingCount > 0) parts.push(`${existingCount} cards → existing groups`);
	if (newCount > 0) parts.push(`${newCount} cards → ${newCategories.length} new groups`);
	new Notice(`Organized: ${parts.join(', ')}`);
}
