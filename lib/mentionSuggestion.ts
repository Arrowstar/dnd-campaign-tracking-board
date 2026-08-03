import { Extension } from '@tiptap/core';
import Suggestion, { exitSuggestion } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import MentionAutocomplete, {
  MentionableMember,
  filterMembers,
} from '../components/MentionAutocomplete';

/**
 * Shared plugin key — exported so tests (and any future tooling) can read the
 * suggestion plugin's state deterministically. prosemirror's PluginKey names
 * are NOT stable ("suggestion$", "suggestion$1", ...); the plugin must be
 * created with the SAME key object used for state reads.
 */
export const mentionSuggestionKey = new PluginKey('mentionSuggestion');

/**
 * Feature 08 — the `@`-mention autocomplete, as a self-contained TipTap
 * extension.
 *
 * `getMentions` is invoked LIVE every time the suggestion triggers, so the
 * editor (which is created once and never recreated when props change) always
 * sees the current board member list. Returning an empty array keeps the
 * plugin inert.
 *
 * Deliberately NOT using `@tiptap/extension-mention`: mentions are plain
 * `@username` text (stored as-is in the comment HTML), so `command` inserts
 * plain text and highlighting happens at render time (see `highlightMentions`).
 *
 * The dropdown is rendered with ReactRenderer into a body-level popup that the
 * plugin positions with Floating UI (`props.mount`); keyboard state
 * (highlighted index) lives here and is pushed into the component through
 * `updateProps`.
 */
export function createMentionSuggestion(
  getMentions: () => MentionableMember[]
): Extension {
  return Extension.create({
    name: 'mentionSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<MentionableMember, { member: MentionableMember }>({
          editor: this.editor,
          pluginKey: mentionSuggestionKey,
          char: '@',
          // Multi-word usernames ("jo smith") are real — keep typing spaces.
          allowSpaces: true,
          allowedPrefixes: [' ', '\n'],
          shouldShow: () => {
            const n = getMentions().length;
            console.log('[MENTION] shouldShow', { memberCount: n, show: n > 0 });
            return n > 0;
          },
          items: ({ query }) => {
            const list = filterMembers(getMentions(), query);
            console.log('[MENTION] items', { query, count: list.length });
            return list;
          },
          command: ({ editor: ed, range, props }) => {
            // Plain-text insertion — mentions have no dedicated node type.
            ed.chain().focus().insertContentAt(range, `@${props.member.username} `).run();
            // With allowSpaces the trailing space stays inside the suggestion
            // match (`@.*?(?=\s@|$)`, lazy), so the plugin would remain active
            // with a stale query and an empty popup. Exit explicitly — the
            // metadata-only transaction is safe and avoids decoration churn.
            exitSuggestion(ed.view, mentionSuggestionKey);
          },
          render: () => {
            let component: ReactRenderer | null = null;
            let unmount: (() => void) | null = null;
            let highlighted = 0;
            let currentItems: MentionableMember[] = [];
            let command: ((props: { member: MentionableMember }) => void) | null = null;
            const push = (items: MentionableMember[] = currentItems) => {
              component?.updateProps({
                items,
                highlighted,
                onSelect: (member: MentionableMember) => command?.({ member }),
              });
            };
            return {
              onStart: props => {
                highlighted = 0;
                currentItems = props.items;
                command = props.command;
                console.log('[MENTION] onStart', { itemCount: props.items.length, range: props.range });
                component = new ReactRenderer(MentionAutocomplete, {
                  props: {
                    items: props.items,
                    highlighted,
                    onSelect: (member: MentionableMember) => props.command({ member }),
                    onHover: (i: number) => {
                      highlighted = i;
                      push();
                    },
                  },
                  editor: props.editor,
                });
                unmount = props.mount(component.element);
                console.log('[MENTION] mounted', {
                  inBody: document.body.contains(component.element),
                  initialized: (props.editor as any).isEditorContentInitialized,
                });
              },
              onUpdate: props => {
                console.log('[MENTION] onUpdate', { itemCount: props.items.length, loading: (props as any).loading });
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
                  const member = currentItems[highlighted];
                  if (member) {
                    event.preventDefault();
                    command?.({ member });
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




