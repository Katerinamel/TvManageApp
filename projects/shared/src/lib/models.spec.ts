import { describe, expect, it } from 'vitest';
import type { TelevisionContentItem } from './models';

describe('shared models', () => {
  it('supports an image with a display duration', () => {
    const now = new Date();
    const item: TelevisionContentItem = {
      id: 'content-1',
      name: 'welcome.webp',
      type: 'image',
      mimeType: 'image/webp',
      storagePath: 'televisions/tv-1/content-1/welcome.webp',
      order: 0,
      durationSeconds: 10,
      size: 1024,
      createdAt: now,
      updatedAt: now,
      state: 'draft',
    };

    expect(item.durationSeconds).toBe(10);
  });
});
