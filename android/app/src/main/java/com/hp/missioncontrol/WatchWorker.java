package com.hp.missioncontrol;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.CookieManager;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Background dashboard watch.
 *
 * The WebView-based design this replaced could not work: Capacitor's Bridge
 * requires an Activity, and without the bridge CapacitorHttp cannot patch
 * fetch, so a worker-owned WebView is CORS-blocked from Jira. This worker
 * therefore talks to Jira directly.
 *
 * It deliberately does NOT reimplement the TypeScript differ. It only answers
 * "did anything change, and how many issues were involved", by comparing
 * hashes of the same snapshot fields core/src/watch/differ.ts compares. The
 * detailed feed — which field, from what, to what — is produced by that differ
 * when the app next runs, so the two never disagree about wording or kinds.
 *
 * Nothing readable is persisted: the state file holds hashed issue keys mapped
 * to hashed field tuples, so a dump of app preferences reveals no issue key,
 * summary or status.
 */
public class WatchWorker extends Worker {
    static final String PREFS = "missioncontrol_watch";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_PROJECT = "project";
    static final String KEY_BASE_URL = "baseUrl";
    private static final String KEY_STATE = "hashes";

    private static final String CHANNEL_ID = "mc_jira_changes";
    private static final int NOTIFICATION_ID = 4101;
    private static final int TIMEOUT_MS = 30_000;

    /** Mirrors WATCH_FIELDS in core/src/watch/service.ts, minus the sprint id. */
    private static final String[] FIELDS = { "summary", "status", "priority", "assignee", "updated", "duedate", "comment" };

