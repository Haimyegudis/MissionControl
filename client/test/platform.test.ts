import { afterEach, describe, expect, it } from 'vitest';
import { isNativeApp } from '../src/native/platform';

declare global {
  // eslint-disable-next-line no-var
  var Capacitor: { getPlatform?: () => string } | undefined;
}

afterEach(() => {
  globalThis.Capacitor = undefined;
});

describe('isNativeApp', () => {
  it('is false in a plain browser', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('is false when Capacitor reports the web platform', () => {
    globalThis.Capacitor = { getPlatform: () => 'web' };
    expect(isNativeApp()).toBe(false);
  });

  it('is true on android', () => {
    globalThis.Capacitor = { getPlatform: () => 'android' };
    expect(isNativeApp()).toBe(true);
  });

  it('tolerates a Capacitor global without getPlatform', () => {
    globalThis.Capacitor = {};
    expect(isNativeApp()).toBe(false);
  });
});
