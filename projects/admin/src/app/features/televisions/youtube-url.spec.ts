import { describe, expect, it } from 'vitest';
import { extractYouTubeVideoId } from './pairing-admin.service';

describe('extractYouTubeVideoId', () => {
  it.each([
    'https://www.youtube.com/watch?v=M7lc1UVf-VE',
    'https://youtu.be/M7lc1UVf-VE?t=20',
    'https://youtube.com/shorts/M7lc1UVf-VE',
    'https://youtube.com/embed/M7lc1UVf-VE',
  ])('extracts an id from %s', (value) => {
    expect(extractYouTubeVideoId(new URL(value))).toBe('M7lc1UVf-VE');
  });

  it('does not treat another host as YouTube', () => {
    expect(extractYouTubeVideoId(new URL('https://example.com/watch?v=M7lc1UVf-VE'))).toBeNull();
  });
});
