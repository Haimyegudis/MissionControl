package com.hp.missioncontrol;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-GCM app-private persistence for the mobile core's structured tables. */
@CapacitorPlugin(name = "EncryptedStore")
public class EncryptedStorePlugin extends Plugin {
    private static final String KEY_ALIAS = "missioncontrol_encrypted_store_v1";
    private static final byte[] MAGIC = new byte[] { 'M', 'C', 'E', 'S', 1 };
    private static final Set<String> TABLES = new HashSet<>(Arrays.asList(
        "appSettings", "issueCache", "metadataCache", "trCache", "lists"
    ));

    private String table(PluginCall call) {
        String value = call.getString("table");
        if (value == null || !TABLES.contains(value)) {
            call.reject("unknown encrypted table");
            return null;
        }
        return value;
    }

    private File file(String table) {
        return new File(getContext().getFilesDir(), "mc-kv-" + table + ".enc");
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry existing = store.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
        }

        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            spec.setUnlockedDeviceRequired(true);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(spec.build());
        return generator.generateKey();
    }

    private byte[] encrypt(String table, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(table.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        ByteBuffer out = ByteBuffer.allocate(MAGIC.length + 1 + iv.length + ciphertext.length);
        out.put(MAGIC);
        out.put((byte) iv.length);
        out.put(iv);
        out.put(ciphertext);
        return out.array();
    }

    private String decrypt(String table, byte[] stored) throws Exception {
        ByteBuffer in = ByteBuffer.wrap(stored);
        byte[] magic = new byte[MAGIC.length];
        in.get(magic);
        if (!Arrays.equals(magic, MAGIC)) throw new IllegalArgumentException("invalid encrypted file");
        int ivLength = Byte.toUnsignedInt(in.get());
        if (ivLength < 12 || ivLength > 16 || in.remaining() <= ivLength) {
            throw new IllegalArgumentException("invalid encrypted file");
        }
        byte[] iv = new byte[ivLength];
        in.get(iv);
        byte[] ciphertext = new byte[in.remaining()];
        in.get(ciphertext);

        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        cipher.updateAAD(table.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    @PluginMethod
    public void read(PluginCall call) {
        String table = table(call);
        if (table == null) return;
        File target = file(table);
        JSObject result = new JSObject();
        if (!target.exists()) {
            result.put("value", JSObject.NULL);
            call.resolve(result);
            return;
        }
        try {
            AtomicFile atomic = new AtomicFile(target);
            result.put("value", decrypt(table, atomic.readFully()));
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("encrypted data is unreadable", ex);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String table = table(call);
        if (table == null) return;
        String value = call.getString("value");
        if (value == null) {
            call.reject("value is required");
            return;
        }
        AtomicFile atomic = new AtomicFile(file(table));
        FileOutputStream output = null;
        try {
            byte[] encrypted = encrypt(table, value);
            output = atomic.startWrite();
            output.write(encrypted);
            atomic.finishWrite(output);
            call.resolve();
        } catch (Exception ex) {
            if (output != null) atomic.failWrite(output);
            call.reject("encrypted data could not be written", ex);
        }
    }

    /** Full sign-out removes ciphertext, AtomicFile recovery copies, and key. */
    @PluginMethod
    public void clearAll(PluginCall call) {
        try {
            for (String table : TABLES) {
                File target = file(table);
                File backup = new File(target.getPath() + ".bak");
                File pending = new File(target.getPath() + ".new");
                if (target.exists() && !target.delete()) throw new IllegalStateException("could not delete encrypted table");
                if (backup.exists() && !backup.delete()) throw new IllegalStateException("could not delete encrypted backup");
                if (pending.exists() && !pending.delete()) throw new IllegalStateException("could not delete encrypted pending file");
            }
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
            call.resolve();
        } catch (Exception ex) {
            call.reject("encrypted data could not be erased", ex);
        }
    }
}
