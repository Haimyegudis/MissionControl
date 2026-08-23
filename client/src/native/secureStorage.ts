// Small native-only wrapper around the Capacitor 8 secure store. Android data
// is encrypted with AES-GCM using non-exportable Android Keystore keys. Calls
// fail closed: there is deliberately no Preferences/localStorage fallback.

type SecureStorageFacade = Pick<
  typeof import('@aparajita/capacitor-secure-storage').SecureStorage,
  'get' | 'set' | 'remove' | 'clear'
>;

export function makeSecureStorageFacade(storage: SecureStorageFacade): SecureStorageFacade {
  return {
    get: (...args) => storage.get(...args),
    set: (...args) => storage.set(...args),
    remove: (...args) => storage.remove(...args),
    clear: (...args) => storage.clear(...args),
  };
}

async function store(): Promise<SecureStorageFacade | null> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return null;
    const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');

    // Capacitor plugins are Proxy objects. Returning the proxy directly from
    // an async function makes Promise resolution probe its `then` property,
    // which Capacitor turns into a native call to the nonexistent method
    // `SecureStorage.then()`. A plain facade prevents that thenable
    // assimilation while preserving the plugin method calls.
    return makeSecureStorageFacade(SecureStorage);
  } catch {
    return null;
  }
}

export async function secureGet<T>(key: string): Promise<T | null> {
  const storage = await store();
  if (!storage) return null;
  try {
    return (await storage.get(key)) as T | null;
  } catch {
    return null;
  }
}

export async function secureSet(key: string, value: string | Record<string, unknown> | unknown[]): Promise<void> {
  const storage = await store();
  if (!storage) return;
  await storage.set(key, value);
}

export async function secureRemove(key: string): Promise<void> {
  const storage = await store();
  if (!storage) return;
  await storage.remove(key);
}

/** Strict full-sign-out erasure of credentials, people, and remembered SSO. */
export async function secureClearAll(): Promise<void> {
  const storage = await store();
  if (!storage) throw new Error('Native secure storage is unavailable.');
  await storage.clear();
}
