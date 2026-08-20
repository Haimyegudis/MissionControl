// Boot chrome shared by both shells.
//
// These two effects used to live privately inside App.tsx. The mobile shell
// needs them just as much — without the splash dismissal the phone renders the
// whole app underneath an overlay that never goes away, which reads as "stuck
// on the welcome screen".

import { useEffect } from 'react';
import { isSettingsLoaded, resolveTheme, settingsStore } from '../stores/settings';
import { useStore } from '../stores/useStore';

/**
 * Keep <html data-theme> in sync with settings. Waits for the first real load
 * so the boot splash's persisted theme survives, then mirrors the resolved
 * value back to localStorage for the next boot's splash script.
 */
export function useThemeSync(): void {
  const settings = useStore(settingsStore);
  useEffect(() => {
    if (!isSettingsLoaded()) return;
    const resolved = resolveTheme(settings.theme);
    document.documentElement.dataset.theme = resolved;
    try {
      localStorage.setItem('jiraweb.theme', resolved);
    } catch {
      /* mirror is best-effort */
    }
  }, [settings]);
}

/**
 * Dismiss the boot splash defined in client/index.html.
 *
 * Desktop plays the full ~2.8s radar sequence on every load by request. A
 * phone is a glance-and-go device and the app is often reopened many times a
 * day, so the mobile shell passes a much shorter hold.
 */
export function useSplashDismiss(holdMs = 2800): void {
  useEffect(() => {
    const el = document.getElementById('splash');
    if (!el || el.dataset.closing) return;
    el.dataset.closing = '1';
    const started = Number(el.dataset.start ?? '0');
    const elapsed = started > 0 ? Date.now() - started : 0;
    window.setTimeout(
      () => {
        el.classList.add('done');
        window.setTimeout(() => el.remove(), 450);
      },
      Math.max(0, holdMs - elapsed),
    );
    // No cleanup: the splash must be dismissed exactly once, even under
    // StrictMode's mount → unmount → remount cycle.
  }, [holdMs]);
}
