import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Feature 10 — the inline card-link node ("chip") used inside rich-text
 * fields. Stored in the editor HTML as:
 *
 *   <span data-card-id="<uuid>" data-card-type="npc" data-card-title="Zog">Zog</span>
 *
 * The node is deliberately NON-atom inline with `text*` content so the
 * displayed title is real, selectable text — users can edit/delete it, and
 * the server-side rewrite (lib/cardLinks.ts retitleCardLinksInHtml) restores
 * the target's current title snapshot on save. Non-atom also means links can
 * never nest (a card-link span can only contain text), which is what keeps
 * the pure-string rewrite helpers in lib/cardLinks.ts safe.
 */
export const CardLink = Node.create({
  name: 'cardLink',
  inline: true,
  group: 'inline',
  content: 'text*',
  selectable: true,

  addAttributes() {
    return {
      cardId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-card-id'),
        renderHTML: (attributes) =>
          attributes.cardId ? { 'data-card-id': attributes.cardId } : {},
      },
      itemType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-card-type'),
        renderHTML: (attributes) =>
          attributes.itemType ? { 'data-card-type': attributes.itemType } : {},
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-card-title'),
        renderHTML: (attributes) =>
          attributes.title ? { 'data-card-title': attributes.title } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-card-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      // Deleting inside a chip removes the link entirely (the remaining text
      // lives on) — no special handling needed: Backspace on an empty inline
      // node's start deletes the node, and the snapshot text is what we want
      // to keep anyway. Nothing to register.
    };
  },
});
