// @vitest-environment jsdom
/**
 * Integration tests for the Feature 08 @mention autocomplete pipeline:
 * typing `@` in a TipTap editor built with `createMentionSuggestion` must
 * activate the suggestion plugin, render the MentionAutocomplete popup into
 * document.body (Floating-UI positioned via props.mount), filter as the query
 * grows, and insert plain `@username` text on Enter.
 *
 * EditorContent must be mounted around the editor: @tiptap/react's
 * ReactRenderer renders through the editor's `contentComponent` portal
 * pipeline (setRenderer + Portals), not by touching the DOM itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import { createMentionSuggestion, mentionSuggestionKey } from './mentionSuggestion';
import type { MentionableMember } from '../components/MentionAutocomplete';

// jsdom lacks ResizeObserver/IntersectionObserver; floating-ui's autoUpdate
// wants them after its initial synchronous position pass.
class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
beforeEach(() => {
  (globalThis as any).ResizeObserver ??= StubObserver;
  (globalThis as any).IntersectionObserver ??= StubObserver;
});

const MEMBERS: MentionableMember[] = [
  { id: 'u1', username: 'alice', displayName: 'Alice the DM', role: 'dm' },
  { id: 'u2', username: 'bob smith', displayName: 'Bob Smith', role: 'player' },
];

let editor: Editor | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function makeEditor(getMentions: () => MentionableMember[]) {
  editor = new Editor({
    extensions: [StarterKit, createMentionSuggestion(getMentions)],
    content: '',
  });
  // Real-app setup: EditorContent drives the ReactRenderer portal pipeline.
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(React.createElement(EditorContent, { editor }));
  // Concurrent root: wait until EditorContent mounted and initialized the
  // portal pipeline before triggering the suggestion (in the app, users type
  // long after mount — this just removes the setup race).
  await vi.waitFor(() => expect((editor as any).contentComponent).toBeTruthy());
  return editor;
}

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
  editor?.destroy();
  editor = null;
});

function pressKey(key: string) {
  editor!.view.focus();
  editor!.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  );
}

/** The autocomplete popup's text (popup lives in document.body; the editor
 *  itself is also in the body, so scope to the popup container). */
const popupText = () =>
  document.querySelector('[data-mention-autocomplete]')?.textContent || '';

describe('createMentionSuggestion', () => {
  it('stays inert (no popup, no active state) when the member list is empty', async () => {
    editor = await makeEditor(() => []);
    editor.commands.insertContent('@');
    expect(mentionSuggestionKey.getState(editor.state)?.active).toBe(false);
    await new Promise(r => setTimeout(r, 10));
    expect(popupText()).not.toContain('@alice');
  });

  it('activates on `@` and shows all members in the popup', async () => {
    editor = await makeEditor(() => MEMBERS);
    editor.commands.insertContent('@');
    expect(mentionSuggestionKey.getState(editor.state)?.active).toBe(true);
    await vi.waitFor(() => {
      expect(popupText()).toContain('@alice');
      expect(popupText()).toContain('@bob smith');
    });
    // The popup must be attached to <body> and pinned to the suggestion
    // (position fixed + coordinates) — an unpositioned popup renders in flow
    // at the end of the page and is effectively invisible (regression: the
    // plugin's floating-ui mount left it static at the bottom of the body).
    const outer = document.querySelector('[data-mention-autocomplete]')?.parentElement;
    expect(outer).toBeTruthy();
    if (outer) {
      expect(document.body.contains(outer)).toBe(true);
      const s = getComputedStyle(outer);
      expect(s.position).toBe('fixed');
      expect(s.visibility).toBe('visible');
      expect(parseFloat(s.left)).not.toBeNaN();
      expect(parseFloat(s.top)).not.toBeNaN();
    }
  });

  it('filters as the query grows (prefix match on username)', async () => {
    editor = await makeEditor(() => MEMBERS);
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('@alice'));
    editor.commands.insertContent('al');
    await vi.waitFor(() => {
      expect(popupText()).toContain('@alice');
      expect(popupText()).not.toContain('@bob smith');
    });
  });

  it('does not trigger for @ mid-word', async () => {
    editor = await makeEditor(() => MEMBERS);
    editor.commands.insertContent('hi@alice');
    expect(mentionSuggestionKey.getState(editor.state)?.active).toBe(false);
  });

  it('Enter inserts the highlighted member as plain text and closes the popup', async () => {
    editor = await makeEditor(() => MEMBERS);
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('@alice'));
    pressKey('Enter');
    await vi.waitFor(() => {
      expect(editor!.getText()).toBe('@alice ');
      expect(mentionSuggestionKey.getState(editor!.state)?.active).toBe(false);
    });
    // The plugin's update() is async — the "stopped" dispatch and popup
    // teardown land on a microtask behind the portal pipeline.
    await vi.waitFor(() => expect(popupText()).not.toContain('@alice'));
  });

  it('ArrowDown moves the highlight and Enter selects the next member', async () => {
    editor = await makeEditor(() => MEMBERS);
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('@alice'));
    pressKey('ArrowDown');
    pressKey('Enter');
    await vi.waitFor(() => {
      expect(editor!.getText()).toBe('@bob smith ');
    });
  });

  it('Escape dismisses the popup without inserting', async () => {
    editor = await makeEditor(() => MEMBERS);
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('@alice'));
    pressKey('Escape');
    await vi.waitFor(() => expect(popupText()).not.toContain('@alice'));
    expect(editor!.getText()).toBe('@');
  });

  it('inserting after a word mid-sentence works (space prefix)', async () => {
    editor = await makeEditor(() => MEMBERS);
    editor.commands.insertContent('say hi');
    editor.commands.insertContent(' @bo');
    await vi.waitFor(() => expect(popupText()).toContain('@bob smith'));
    pressKey('Enter');
    await vi.waitFor(() => expect(editor!.getText()).toBe('say hi @bob smith '));
  });

  it('updates the member list live through the getter (no editor rebuild)', async () => {
    const members: MentionableMember[] = [];
    editor = await makeEditor(() => members);
    editor.commands.insertContent('@');
    expect(mentionSuggestionKey.getState(editor.state)?.active).toBe(false);
    members.push({ id: 'u3', username: 'cara', displayName: 'Cara', role: 'player' });
    // Type another @ into a new position after the list becomes available.
    editor.commands.insertContent(' @');
    await vi.waitFor(() => {
      expect(popupText()).toContain('@cara');
    });
  });
});
