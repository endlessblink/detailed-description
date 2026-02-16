export function isValidUrl(url: string): boolean {
	try {
		const urlObj = new URL(url);
		return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
	} catch {
		return false;
	}
}

export function generateNodeId(): string {
	// Generate 16 character hex ID (matching Obsidian's canvas node ID format)
	const chars = '0123456789abcdef';
	let id = '';
	for (let i = 0; i < 16; i++) {
		id += chars[Math.floor(Math.random() * 16)];
	}
	return id;
}
