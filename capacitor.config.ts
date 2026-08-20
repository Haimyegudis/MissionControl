import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hp.missioncontrol',
  appName: 'MissionControl',
  webDir: 'client/dist',
  android: {
    // The app talks only to https://*.external.hp.com.
    allowMixedContent: false,
  },
  plugins: {
    // Route window.fetch through native OkHttp. Load-bearing: Jira and
    // TestRail REST send no CORS headers, so a WebView-origin fetch to them
    // would be blocked by the browser's same-origin policy.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
