import { requestUrl } from 'obsidian';
import { UrlMetadata } from '../types';

export class ScraperService {
  private static readonly TWITTER_HOSTS = ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'];
  private static readonly TWITTER_STATUS_RE = /\/([^/]+)\/status\/(\d+)/;

  /**
   * Scrape metadata and content from a URL
   * @param url - The URL to scrape
   * @returns UrlMetadata with extracted information
   */
  async scrape(url: string): Promise<UrlMetadata> {
    try {
      // Use fxtwitter API for X/Twitter URLs
      const host = new URL(url).hostname.toLowerCase();
      if (ScraperService.TWITTER_HOSTS.includes(host)) {
        return await this.scrapeTwitter(url);
      }

      // Fetch URL using Obsidian's requestUrl API (bypasses CORS)
      const response = await requestUrl({
        url,
        method: 'GET',
        throw: false,
      });

      if (response.status !== 200) {
        console.warn(`Failed to fetch URL ${url}: HTTP ${response.status}`);
        return this.createEmptyMetadata(url);
      }

      // Parse HTML with DOMParser
      const parser = new DOMParser();
      const doc = parser.parseFromString(response.text, 'text/html');

      // Extract base URL for resolving relative URLs
      const baseUrl = new URL(url).origin;

      // Extract metadata
      const title = this.extractTitle(doc);
      const description = this.extractDescription(doc);
      const ogImageCandidate = this.extractImage(doc, baseUrl);
      const ogImage = ogImageCandidate ? await this.validateImageUrl(ogImageCandidate) : null;
      const siteName = this.extractMeta(doc, 'og:site_name');
      const favicon = this.extractFavicon(doc, baseUrl);
      const textContent = this.extractTextContent(doc);

      return {
        url,
        title,
        description,
        ogImage,
        siteName,
        favicon,
        textContent,
      };
    } catch (error) {
      console.warn(`Error scraping URL ${url}:`, error);
      return this.createEmptyMetadata(url);
    }
  }

  /**
   * Scrape X/Twitter URLs via fxtwitter JSON API
   */
  private async scrapeTwitter(originalUrl: string): Promise<UrlMetadata> {
    const match = originalUrl.match(ScraperService.TWITTER_STATUS_RE);
    if (!match) {
      return this.createEmptyMetadata(originalUrl);
    }

    const [, screenName, tweetId] = match;
    const apiUrl = `https://api.fxtwitter.com/${screenName}/status/${tweetId}`;

    try {
      const response = await requestUrl({
        url: apiUrl,
        method: 'GET',
        headers: { 'User-Agent': 'DetailedCanvas-ObsidianPlugin/1.0' },
        throw: false,
      });

      if (response.status !== 200) {
        console.warn(`fxtwitter API returned ${response.status} for ${originalUrl}`);
        return this.createEmptyMetadata(originalUrl);
      }

      const data = response.json;
      const tweet = data?.tweet;
      if (!tweet) {
        return this.createEmptyMetadata(originalUrl);
      }

      // Extract best available image: photo > video thumbnail > external card > avatar
      let ogImage: string | null = null;
      if (tweet.media?.photos?.length > 0) {
        ogImage = tweet.media.photos[0].url ?? null;
      } else if (tweet.media?.videos?.length > 0) {
        ogImage = tweet.media.videos[0].thumbnail_url ?? null;
      } else if (tweet.media?.external?.thumbnail_url) {
        ogImage = tweet.media.external.thumbnail_url;
      }
      // Fall back to author avatar if no media images
      if (!ogImage && tweet.author?.avatar_url) {
        ogImage = tweet.author.avatar_url;
      }

      // Validate image accessibility
      if (ogImage) {
        ogImage = await this.validateImageUrl(ogImage);
      }

      return {
        url: originalUrl,
        title: `${tweet.author?.name ?? screenName} (@${tweet.author?.screen_name ?? screenName})`,
        description: tweet.text ?? null,
        ogImage,
        siteName: 'X (Twitter)',
        favicon: tweet.author?.avatar_url ?? null,
        textContent: tweet.text ?? '',
      };
    } catch (error) {
      console.warn(`fxtwitter scrape failed for ${originalUrl}:`, error);
      return this.createEmptyMetadata(originalUrl);
    }
  }

