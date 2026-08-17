import { describe, expect, it } from 'vitest';
import { canAssignTelevisionToGroup } from './group-admin.service';

describe('canAssignTelevisionToGroup', () => {
  it('allows an ungrouped television', () => {
    expect(canAssignTelevisionToGroup({}, 'group-1')).toBe(true);
  });

  it('allows keeping a television in its current group', () => {
    expect(canAssignTelevisionToGroup({ groupId: 'group-1' }, 'group-1')).toBe(true);
  });

  it('prevents assigning one television to two groups', () => {
    expect(canAssignTelevisionToGroup({ groupId: 'group-2' }, 'group-1')).toBe(false);
  });
});
