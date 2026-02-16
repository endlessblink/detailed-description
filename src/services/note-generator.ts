import { App, TFile, normalizePath } from 'obsidian';
import { UrlMetadata } from '../types';

export class NoteGeneratorService {
	constructor(private app: App) {}

	/**
	 * Creates an enriched note from URL metadata and AI description
	 * @param metadata - The URL metadata (title, image, domain, etc.)
	 * @param aiDescription - The AI-generated description
	 * @param folder - The folder path where the note should be created
	 * @returns The created TFile
	 */
	async createEnrichedNote(
		metadata: UrlMetadata,
		aiDescription: string,
		folder: string
	): Promise<TFile> {
		// Ensure the folder exists
		await this.ensureFolder(folder);

		// Generate a sanitized filename from the title
		const baseName = this.sanitizeFileName(metadata.title || 'Untitled');

		// Get a unique file path (handles collisions)
		const filePath = await this.getUniqueFilePath(folder, baseName);

		// Generate the markdown content
		const content = this.generateMarkdown(metadata, aiDescription);

		// Create the file
		const file = await this.app.vault.create(filePath, content);

		return file;
	}

	/**
	 * Generates the markdown content for the note
	 */
	private generateMarkdown(metadata: UrlMetadata, description: string): string {
		const parts: string[] = [];

		// Add cover image if available
		if (metadata.ogImage) {
			parts.push(`![Cover](${metadata.ogImage})`);
			parts.push('');
		}

		// Add title
		parts.push(`# ${metadata.title || 'Untitled'}`);
		parts.push('');

		// Add AI description
		parts.push(description);
		parts.push('');

		// Add source separator and link
		const domain = new URL(metadata.url).hostname;
		parts.push('---');
		parts.push(`**Source:** [${domain}](${metadata.url})`);

		return parts.join('\n');
	}

	/**
	 * Sanitizes a filename by removing invalid characters and limiting length
	 */
	private sanitizeFileName(name: string): string {
		// Remove or replace invalid filename characters
		let sanitized = name
			.replace(/[\\/:*?"<>|]/g, '-')  // Replace invalid chars with dash
			.replace(/\s+/g, ' ')            // Normalize whitespace
			.trim();

		// Limit length (leave room for .md extension and potential timestamp)
		const maxLength = 200;
		if (sanitized.length > maxLength) {
			sanitized = sanitized.substring(0, maxLength).trim();
		}

		return sanitized;
	}

	/**
	 * Ensures a folder exists, creating it if necessary
	 */
	private async ensureFolder(path: string): Promise<void> {
		const normalizedPath = normalizePath(path);

		// Check if folder exists
		const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

		if (!folder) {
			// Create the folder and any parent folders
			await this.app.vault.createFolder(normalizedPath);
		}
	}

	/**
	 * Gets a unique file path, appending a timestamp if a collision is detected
	 */
	private async getUniqueFilePath(folder: string, baseName: string): Promise<string> {
		const normalizedFolder = normalizePath(folder);
		let fileName = `${baseName}.md`;
		let filePath = normalizePath(`${normalizedFolder}/${fileName}`);

		// Check if file exists
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);

		if (existingFile) {
			// File exists, append timestamp
			const timestamp = Date.now();
			fileName = `${baseName}-${timestamp}.md`;
			filePath = normalizePath(`${normalizedFolder}/${fileName}`);
		}

		return filePath;
	}
}
