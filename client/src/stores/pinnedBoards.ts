// Shared pinned-board state. BoardsView and Shell are siblings, so pinning
// must update common state instead of relying on the Shell's one-time load.

import { pinnedBoards as pinnedBoardsApi } from '../api/client';
import type { PinnedBoard } from '../types';
import { createStore } from './store';

export const pinnedBoardsStore = createStore<PinnedBoard[]>([]);

let refreshSeq = 0;

export function mergePinnedBoard(current: readonly PinnedBoard[], saved: PinnedBoard): PinnedBoard[] {
  return [...current.filter((board) => board.id !== saved.id && board.boardId !== saved.boardId), saved]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export async function refreshPinnedBoards(): Promise<PinnedBoard[]> {
  const seq = ++refreshSeq;
  const boards = await pinnedBoardsApi.list();
  if (seq === refreshSeq) pinnedBoardsStore.set(boards);
  return boards;
}

export async function pinBoard(board: {
  boardId: number;
  name: string;
  filterId: number | null;
}): Promise<PinnedBoard> {
  const saved = await pinnedBoardsApi.add(board);
  pinnedBoardsStore.set((current) => mergePinnedBoard(current, saved));
  return saved;
}

export async function unpinBoard(id: string): Promise<void> {
  await pinnedBoardsApi.remove(id);
  pinnedBoardsStore.set((current) => current.filter((board) => board.id !== id));
}
