package org.hearlens.physicaldsp

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

internal object PhysicalDspShadowReportStore {
    fun publish(directory: File, fileName: String, report: String): File {
        require(fileName.startsWith("dsp-shadow-callback-result-") && fileName.endsWith(".json"))
        val resultFile = File(directory, fileName)
        val temporaryFile = File(directory, ".$fileName.tmp")
        try {
            temporaryFile.writeText(report, Charsets.UTF_8)
            Files.move(
                temporaryFile.toPath(),
                resultFile.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
            )
            return resultFile
        } finally {
            if (temporaryFile.exists()) temporaryFile.delete()
        }
    }
}
