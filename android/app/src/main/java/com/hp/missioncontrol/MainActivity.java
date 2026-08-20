package com.hp.missioncontrol;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super so the bridge picks it up during startup.
        registerPlugin(CookieBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
