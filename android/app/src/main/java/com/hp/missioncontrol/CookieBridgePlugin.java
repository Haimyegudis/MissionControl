package com.hp.missioncontrol;

import android.webkit.CookieManager;

import java.net.URI;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

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

    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
        "hp-jira.external.hp.com",
        "hp-testrail.external.hp.com"
    ));

    private static final Set<String> SESSION_COOKIE_NAMES = new HashSet<>(Arrays.asList(
        "jsessionid",
        "tr_session",
        "phpsessid"
    ));

    private String validatedUrl(PluginCall call) {
        String raw = call.getString("url");
        if (raw == null || raw.isEmpty()) {
            call.reject("url is required");
            return null;
        }
        try {
            URI uri = URI.create(raw);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null ||
                !ALLOWED_HOSTS.contains(host.toLowerCase(Locale.ROOT))) {
                call.reject("cookie access is not allowed for this host");
                return null;
            }
            return "https://" + host.toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException ex) {
            call.reject("invalid url");
            return null;
        }
    }

    private List<String> cookiePairs(String cookies) {
        List<String> pairs = new ArrayList<>();
        if (cookies == null || cookies.isEmpty()) return pairs;
        for (String part : cookies.split(";")) {
            String pair = part.trim();
            int equals = pair.indexOf('=');
            if (equals <= 0) continue;
            String name = pair.substring(0, equals).trim().toLowerCase(Locale.ROOT);
            if (SESSION_COOKIE_NAMES.contains(name)) pairs.add(pair);
        }
        return pairs;
    }

    @PluginMethod
    public void get(PluginCall call) {
        String url = validatedUrl(call);
        if (url == null) return;
        String cookies = CookieManager.getInstance().getCookie(url);
        JSObject result = new JSObject();
        result.put("cookie", String.join("; ", cookiePairs(cookies)));
        call.resolve(result);
    }

    /** Remove every cookie visible for one approved service host. */
    @PluginMethod
    public void clear(PluginCall call) {
        String url = validatedUrl(call);
        if (url == null) return;
        CookieManager manager = CookieManager.getInstance();
        String cookies = manager.getCookie(url);
        if (cookies != null) {
            for (String part : cookies.split(";")) {
                int equals = part.indexOf('=');
                if (equals <= 0) continue;
                String name = part.substring(0, equals).trim();
                manager.setCookie(url, name + "=; Max-Age=0; Path=/; Secure; HttpOnly");
            }
        }
        manager.flush();
        call.resolve();
    }

    /** Full app sign-out: remove the shared OneUID/WebView cookie jar. */
    @PluginMethod
    public void clearAll(PluginCall call) {
        CookieManager manager = CookieManager.getInstance();
        manager.removeAllCookies(removed -> {
            manager.flush();
            call.resolve();
        });
    }

    /** Persist in-memory cookies so they survive the process being killed. */
    @PluginMethod
    public void flush(PluginCall call) {
        CookieManager.getInstance().flush();
        call.resolve();
    }
}
