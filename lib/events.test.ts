import { describe, it, expect } from 'vitest';
import {
  buildSseEventFrame,
  buildSseHeartbeat,
  serializeRevision,
} from './events';

describe('serializeRevision', () => {
  it('passes ISO strings through unchanged', () => {
    expect(serializeRevision('2026-08-04T12:00:00.000Z')).toBe('2026-08-04T12:00:00.000Z');
  });

  it('converts Date objects to ISO strings', () => {
    const d = new Date('2026-08-04T12:00:00.000Z');
    expect(serializeRevision(d)).toBe('2026-08-04T12:00:00.000Z');
  });

  it('returns null for null, empty strings, and non-string values', () => {
    expect(serializeRevision(null)).toBeNull();
    expect(serializeRevision('')).toBeNull();
    expect(serializeRevision(undefined)).toBeNull();
    expect(serializeRevision(123)).toBeNull();
  });
});

describe('buildSseEventFrame', () => {
  it('builds a spec-compliant event frame', () => {
    expect(buildSseEventFrame('revision', '2026-08-04T12:00:00.000Z')).toBe(
      'event: revision\ndata: 2026-08-04T12:00:00.000Z\n\n'
    );
  });

  it('turns embedded newlines into additional data: lines', () => {
    expect(buildSseEventFrame('e', 'a\nb\r\nc')).toBe('event: e\ndata: a\ndata: b\ndata: c\n\n');
  });

  it('always terminates the frame with a blank line', () => {
    expect(buildSseEventFrame('e', 'x')).toMatch(/\n\n$/);
  });
});

describe('buildSseHeartbeat', () => {
  it('builds a comment frame (ignored by EventSource)', () => {
    expect(buildSseHeartbeat()).toBe(': keepalive\n\n');
  });
});
