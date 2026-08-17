import { describe, expect, it } from 'vitest';
import { playerContentPath } from './pairing.service';

describe('playerContentPath', () => {
  it('reads a migrated playlist from the library', () => {
    expect(playerContentPath('tv-1', 'playlist-1', true)).toBe('playlists/playlist-1/contentItems');
  });

  it('reads legacy content before migration', () => {
    expect(playerContentPath('tv-1', 'default', false)).toBe('televisions/tv-1/contentItems');
  });
});
