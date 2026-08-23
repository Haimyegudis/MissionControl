package com.hp.missioncontrol;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells WatchWorker what to watch.
 *
 * The worker runs with no WebView and therefore no access to the encrypted
 * stores, so the web app mirrors the three non-secret values it needs into
 * app-private preferences: whether alerts are on, the project key, and the
 * Jira base URL. No credential is written here — the worker authenticates from
 * the shared WebView cookie jar.
 */
@CapacitorPlugin(name = "WatchBridge")
public class WatchBridgePlugin extends Plugin {
    @PluginMethod
    public void sync(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        String project = call.getString("project");
        String baseUrl = call.getString("baseUrl");
        if (enabled == null || project == null || baseUrl == null) {
            call.reject("enabled, project and baseUrl are required");
            return;
        }
        SharedPreferences prefs = getContext().getSharedPreferences(WatchWorker.PREFS, Context.MODE_PRIVATE);
        prefs
            .edit()
            .putBoolean(WatchWorker.KEY_ENABLED, enabled)
            .putString(WatchWorker.KEY_PROJECT, project)
            .putString(WatchWorker.KEY_BASE_URL, baseUrl)
            .apply();
        call.resolve();
    }
}
