package com.hp.missioncontrol;

import android.webkit.CookieManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reads the WebView cookie jar the way JavaScript cannot.
 *
 * Capacitor's cookie API only surfaces cookies visible to document.cookie, so
 * it omits every HttpOnly cookie — which is precisely what a Jira or TestRail
 * session is. android.webkit.CookieManager has no such restriction, and it is
 * process-wide, so a session established inside the HP OneUID login WebView is
 * readable here and can be replayed as a Cookie header on REST calls.
 */
@CapacitorPlugin(name = "CookieBridge")
public class CookieBridgePlugin extends Plugin {

    @PluginMethod
    public void get(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        String cookies = CookieManager.getInstance().getCookie(url);
        JSObject result = new JSObject();
        result.put("cookie", cookies == null ? "" : cookies);
        call.resolve(result);
    }

    /** Persist in-memory cookies so they survive the process being killed. */
    @PluginMethod
    public void flush(PluginCall call) {
        CookieManager.getInstance().flush();
        call.resolve();
    }
}
