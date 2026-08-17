import { describe, expect, it } from 'vitest';
import { contentCollectionPath } from './content-admin.service';

describe('contentCollectionPath', () => {
  it('uses the shared playlist collection in library mode', () => {
    expect(contentCollectionPath('tv-1', 'playlist-1', true)).toBe(
      'playlists/playlist-1/contentItems',
    );
  });

  it('keeps the legacy television collection as fallback', () => {
    expect(contentCollectionPath('tv-1', 'default', false)).toBe('televisions/tv-1/contentItems');
  });
});