    public WatchWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_ENABLED, false)) return Result.success();

        String baseUrl = prefs.getString(KEY_BASE_URL, null);
        String project = prefs.getString(KEY_PROJECT, null);
        if (baseUrl == null || project == null) return Result.success(); // never configured by the app

        // Cookie authentication only: HP OneUID is the sole credential on this
        // build, and no token is stored. No cookie means signed out, which is
        // not an error worth retrying.
        String cookie;
        try {
            cookie = CookieManager.getInstance().getCookie(baseUrl);
        } catch (Exception e) {
            return Result.success();
        }
        if (cookie == null || cookie.trim().isEmpty()) return Result.success();

        String jql = "project = " + project + " AND sprint in openSprints() AND assignee = currentUser()";
        Map<String, String> current;
        try {
            current = fetchHashes(baseUrl, cookie, jql);
        } catch (Exception e) {
            // A VPN blip or a 5xx: try again on the next window rather than
            // dropping this cycle's changes on the floor.
            return Result.retry();
        }

        Map<String, String> previous = readState(prefs);
        writeState(prefs, current);

        // Baseline: the first cycle records what is already there and stays
        // silent, matching the differ's rule for a missing snapshot.
        if (previous == null) return Result.success();

        int affected = countAffected(previous, current);
        if (affected > 0) notifyChanged(affected);
        return Result.success();
    }

    // -----------------------------------------------------------------------
    // Jira
    // -----------------------------------------------------------------------

    /** hash(issue key) -> hash(the fields the differ compares). */
    private Map<String, String> fetchHashes(String baseUrl, String cookie, String jql) throws Exception {
        JSONObject body = new JSONObject();
        body.put("jql", jql);
        body.put("startAt", 0);
        body.put("maxResults", 200);
        JSONArray fields = new JSONArray();
        for (String field : FIELDS) fields.put(field);
        // The sprint custom field id is resolved at runtime by the web app and
        // is not known here; *navigable is a superset that includes it.
        fields.put("*navigable");
        body.put("fields", fields);

        String base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
        HttpURLConnection conn = (HttpURLConnection) new URL(base + "rest/api/2/search").openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("Cookie", cookie);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = conn.getResponseCode();
            if (status == 401 || status == 403) {
                // The session lapsed. The app surfaces that on next launch; a
                // notification here would only say "sign in again" repeatedly.
                throw new IllegalStateException("unauthorised");
            }
            if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
            return parse(readBody(conn.getInputStream()));
        } finally {
            conn.disconnect();
        }
    }

    private static String readBody(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    private Map<String, String> parse(String json) throws Exception {
        JSONObject root = new JSONObject(json);
        JSONArray issues = root.optJSONArray("issues");
        Map<String, String> out = new HashMap<>();
        if (issues == null) return out;
        for (int i = 0; i < issues.length(); i++) {
            JSONObject issue = issues.optJSONObject(i);
            if (issue == null) continue;
            String key = issue.optString("key", "");
            if (key.isEmpty()) continue;
            JSONObject fields = issue.optJSONObject("fields");
            out.put(sha256(key), sha256(fingerprint(fields)));
        }
        return out;
    }

    /**
     * The same fields core/src/watch/differ.ts compares, in a fixed order.
     * Anything added there must be added here or a change of that kind will
     * not wake the phone.
     */
    private static String fingerprint(JSONObject fields) {
        if (fields == null) return "";
        JSONObject status = fields.optJSONObject("status");
        JSONObject priority = fields.optJSONObject("priority");
        JSONObject assignee = fields.optJSONObject("assignee");
        JSONObject comment = fields.optJSONObject("comment");
        return String.join(
            "|",
            status == null ? "" : status.optString("name", ""),
            priority == null ? "" : priority.optString("name", ""),
            assignee == null ? "" : assignee.optString("displayName", ""),
            fields.optString("duedate", ""),
            comment == null ? "0" : String.valueOf(comment.optInt("total", 0)),
            activeSprintName(fields)
        );
    }

    /**
     * The active sprint's name, whatever custom field carries it. The field id
     * differs per Jira instance and is resolved by the web app at runtime, so
     * this scans for the sprint shape instead of a known id.
     */
    private static String activeSprintName(JSONObject fields) {
        Iterator<String> keys = fields.keys();
        while (keys.hasNext()) {
            String name = keys.next();
            if (!name.startsWith("customfield_")) continue;
            JSONArray array = fields.optJSONArray(name);
            if (array == null) continue;
            for (int i = 0; i < array.length(); i++) {
                JSONObject entry = array.optJSONObject(i);
                if (entry != null) {
                    if ("active".equalsIgnoreCase(entry.optString("state", ""))) {
                        return entry.optString("name", "");
                    }
                    continue;
                }
                String text = array.optString(i, "");
                if (!text.toLowerCase(Locale.ROOT).contains("state=active")) continue;
                int at = text.indexOf("name=");
                if (at < 0) continue;
                int end = at + 5;
                while (end < text.length() && text.charAt(end) != ',' && text.charAt(end) != ']') end++;
                return text.substring(at + 5, end);
            }
        }
        return "";
    }

    /** Issues added, removed, or whose compared fields differ. */
    static int countAffected(Map<String, String> previous, Map<String, String> current) {
        int affected = 0;
        for (Map.Entry<String, String> entry : current.entrySet()) {
            String before = previous.get(entry.getKey());
            if (before == null || !before.equals(entry.getValue())) affected++;
        }
        for (String key : previous.keySet()) {
            if (!current.containsKey(key)) affected++;
        }
        return affected;
    }

    // -----------------------------------------------------------------------
    // State — hashes only, never readable issue data
    // -----------------------------------------------------------------------

    private Map<String, String> readState(SharedPreferences prefs) {
        String raw = prefs.getString(KEY_STATE, null);
        if (raw == null) return null;
        try {
            JSONObject obj = new JSONObject(raw);
            Map<String, String> out = new HashMap<>();
            Iterator<String> keys = obj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                out.put(key, obj.optString(key, ""));
            }
            return out;
        } catch (Exception e) {
            return null; // corrupt state reads as no baseline: silence, not a flood
        }
    }

    private void writeState(SharedPreferences prefs, Map<String, String> hashes) {
        JSONObject obj = new JSONObject();
        try {
            for (Map.Entry<String, String> entry : hashes.entrySet()) obj.put(entry.getKey(), entry.getValue());
        } catch (Exception ignored) {
            return;
        }
        prefs.edit().putString(KEY_STATE, obj.toString()).apply();
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(value.hashCode()); // never reached on Android
        }
    }

    // -----------------------------------------------------------------------
    // Notification
    // -----------------------------------------------------------------------

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Dashboard changes",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Changes to the Jira work on your dashboard.");
        // Corporate data must not be legible from a locked screen.
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void notifyChanged(int affected) {
        Context context = getApplicationContext();
        ensureChannel(context);

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String text = affected == 1
            ? "1 issue on your dashboard changed"
            : affected + " issues on your dashboard changed";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Mission Control")
            .setContentText(text)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS refused. The events still reach the in-app
            // feed the next time the app runs a cycle.
        }
    }

    /** List form used by the unit test; kept package-private on purpose. */
    static List<String> sortedKeys(Map<String, String> map) {
        List<String> keys = new ArrayList<>(map.keySet());
        java.util.Collections.sort(keys);
        return keys;
    }
}
