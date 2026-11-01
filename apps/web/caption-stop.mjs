/**
 * Explicit caption Stop: best-effort cleanup with a fail-closed result.
 * A failed provider.stop() may leave a browser resource in an uncertain
 * state. Attempt dispose, then let the UI require a full page reload.
 * This does not authorize or control any hearing-output route.
 */
export async function stopCaptionProviderSafely(provider, onError = () => {}) {
  if (!provider) return true;
  try {
    await provider.stop();
    return true;
  } catch (error) {
    onError("stop", error);
    try {
      await provider.dispose?.();
    } catch (disposeError) {
      onError("dispose", disposeError);
    }
    return false;
  }
}

/**
 * Both failed startup and unexpected transport interruption must release
 * provider and diagnostic resources independently. A cleanup rejection means
 * the browser's microphone state is uncertain: caller must block Start until
 * reload. This function does not grant any hearing-output permission.
 */
export async function disposeCaptionResourcesSafely(provider, releaseDiagnostic, onError = () => {}) {
  let clean = true;
  try {
    await provider?.dispose?.();
  } catch (error) {
    clean = false;
    onError("provider", error);
  }
  try {
    await releaseDiagnostic();
  } catch (error) {
    clean = false;
    onError("diagnostic", error);
  }
  return clean;
}