  /**
   * Extract meta tag content by property or name attribute
   */
  private extractMeta(doc: Document, property: string): string | null {
    // Try property attribute first (Open Graph)
    const propertyMeta = doc.querySelector(`meta[property="${property}"]`);
    if (propertyMeta) {
      return propertyMeta.getAttribute('content');
    }

    // Try name attribute (standard meta tags)
    const nameMeta = doc.querySelector(`meta[name="${property}"]`);
    if (nameMeta) {
      return nameMeta.getAttribute('content');
    }

    return null;
  }

  /**
   * Extract title from og:title or title tag
   */
  private extractTitle(doc: Document): string | null {
    // Try og:title first
    const ogTitle = this.extractMeta(doc, 'og:title');
    if (ogTitle) {
      return ogTitle;
    }

    // Fallback to title tag
    const titleElement = doc.querySelector('title');
    if (titleElement && titleElement.textContent) {
      return titleElement.textContent.trim();
    }

    return null;
  }

  /**
   * Extract description from og:description or meta description
   */
  private extractDescription(doc: Document): string | null {
    // Try og:description first
    const ogDescription = this.extractMeta(doc, 'og:description');
    if (ogDescription) {
      return ogDescription;
    }

    // Fallback to standard description meta tag
    const description = this.extractMeta(doc, 'description');
    if (description) {
      return description;
    }

    return null;
  }

  /**
   * Extract image from og:image or twitter:image, resolve relative URLs
   */
  private extractImage(doc: Document, baseUrl: string): string | null {
    // Try og:image first
    const ogImage = this.extractMeta(doc, 'og:image');
    if (ogImage) {
      return this.resolveUrl(ogImage, baseUrl);
    }

    // Fallback to twitter:image
    const twitterImage = this.extractMeta(doc, 'twitter:image');
    if (twitterImage) {
      return this.resolveUrl(twitterImage, baseUrl);
    }

    return null;
  }

  /**
   * Extract text content from body, strip scripts/styles, limit length
   */
  private extractTextContent(doc: Document): string {
    const body = doc.querySelector('body');
    if (!body) {
      return '';
    }

    // Clone body to avoid modifying original
    const bodyClone = body.cloneNode(true) as HTMLElement;

    // Remove script, style, and other non-content elements
    const selectorsToRemove = [
      'script',
      'style',
      'noscript',
      'iframe',
      'nav',
      'header',
      'footer',
      'aside',
      '[role="navigation"]',
      '[role="banner"]',
      '[role="contentinfo"]',
    ];

    selectorsToRemove.forEach(selector => {
      bodyClone.querySelectorAll(selector).forEach(el => el.remove());
    });

    // Get text content
    let text = bodyClone.textContent || '';

    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
      .replace(/\n\s*\n/g, '\n') // Remove blank lines
      .trim();

    // Limit length to 10000 characters (reasonable for AI processing)
    const maxLength = 10000;
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + '...';
    }

    return text;
  }

  /**
   * Extract favicon URL and resolve to absolute URL
   */
  private extractFavicon(doc: Document, baseUrl: string): string | null {
    // Try various favicon link selectors
    const selectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
    ];

    for (const selector of selectors) {
      const link = doc.querySelector(selector);
      if (link) {
        const href = link.getAttribute('href');
        if (href) {
          return this.resolveUrl(href, baseUrl);
        }
      }
    }

    // Fallback to /favicon.ico
    return `${baseUrl}/favicon.ico`;
  }

  /**
   * Resolve relative URL to absolute URL
   */
  private resolveUrl(relative: string, base: string): string {
    try {
      // If already absolute, return as is
      if (relative.startsWith('http://') || relative.startsWith('https://')) {
        return relative;
      }

      // Handle protocol-relative URLs (//example.com/image.png)
      if (relative.startsWith('//')) {
        const baseUrl = new URL(base);
        return `${baseUrl.protocol}${relative}`;
      }

      // Resolve relative URL
      return new URL(relative, base).href;
    } catch (error) {
      console.warn('Error resolving URL:', error);
      return relative;
    }
  }

  /**
   * Validate that an image URL is accessible (HEAD request)
   */
  private async validateImageUrl(imageUrl: string): Promise<string | null> {
    try {
      const response = await requestUrl({
        url: imageUrl,
        method: 'HEAD',
        throw: false,
      });
      return response.status === 200 ? imageUrl : null;
    } catch {
      return null;
    }
  }

  /**
   * Create empty metadata object for failed scrapes
   */
  private createEmptyMetadata(url: string): UrlMetadata {
    return {
      url,
      title: null,
      description: null,
      ogImage: null,
      siteName: null,
      favicon: null,
      textContent: '',
    };
  }
}
