import { describe, expect, it } from 'vitest';
import { mergePinnedBoard } from '../src/stores/pinnedBoards';
import type { PinnedBoard } from '../src/types';

const board = (id: string, boardId: number, name: string): PinnedBoard => ({
  id,
  profileId: 'default',
  boardId,
  name,
  filterId: null,
});

describe('mergePinnedBoard', () => {
  it('adds a pin in display-name order', () => {
    expect(mergePinnedBoard([board('2', 2, 'Zulu')], board('1', 1, 'Alpha')).map((item) => item.name))
      .toEqual(['Alpha', 'Zulu']);
  });

  it('replaces an existing pin for the same Jira board without duplicating it', () => {
    const merged = mergePinnedBoard([board('old', 7, 'Old name')], board('new', 7, 'New name'));
    expect(merged).toEqual([board('new', 7, 'New name')]);
  });
});
