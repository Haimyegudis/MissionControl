// Mirrors the watch settings the Android background worker needs.
//
// WatchWorker runs with no WebView, so it cannot read the encrypted stores the
// app keeps its settings in. These three values are not secrets — an on/off
// flag, the project key and the Jira base URL — and go to app-private
// preferences. The worker authenticates from the shared WebView cookie jar, so
// no credential crosses this bridge.

import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './platform';

interface WatchBridgePlugin {
  sync(options: { enabled: boolean; project: string; baseUrl: string }): Promise<void>;
}

const WatchBridge = registerPlugin<WatchBridgePlugin>('WatchBridge');

export async function syncWatchToNative(options: {
  enabled: boolean;
  project: string;
  baseUrl: string;
}): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await WatchBridge.sync(options);
  } catch {
    // An older shell without the plugin: background checks simply do not run,
    // and the in-app cycle still does.
  }
}
