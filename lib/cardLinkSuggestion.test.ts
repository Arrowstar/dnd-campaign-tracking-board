// @vitest-environment jsdom
/**
 * Integration tests for the Feature 10 `@` card-link autocomplete pipeline:
 * typing `@` in a TipTap editor built with `createCardLinkSuggestion` +
 * CardLink must activate the suggestion plugin, render the
 * CardLinkAutocomplete popup into document.body, filter as the query grows,
 * and insert a cardLink node (span with data-card-id/type/title) on Enter.
 * See lib/mentionSuggestion.test.ts for the pipeline rationale.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import { createCardLinkSuggestion, cardLinkSuggestionKey } from './cardLinkSuggestion';
import { CardLink } from './cardLinkExtension';
import { CardLinkableItem } from './cardLinks';

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

const CARDS: CardLinkableItem[] = [
  { id: 'c1', title: 'Lord Nezznar', itemType: 'npc' },
  { id: 'c2', title: 'Wave Echo Cave', itemType: 'location' },
  { id: 'c3', title: 'Klarg', itemType: 'npc' },
];

let editor: Editor | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function makeEditor(
  getCards: () => CardLinkableItem[],
  opts: { withCardLink?: boolean } = {}
) {
  const extensions: Extensions = [StarterKit];
  if (opts.withCardLink !== false) extensions.push(CardLink);
  extensions.push(createCardLinkSuggestion(getCards));
  editor = new Editor({ extensions, content: '' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(React.createElement(EditorContent, { editor }));
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

/** The autocomplete popup's text (popup lives in document.body). */
const popupText = () =>
  document.querySelector('[data-card-link-autocomplete]')?.textContent || '';

describe('createCardLinkSuggestion', () => {
  it('stays inert (no popup, no active state) when the card list is empty', async () => {
    editor = await makeEditor(() => []);
    editor.commands.insertContent('@');
    expect(cardLinkSuggestionKey.getState(editor.state)?.active).toBe(false);
    await new Promise(r => setTimeout(r, 10));
    expect(popupText()).not.toContain('Lord Nezznar');
  });

  it('activates on `@` and shows all cards in the popup', async () => {
    editor = await makeEditor(() => CARDS);
    editor.commands.insertContent('@');
    expect(cardLinkSuggestionKey.getState(editor.state)?.active).toBe(true);
    await vi.waitFor(() => {
      expect(popupText()).toContain('Lord Nezznar');
      expect(popupText()).toContain('Wave Echo Cave');
    });
    const outer = document.querySelector('[data-card-link-autocomplete]')?.parentElement;
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

  it('filters as the query grows (substring on title or type)', async () => {
    editor = await makeEditor(() => CARDS);
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('Lord Nezznar'));
    editor.commands.insertContent('cave');
    await vi.waitFor(() => {
      expect(popupText()).toContain('Wave Echo Cave');
      expect(popupText()).not.toContain('Lord Nezznar');
    });
  });

  it('does not trigger for @ mid-word', async () => {
    editor = await makeEditor(() => CARDS);
    editor.commands.insertContent('hi@nezz');
    expect(cardLinkSuggestionKey.getState(editor.state)?.active).toBe(false);
  });

  it('Enter inserts a cardLink node with the title text and closes the popup', async () => {
    editor = await makeEditor(() => CARDS);
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('Lord Nezznar'));
    pressKey('Enter');
    await vi.waitFor(() => {
      expect(editor!.getText()).toBe('Lord Nezznar ');
      expect(cardLinkSuggestionKey.getState(editor!.state)?.active).toBe(false);
    });
    expect(editor!.getHTML()).toContain(
      '<span data-card-id="c1" data-card-type="npc" data-card-title="Lord Nezznar">Lord Nezznar</span>'
    );
    await vi.waitFor(() => expect(popupText()).not.toContain('Lord Nezznar'));
  });

  it('ArrowDown moves the highlight and Enter selects the next card', async () => {
    editor = await makeEditor(() => CARDS);
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('Lord Nezznar'));
    pressKey('ArrowDown');
    pressKey('Enter');
    await vi.waitFor(() => {
      expect(editor!.getText()).toBe('Wave Echo Cave ');
    });
  });

  it('Escape dismisses the popup without inserting', async () => {
    editor = await makeEditor(() => CARDS);
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('Lord Nezznar'));
    pressKey('Escape');
    await vi.waitFor(() => expect(popupText()).not.toContain('Lord Nezznar'));
    expect(editor!.getText()).toBe('@');
  });

  it('inserting after a word mid-sentence works (space prefix)', async () => {
    editor = await makeEditor(() => CARDS);
    editor.commands.insertContent('say hi');
    editor.commands.insertContent(' @klarg');
    await vi.waitFor(() => expect(popupText()).toContain('Klarg'));
    pressKey('Enter');
    await vi.waitFor(() => expect(editor!.getText()).toBe('say hi Klarg '));
  });

  it('degrades to plain-text insertion when CardLink is not registered', async () => {
    editor = await makeEditor(() => CARDS, { withCardLink: false });
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('Lord Nezznar'));
    pressKey('Enter');
    await vi.waitFor(() => {
      expect(editor!.getText()).toBe('Lord Nezznar ');
      expect(editor!.getHTML()).not.toContain('data-card-id');
    });
  });

  it('chip is an atom node — a singular add/delete unit with no editable content', async () => {
    editor = await makeEditor(() => CARDS);
    editor.commands.insertContent('@');
    await vi.waitFor(() => expect(popupText()).toContain('Lord Nezznar'));
    pressKey('Enter');
    await vi.waitFor(() => expect(editor!.getText()).toBe('Lord Nezznar '));
    let chip: { isAtom: boolean; type: { name: string } } | null = null;
    editor!.state.doc.descendants(node => {
      if (node.type.name === 'cardLink') {
        chip = node;
        return false;
      }
      return true;
    });
    expect(chip).toBeTruthy();
    expect(chip!.isAtom).toBe(true);
  });

  it('round-trips a stored span: parse restores text and HTML shape stays identical', async () => {
    editor = await makeEditor(() => CARDS);
    editor.commands.setContent(
      '<p>See <span data-card-id="c1" data-card-type="npc" data-card-title="Lord Nezznar">Lord Nezznar</span> for details.</p>'
    );
    expect(editor!.getText()).toBe('See Lord Nezznar for details.');
    expect(editor!.getHTML()).toBe(
      '<p>See <span data-card-id="c1" data-card-type="npc" data-card-title="Lord Nezznar">Lord Nezznar</span> for details.</p>'
    );
  });

  it('updates the card list live through the getter (no editor rebuild)', async () => {
    const cards: CardLinkableItem[] = [];
    editor = await makeEditor(() => cards);
    editor.commands.insertContent('@');
    expect(cardLinkSuggestionKey.getState(editor.state)?.active).toBe(false);
    cards.push({ id: 'c9', title: 'Gundren Rockseeker', itemType: 'npc' });
    editor.commands.insertContent(' @');
    await vi.waitFor(() => {
      expect(popupText()).toContain('Gundren Rockseeker');
    });
  });
});
