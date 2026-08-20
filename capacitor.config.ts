import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hp.missioncontrol',
  appName: 'MissionControl',
  webDir: 'client/dist',
  // Capacitor's debug bridge logging builds a StringBuilder of every plugin
  // call's payload. That both leaked the Jira PAT into logcat on each request
  // and turned a multi-megabyte cache write into a heap-exhausting string
  // copy. 'production' keeps errors and drops the payload dumps.
  loggingBehavior: 'none',
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
