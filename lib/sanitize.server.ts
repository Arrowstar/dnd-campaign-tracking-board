/**
 * sanitize.server.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Server-side rich-text sanitization (Security-Audit.md critical #2) built on
 * `sanitize-html`. The tag/attribute/style allowlists are shared with the
 * client module (`lib/sanitize.ts`) so stored data is scrubbed before it
 * reaches the database. Runs in Node only (route handlers).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import sanitizeHtml from 'sanitize-html';
import {
  RICH_TEXT_ALLOWED_TAGS,
  STYLE_PROP_WHITELIST,
  sanitizeImageUrl,
} from './sanitize';
import { BoardItem, BoardTab, AttachedFile } from './types';

/** Attributes allowed per tag on the server. `style` passes the shared whitelist. */
const SERVER_ALLOWED_ATTRS: Record<string, string[]> = {
  '*': ['style'],
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  span: ['data-card-id', 'data-card-type', 'data-card-title'],
  th: ['colspan', 'rowspan', 'align'],
  td: ['colspan', 'rowspan', 'align'],
  tr: ['align'],
  p: ['align'],
  div: ['align'],
  li: ['align'],
  h1: ['align'], h2: ['align'], h3: ['align'], h4: ['align'], h5: ['align'], h6: ['align'],
};

/**
 * Sanitizes rich-text HTML with the shared allowlist. `class` is NOT allowed
 * server-side (render-only markup like mention pills is generated client-side).
 */
export function sanitizeRichTextServer(html: string): string {
  if (!html) return '';
  return sanitizeHtml(html, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: SERVER_ALLOWED_ATTRS,
    allowedStyles: { '*': STYLE_PROP_WHITELIST },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'blob'] },
    allowProtocolRelative: false,
    nestingLimit: 50,
    // sanitize-html's 'data' scheme allows ANY data: URI — drop every data:
    // img src so embedded base64 can never be persisted (uploaded images live
    // in Vercel Blob and come back as blob:/https: URLs).
    transformTags: {
      img: (tagName, attribs) => {
        if (attribs.src && /^data:/i.test(attribs.src)) {
          delete attribs.src;
        }
        return { tagName, attribs };
      },
    },
  });
}

/**
 * Sanitizes an item's `content` field. Rich text is scrubbed as HTML; for
 * image-type items the content holds an image URL, which is scheme-validated
 * instead (so `javascript:`/`data:text/html` never survives).
 */
export function sanitizeContentServer(content: string): string {
  if (!content) return '';
  if (/^[a-z][a-z0-9+.\-]*:/i.test(content.trim())) {
    return sanitizeImageUrl(content.trim());
  }
  return sanitizeRichTextServer(content);
}

/**
 * Walks a board tab tree and sanitizes every user-controlled rich-text slot:
 * item content, structured-field text values, image URLs, and comments.
 * Applied server-side before a board state hits the database.
 */
export function sanitizeTabsForSave(tabs: BoardTab[]): BoardTab[] {
  const sanitizeItem = (item: BoardItem): { item: BoardItem; changed: boolean } => {
    let changed = false;

    const content = sanitizeContentServer(item.content || '');
    if (content !== item.content) changed = true;

    let fields = item.fields;
    if (fields && fields.length > 0) {
      const mapped = fields.map((f) => {
        const textValue = typeof f.textValue === 'string' ? sanitizeRichTextServer(f.textValue) : f.textValue;
        const imageUrl = typeof f.imageUrl === 'string' ? sanitizeImageUrl(f.imageUrl) : f.imageUrl;
        const files = f.files && f.files.length > 0
          ? f.files.map((file: AttachedFile): AttachedFile => {
              const url = sanitizeImageUrl(file.url || '');
              return url === file.url ? file : { ...file, url };
            })
          : f.files;
        if (textValue === f.textValue && imageUrl === f.imageUrl && files === f.files) return f;
        changed = true;
        return { ...f, textValue, imageUrl, files };
      });
      if (mapped.some((m, i) => m !== fields![i])) fields = mapped;
    }

    let comments = item.comments;
    if (comments && comments.length > 0) {
      const mapped = comments.map((c) => {
        const text = sanitizeRichTextServer(c.text || '');
        if (text === c.text) return c;
        changed = true;
        return { ...c, text };
      });
      if (mapped.some((m, i) => m !== comments![i])) comments = mapped;
    }

    if (!changed) return { item, changed: false };
    return { item: { ...item, content, fields, comments }, changed: true };
  };

  return tabs.map((tab) => {
    if (!tab.items || tab.items.length === 0) return tab;
    let changed = false;
    const items = tab.items.map((item) => {
      const { item: next, changed: c } = sanitizeItem(item);
      if (c) changed = true;
      return next;
    });
    return changed ? { ...tab, items } : tab;
  });
}

export { sanitizeImageUrl };
