import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Feature 10 — the inline card-link node ("chip") used inside rich-text
 * fields. Stored in the editor HTML as:
 *
 *   <span data-card-id="<uuid>" data-card-type="npc" data-card-title="Zog">Zog</span>
 *
 * The node is ATOM: it cannot contain content, so users can never type or
 * edit text inside a reference — the chip is selected and deleted as a
 * singular unit (Backspace/Delete removes the whole chip). The displayed
 * title text is produced from the `data-card-title` snapshot: `renderText`
 * feeds `editor.getText()` (and matches the non-atom behavior users expect
 * when reading the document), and `renderHTML` re-emits the title inside the
 * span so the stored HTML shape is identical to the old non-atom format —
 * which is what keeps the pure-string rewrite helpers in lib/cardLinks.ts
 * (and the server-side retitle pass) safe and unchanged.
 */
export const CardLink = Node.create({
  name: 'cardLink',
  inline: true,
  group: 'inline',
  atom: true,
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

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), node.attrs.title ?? ''];
  },

  renderText({ node }) {
    return node.attrs.title ?? '';
  },
});
