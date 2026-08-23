import { describe, expect, it, vi } from 'vitest';
import { makeSecureStorageFacade } from '../src/native/secureStorage';

describe('secure storage facade', () => {
  it('is not thenable and still delegates calls to the Capacitor plugin', async () => {
    const get = vi.fn(async () => 'encrypted-value');
    const plugin = {
      get,
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => true),
      clear: vi.fn(async () => {}),
    };

    const facade = makeSecureStorageFacade(plugin as never);

    expect('then' in facade).toBe(false);
    await expect(Promise.resolve(facade)).resolves.toBe(facade);
    await expect(facade.get('key')).resolves.toBe('encrypted-value');
    expect(get).toHaveBeenCalledWith('key');
  });
});
