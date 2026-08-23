package com.hp.missioncontrol;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Build;
import android.view.WindowManager;

import java.io.File;
import java.security.KeyStore;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super so the bridge picks it up during startup.
        registerPlugin(CookieBridgePlugin.class);
        registerPlugin(EncryptedStorePlugin.class);
        registerPlugin(WatchBridgePlugin.class);
        // Security migrations must finish before the WebView can hydrate data.
        removeLegacySecureStorage();
        removeLegacyPlaintextData();
        super.onCreate(savedInstanceState);

        // Jira/TestRail screens contain corporate data. Keep them out of
        // screenshots, screen sharing, and the recent-apps snapshot.
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false);
        }

        scheduleDashboardWatch();
    }

    /**
     * Background dashboard checks. Fifteen minutes is WorkManager's floor and
     * Doze stretches it further; the in-app cadence in Settings governs how
     * often the app itself checks while it is open. KEEP so returning to the
     * app does not reset the interval that is already ticking.
     */
    private void scheduleDashboardWatch() {
        WatchWorker.ensureChannel(this);

        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(WatchWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "mc-watch",
            ExistingPeriodicWorkPolicy.KEEP,
            request
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1001);
        }
    }

    /**
     * Version 0.13 of the old storage plugin could fall back to Base64 in the
     * cap_sec preference file. The replacement intentionally does not migrate
     * those values: delete them and require one fresh sign-in.
     */
    @SuppressLint("ApplySharedPref") // Must be gone before JavaScript hydration starts.
    private void removeLegacySecureStorage() {
        final String marker = "removed_legacy_secure_storage_v1";
        SharedPreferences migrations = getSharedPreferences("missioncontrol_security_migrations", Context.MODE_PRIVATE);
        if (migrations.getBoolean(marker, false)) return;

        if (!getSharedPreferences("cap_sec", Context.MODE_PRIVATE).edit().clear().commit()) return;
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            String alias = getPackageName() + "_cap_sec";
            if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias);
        } catch (Exception ignored) {
            // The plaintext/ciphertext preference copy is already gone. Retry
            // Keystore cleanup next launch if the provider was unavailable.
            return;
        }
        migrations.edit().putBoolean(marker, true).apply();
    }

    /** Delete plaintext cache/name copies written by builds before encryption. */
    @SuppressLint("ApplySharedPref") // Must be gone before JavaScript hydration starts.
    private void removeLegacyPlaintextData() {
        final String marker = "removed_legacy_plaintext_data_v1";
        SharedPreferences migrations = getSharedPreferences("missioncontrol_security_migrations", Context.MODE_PRIVATE);
        if (migrations.getBoolean(marker, false)) return;

        String[] tables = { "appSettings", "issueCache", "metadataCache", "trCache", "lists" };
        boolean removed = true;
        for (String table : tables) {
            File file = new File(getFilesDir(), "kv-" + table + ".json");
            if (file.exists() && !file.delete()) removed = false;
        }
        SharedPreferences capacitor = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = capacitor.edit().remove("mc.testrail.people");
        for (String table : tables) editor.remove("mc.kv." + table);
        if (!editor.commit()) removed = false;
        if (!removed) return;
        migrations.edit().putBoolean(marker, true).apply();
    }
}
