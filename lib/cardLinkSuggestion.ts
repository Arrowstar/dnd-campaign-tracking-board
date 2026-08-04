import { Extension } from '@tiptap/core';
import Suggestion, { exitSuggestion } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import CardLinkAutocomplete from '../components/CardLinkAutocomplete';
import { CardLinkableItem, filterCards } from './cardLinks';

/**
 * Shared plugin key — exported so tests (and any future tooling) can read the
 * suggestion plugin's state deterministically (prosemirror PluginKey names
 * are NOT stable; see lib/mentionSuggestion.ts).
 */
export const cardLinkSuggestionKey = new PluginKey('cardLinkSuggestion');

/**
 * Feature 10 — the `@` card-link autocomplete for rich-text fields, as a
 * self-contained TipTap extension.
 *
 * `getCards` is invoked LIVE every time the suggestion triggers, so the
 * editor (created once, never recreated when props change) always sees the
 * current board item list. Returning an empty array keeps the plugin inert.
 *
 * Selecting a row inserts a `cardLink` node (lib/cardLinkExtension.ts) whose
 * text is the target item's title snapshot — stored as
 * <span data-card-id="…" data-card-type="…" data-card-title="…">Title</span>.
 * If the CardLink node is not registered on the editor, the fallback is a
 * plain-text insertion (safe for editors that only have mentions enabled).
 *
 * The dropdown is rendered with ReactRenderer into a body-level popup pinned
 * to the active suggestion decoration; keyboard state lives here and is
 * pushed into the component through `updateProps` — same pipeline as the
 * Feature 08 mention dropdown (lib/mentionSuggestion.ts).
 */
export function createCardLinkSuggestion(getCards: () => CardLinkableItem[]): Extension {
  return Extension.create({
    name: 'cardLinkSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<CardLinkableItem, { item: CardLinkableItem }>({
          editor: this.editor,
          pluginKey: cardLinkSuggestionKey,
          char: '@',
          // Card titles contain spaces — keep typing them.
          allowSpaces: true,
          allowedPrefixes: [' ', '\n'],
          shouldShow: () => getCards().length > 0,
          items: ({ query }) => filterCards(getCards(), query),
          command: ({ editor: ed, range, props }) => {
            const { item } = props;
            const cardLink = ed.schema.nodes.cardLink;
            if (cardLink) {
              ed.chain().focus().insertContentAt(range, [
                {
                  type: cardLink.name,
                  attrs: {
                    cardId: item.id,
                    itemType: item.itemType,
                    title: item.title,
                  },
                },
                { type: 'text', text: ' ' },
              ]).run();
            } else {
              // No CardLink node (e.g. a mentions-only editor) — degrade to
              // plain text so the picker still works.
              ed.chain().focus().insertContentAt(range, `${item.title} `).run();
            }
            // With allowSpaces the trailing space stays inside the suggestion
            // match — exit explicitly, like the mention plugin.
            exitSuggestion(ed.view, cardLinkSuggestionKey);
          },
          render: () => {
            let component: ReactRenderer | null = null;
            let unmount: (() => void) | null = null;
            let highlighted = 0;
            let currentItems: CardLinkableItem[] = [];
            let command: ((props: { item: CardLinkableItem }) => void) | null = null;
            const push = (items: CardLinkableItem[] = currentItems) => {
              component?.updateProps({
                items,
                highlighted,
                onSelect: (item: CardLinkableItem) => command?.({ item }),
              });
            };
            return {
              onStart: props => {
                highlighted = 0;
                currentItems = props.items;
                command = props.command;
                component = new ReactRenderer(CardLinkAutocomplete, {
                  props: {
                    items: props.items,
                    highlighted,
                    onSelect: (item: CardLinkableItem) => props.command({ item }),
                    onHover: (i: number) => {
                      highlighted = i;
                      push();
                    },
                  },
                  editor: props.editor,
                });
                // Mount + position the popup ourselves instead of the plugin's
                // floating-ui createMount: pin it to the active suggestion
                // decoration span with position: fixed and re-place on
                // scroll/resize (same rationale as lib/mentionSuggestion.ts).
                const element = component.element;
                document.body.appendChild(element);
                const place = () => {
                  const rect = props.editor.view.dom
                    .querySelector('[data-decoration-id]')
                    ?.getBoundingClientRect();
                  if (rect) {
                    element.style.position = 'fixed';
                    element.style.left = `${rect.left}px`;
                    element.style.top = `${rect.bottom + 4}px`;
                  }
                  element.style.visibility = 'visible';
                  element.style.zIndex = '50';
                };
                place();
                window.addEventListener('scroll', place, true);
                window.addEventListener('resize', place);
                unmount = () => {
                  window.removeEventListener('scroll', place, true);
                  window.removeEventListener('resize', place);
                  element.remove();
                };
              },
              onUpdate: props => {
                currentItems = props.items;
                command = props.command;
                highlighted = Math.min(highlighted, Math.max(0, props.items.length - 1));
                push();
              },
              onKeyDown: ({ event }) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  highlighted = currentItems.length === 0 ? 0 : (highlighted + 1) % currentItems.length;
                  push();
                  return true;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  highlighted = currentItems.length === 0 ? 0 : (highlighted - 1 + currentItems.length) % currentItems.length;
                  push();
                  return true;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  const item = currentItems[highlighted];
                  if (item) {
                    event.preventDefault();
                    command?.({ item });
                    return true;
                  }
                }
                return false;
              },
              onExit: () => {
                unmount?.();
                unmount = null;
                component?.destroy();
                component = null;
              },
            };
          },
        }),
      ];
    },
  });
}
