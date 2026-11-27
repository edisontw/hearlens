package org.hearlens.physicaldsp

import android.media.AudioManager
import java.util.concurrent.Executor

/** Keeps API 31 listener types out of MainActivity's eagerly resolved fields. */
internal object AudioModeChangedListenerApi31 {
    fun register(
        audioManager: AudioManager,
        executor: Executor,
        onChanged: (Int) -> Unit,
    ): Any {
        val listener = ModeChangedListener(onChanged)
        audioManager.addOnModeChangedListener(executor, listener)
        return listener
    }

    fun unregister(audioManager: AudioManager, listener: Any?) {
        if (listener is AudioManager.OnModeChangedListener) {
            audioManager.removeOnModeChangedListener(listener)
        }
    }

    private class ModeChangedListener(
        private val onChanged: (Int) -> Unit,
    ) : AudioManager.OnModeChangedListener {
        override fun onModeChanged(mode: Int) = onChanged(mode)
    }
}
