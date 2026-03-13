import { LLMCategory } from '../types';

// Layout constants
const GROUP_PADDING = 40;
const GROUP_GAP = 150;
const GROUP_LABEL_HEIGHT = 50;
const NODE_GAP = 30;
const MIN_NODE_WIDTH = 300;
const MIN_NODE_HEIGHT = 200;
const MAX_COLUMNS = 2;

interface NodeRect {
	id: string;
	w: number;
	h: number;
	x: number;
	y: number;
}

export interface GroupLayout {
	category: LLMCategory;
	x: number;
	y: number;
	width: number;
	height: number;
	members: NodeRect[];
}

/**
 * Simple column layout for nodes within a group.
 * Cards are arranged in columns (max 2), stacked top-to-bottom.
 */
function layoutColumn(members: NodeRect[], maxCols: number): { w: number; h: number } {
	if (members.length === 0) return { w: 0, h: 0 };

	const cols = Math.min(maxCols, members.length);
	const colWidth = members.reduce((max, m) => Math.max(max, m.w), 0);

	// Distribute members across columns
	const colHeights = new Array(cols).fill(0);
	const colItems: NodeRect[][] = Array.from({ length: cols }, () => []);

	for (const member of members) {
		// Find the shortest column
		let shortestCol = 0;
		for (let c = 1; c < cols; c++) {
			if (colHeights[c] < colHeights[shortestCol]) shortestCol = c;
		}
		colItems[shortestCol].push(member);
		colHeights[shortestCol] += member.h + NODE_GAP;
	}

	// Position each member
	for (let c = 0; c < cols; c++) {
		let y = 0;
		for (const member of colItems[c]) {
			member.x = c * (colWidth + NODE_GAP);
			member.y = y;
			y += member.h + NODE_GAP;
		}
	}

	const totalW = cols * colWidth + (cols - 1) * NODE_GAP;
	const totalH = Math.max(...colHeights);

	return { w: totalW, h: totalH };
}

/**
 * Lay out classified nodes into groups on the canvas.
 * Groups are arranged in a horizontal row. Nodes within each group
 * are arranged in clean columns.
 */
export function layoutGroups(
	categories: LLMCategory[],
	nodeDimensions: Map<string, { width: number; height: number }>
): GroupLayout[] {
	// Sort categories by importance (highest first = leftmost)
	const sorted = [...categories].sort((a, b) => b.importance_score - a.importance_score);

	const results: GroupLayout[] = [];
	let currentX = 0;

	for (const category of sorted) {
		// Build member rects
		const memberRects: NodeRect[] = category.members.map(m => {
			const dims = nodeDimensions.get(m.node_id);
			return {
				id: m.node_id,
				w: Math.max(dims?.width ?? MIN_NODE_WIDTH, MIN_NODE_WIDTH),
				h: Math.max(dims?.height ?? MIN_NODE_HEIGHT, MIN_NODE_HEIGHT),
				x: 0,
				y: 0,
			};
		});

		// Layout members in columns
		const cols = memberRects.length > 4 ? MAX_COLUMNS : 1;
		const packed = layoutColumn(memberRects, cols);

		// Group dimensions
		const groupW = packed.w + GROUP_PADDING * 2;
		const groupH = packed.h + GROUP_PADDING * 2 + GROUP_LABEL_HEIGHT;

		// Offset member positions within the group
		for (const rect of memberRects) {
			rect.x += GROUP_PADDING;
			rect.y += GROUP_PADDING + GROUP_LABEL_HEIGHT;
		}

		const layout: GroupLayout = {
			category,
			x: currentX,
			y: 0,
			width: groupW,
			height: groupH,
			members: memberRects,
		};

		// Finalize member positions (absolute)
		for (const rect of layout.members) {
			rect.x += currentX;
			rect.y += 0;
		}

		results.push(layout);
		currentX += groupW + GROUP_GAP;
	}

	return results;
}
