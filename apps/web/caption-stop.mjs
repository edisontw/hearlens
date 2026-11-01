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
