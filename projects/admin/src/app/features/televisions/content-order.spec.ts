import { describe, expect, it } from 'vitest';
import type { ContentListItem } from 'shared';
import { reorderContentItems } from './content-admin.service';

const items = ['one', 'two', 'three'].map(
  (id, order) =>
    ({
      id,
      name: id,
      type: 'image',
      sourceUrl: `https://example.com/${id}.jpg`,
      order,
      state: 'draft',
    }) as ContentListItem,
);

describe('reorderContentItems', () => {
  it('moves an item and recalculates order values', () => {
    const result = reorderContentItems(items, 0, 2);
    expect(result.map((item) => item.id)).toEqual(['two', 'three', 'one']);
    expect(result.map((item) => item.order)).toEqual([0, 1, 2]);
  });

  it('keeps the same list for an invalid destination', () => {
    expect(reorderContentItems(items, 0, 5)).toBe(items);
  });
});
