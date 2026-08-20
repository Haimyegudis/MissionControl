// Biometric unlock gate. Fails closed: if the prompt errors or is cancelled,
// the app stays locked and the Keystore is never read.

/** Background time after which returning to the app re-triggers the prompt. */
export const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export async function requireUnlock(reason: string): Promise<boolean> {
  let api: typeof import('@aparajita/capacitor-biometric-auth');
  try {
    api = await import('@aparajita/capacitor-biometric-auth');
  } catch {
    return true; // not the native shell: nothing to gate
  }

  try {
    const info = await api.BiometricAuth.checkBiometry();
    if (!info.isAvailable && !info.deviceIsSecure) {
      // No biometry and no device credential — there is no gate to apply, and
      // refusing here would make the app unusable on such a device.
      return true;
    }
    await api.BiometricAuth.authenticate({
      reason,
      androidTitle: 'MissionControl',
      allowDeviceCredential: true,
    });
    return true;
  } catch {
    return false;
  }
}
