import { describe, expect, it } from 'vitest';
import { legacyPlaylistDocumentId } from './playlist-library.service';

describe('legacyPlaylistDocumentId', () => {
  it('creates a stable id for retries', () => {
    expect(legacyPlaylistDocumentId('television-1', 'default')).toBe('television-1_default');
    expect(legacyPlaylistDocumentId('television-1', 'default')).toBe('television-1_default');
  });

  it('escapes path separators without losing identity', () => {
    expect(legacyPlaylistDocumentId('television-1', 'morning/summer')).toBe(
      'television-1_morning%2Fsummer',
    );
  });
});
