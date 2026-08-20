// Biometric unlock gate. Fails closed: if the prompt errors or is cancelled,
// the app stays locked and the Keystore is never read.

/** Background time after which returning to the app re-triggers the prompt. */
export const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How long to wait for the prompt before giving up on it.
 *
 * BiometricPrompt does not always settle: relaunching the activity while it is
 * showing leaves the promise pending forever, and boot then hangs on the
 * splash with nothing rendered — indistinguishable from a crash. Timing out
 * into the locked screen keeps that recoverable.
 */
const PROMPT_TIMEOUT_MS = 45_000;

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
    const prompt = api.BiometricAuth.authenticate({
      reason,
      androidTitle: 'MissionControl',
      allowDeviceCredential: true,
    }).then(() => true);
    const timeout = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), PROMPT_TIMEOUT_MS);
    });
    return await Promise.race([prompt, timeout]);
  } catch {
    return false;
  }
}
