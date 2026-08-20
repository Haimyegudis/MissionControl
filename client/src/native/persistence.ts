// Two persistence backends, chosen by expected size. Preferences maps to
// Android SharedPreferences, which is right for small structured state and
// wrong for megabyte caches; those go to an app-private JSON file instead.

import type { KvRecord, KvTable } from '@mc/core';
import type { KvPersistence } from './kvStore';

const SMALL_TABLES: ReadonlySet<KvTable> = new Set<KvTable>(['appSettings', 'metadataCache']);

export const PreferencesPersistence: KvPersistence = {
  async read(table) {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: `mc.kv.${table}` });
    return value ? (JSON.parse(value) as Array<[string, KvRecord]>) : null;
  },
  async write(table, entries) {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: `mc.kv.${table}`, value: JSON.stringify(entries) });
  },
};

export const FilesystemPersistence: KvPersistence = {
  async read(table) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    try {
      const { data } = await Filesystem.readFile({
        path: `kv-${table}.json`,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return JSON.parse(String(data)) as Array<[string, KvRecord]>;
    } catch {
      return null; // absent on first run
    }
  },
  async write(table, entries) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    await Filesystem.writeFile({
      path: `kv-${table}.json`,
      directory: Directory.Data,
      data: JSON.stringify(entries),
      encoding: Encoding.UTF8,
    });
  },
};

export function persistenceFor(table: KvTable): KvPersistence {
  return SMALL_TABLES.has(table) ? PreferencesPersistence : FilesystemPersistence;
}
