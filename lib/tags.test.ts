import { describe, it, expect } from 'vitest';
import {
  normalizeTag,
  addTag,
  mergeTagDefs,
  tagColor,
  allTagNames,
  isLightColor,
  TAG_COLOR_PRESETS,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_ITEM,
} from './tags';
import { BoardItem } from './types';

let idCounter = 0;
function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
  idCounter += 1;
  return {
    id: `item-${idCounter}`,
    type: 'npc',
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    title: 'Test Item',
    content: '',
    date: '2026-01-01',
    color: '#000',
    tags: [],
    visibility: 'all',
    ownerId: 'user-owner',
    ownerName: 'Owner',
    comments: [],
    ...overrides,
  };
}

describe('normalizeTag', () => {
  it('trims, lowercases, and strips leading #', () => {
    expect(normalizeTag('  Red-Larch ')).toBe('red-larch');
    expect(normalizeTag('#Main-Story')).toBe('main-story');
    expect(normalizeTag('###VILLAIN')).toBe('villain');
  });

  it('rejects empty, whitespace, and over-length input', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('#')).toBeNull();
    expect(normalizeTag('a'.repeat(MAX_TAG_LENGTH + 1))).toBeNull();
    expect(normalizeTag('a'.repeat(MAX_TAG_LENGTH))).toBe('a'.repeat(MAX_TAG_LENGTH));
  });

  it('rejects characters outside [a-z0-9-]', () => {
    expect(normalizeTag('red larch')).toBeNull();
    expect(normalizeTag('red_larch')).toBeNull();
    expect(normalizeTag('red.larch')).toBeNull();
    expect(normalizeTag('réd')).toBeNull();
    expect(normalizeTag('a&b')).toBeNull();
  });
});

describe('addTag', () => {
  it('adds a normalized tag, deduping', () => {
    expect(addTag(['red-larch'], '#Red-Larch')).toEqual(['red-larch']);
    expect(addTag([], 'loot')).toEqual(['loot']);
  });

  it('rejects invalid input and caps at 8 tags', () => {
    expect(addTag(['loot'], 'not valid!')).toEqual(['loot']);
    const full = Array.from({ length: MAX_TAGS_PER_ITEM }, (_, i) => `tag-${i}`);
    expect(addTag(full, 'extra')).toEqual(full);
  });
});

describe('mergeTagDefs', () => {
  it('deep-merges per key so concurrent saves never wipe each other', () => {
    const stored = { 'red-larch': { color: '#E5484D' }, villains: { color: '#000000' } };
    const incoming = { villains: { color: '#333333' }, loot: { color: '#FF8A00' } };
    expect(mergeTagDefs(stored, incoming)).toEqual({
      'red-larch': { color: '#E5484D' },
      villains: { color: '#333333' },
      loot: { color: '#FF8A00' },
    });
  });

  it('keeps per-key fields when both sides define different props', () => {
    const a = { tag: { color: '#FF0000' } };
    const b = { tag: { color: '#00FF00' } };
    expect(mergeTagDefs(a, b)).toEqual({ tag: { color: '#00FF00' } });
  });

  it('tolerates undefined/null records', () => {
    expect(mergeTagDefs(undefined, null, {})).toEqual({});
  });

  it('merges more than two records in order', () => {
    expect(mergeTagDefs({ a: { color: '#111111' } }, { a: {} }, { a: { color: '#222222' } })).toEqual({
      a: { color: '#222222' },
    });
  });
});

describe('tagColor', () => {
  it('returns the def color or undefined', () => {
    const defs = { villains: { color: '#E5484D' } };
    expect(tagColor('villains', defs)).toBe('#E5484D');
    expect(tagColor('loot', defs)).toBeUndefined();
    expect(tagColor('loot')).toBeUndefined();
  });
});

describe('allTagNames', () => {
  it('unions tags in use with defined def names, sorted', () => {
    const items = [
      makeItem({ tags: ['villains'] }),
      makeItem({ tags: ['red-larch', 'loot'] }),
    ];
    const defs = { zzz: {}, villains: { color: '#111111' } };
    expect(allTagNames(items, defs)).toEqual(['loot', 'red-larch', 'villains', 'zzz']);
    expect(allTagNames([makeItem()])).toEqual([]);
  });
});

describe('isLightColor', () => {
  it('classifies light vs dark by luminance', () => {
    expect(isLightColor('#FFFFFF')).toBe(true);
    expect(isLightColor('#000000')).toBe(false);
    expect(isLightColor('#F5D90A')).toBe(true);
    expect(isLightColor('#3E63DD')).toBe(false);
    expect(isLightColor('nope')).toBe(false);
  });

  it('expands 3-digit hex', () => {
    expect(isLightColor('#FFF')).toBe(true);
    expect(isLightColor('#000')).toBe(false);
  });
});

describe('presets', () => {
  it('ships 8 preset colors', () => {
    expect(TAG_COLOR_PRESETS).toHaveLength(8);
  });
});
