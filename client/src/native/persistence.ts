// AES-GCM persistence for every native core table. Ciphertext lives in
// app-private files; the non-exportable key lives in Android Keystore.

import { registerPlugin } from '@capacitor/core';
import type { KvRecord, KvTable } from '@mc/core';
import type { KvPersistence } from './kvStore';

interface EncryptedStorePlugin {
  read(options: { table: KvTable }): Promise<{ value: string | null }>;
  write(options: { table: KvTable; value: string }): Promise<void>;
  clearAll(): Promise<void>;
}

const EncryptedStore = registerPlugin<EncryptedStorePlugin>('EncryptedStore');

export const EncryptedPersistence: KvPersistence = {
  async read(table) {
    const { value } = await EncryptedStore.read({ table });
    return value ? (JSON.parse(value) as Array<[string, KvRecord]>) : null;
  },
  async write(table, entries) {
    await EncryptedStore.write({ table, value: JSON.stringify(entries) });
  },
};

export function persistenceFor(_table: KvTable): KvPersistence {
  return EncryptedPersistence;
}

/** Strict full-sign-out erasure; rejects if native deletion fails. */
export async function clearEncryptedPersistence(): Promise<void> {
  await EncryptedStore.clearAll();
}
