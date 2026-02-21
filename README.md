# Detailed Canvas

Enrich canvas link cards with AI-generated descriptions using Ollama.

## Features

- **AI-generated descriptions** for canvas link cards using a local Ollama instance
- **Automatic metadata extraction** including title, description, and cover image from web pages
- **Auto-enrich on paste** - automatically process new link cards added to canvas
- **Context menu integration** - right-click any link card to enrich it
- **Batch processing** - enrich all link cards in a canvas at once
- Seamless integration with Obsidian Canvas

## Requirements

- [Ollama](https://ollama.com/) installed and running locally (or accessible over network)
- At least one Ollama model downloaded (e.g., `ollama pull llama3.2`)

## Usage

### Enrich a single link card

1. Right-click a link card on your canvas
2. Select **Enrich with AI description** from the context menu
3. The plugin will scrape the URL, generate an AI description, and replace the link card with a rich note card

### Enrich all link cards

Use the command palette (`Ctrl/Cmd + P`) and search for:
- **Enrich selected link card** - process currently selected link cards
- **Enrich all link cards in canvas** - process every link card in the active canvas

### Auto-enrich

When enabled in settings, new link cards pasted into a canvas are automatically enriched.

## Settings

- **Ollama endpoint** - URL of your Ollama server (default: `http://localhost:11434`)
- **Model** - which Ollama model to use for generating descriptions
- **Auto-enrich on paste** - automatically enrich new link cards
- **Notes folder** - where generated notes are stored
- **AI prompt** - customize the prompt used for generating descriptions

## Installation

### From community plugins

1. Open Settings -> Community Plugins
2. Search for "Detailed Canvas"
3. Click Install, then Enable

### Manual installation

1. Download the latest release from GitHub
2. Extract the files to your vault's `.obsidian/plugins/detailed-canvas/` directory
3. Reload Obsidian
4. Enable the plugin in Settings -> Community Plugins

## Development

```bash
npm install
npm run dev    # development mode with hot reload
npm run build  # production build
npm run lint   # lint the code
```

## License

MIT
