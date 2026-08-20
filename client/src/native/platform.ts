// Single source of truth for "are we inside the native shell". Reads the global
// Capacitor injects rather than importing @capacitor/core, so the desktop
// bundle never pulls the native runtime in.

interface CapacitorGlobal {
  getPlatform?: () => string;
}

export function isNativeApp(): boolean {
  const platform = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor?.getPlatform?.();
  return platform === 'android' || platform === 'ios';
}
