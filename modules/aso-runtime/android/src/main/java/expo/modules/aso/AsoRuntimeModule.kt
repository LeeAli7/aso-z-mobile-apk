package expo.modules.aso

import android.content.Context
import android.os.Build
import android.system.Os
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipInputStream

/**
 * AsoRuntimeModule — встроенный Linux-рантайм (Termux bootstrap внутри приложения).
 *
 * Концепция (см. embedded_termux_bootstrap.md):
 *  - Одно хранилище: `files/data/usr` = $PREFIX, `files/data/home` = $HOME, всё внутри
 *    приватной директории приложения — никакого внешнего Termux, никакого SAF.
 *  - Shell-сессия = обычный дочерний процесс нашего приложения (ProcessBuilder)
 *    с прямым pipe stdout. Без Intent-очередей.
 *  - apt настроен на официальный репозиторий Termux (packages.termux.dev) — конфиг
 *    идёт в составе bootstrap-архива.
 *
 * Bootstrap-архивы: assets/bootstrap-<abi>.zip (распаковываются при первом запуске).
 *
 * Лицензия: использует компоненты проекта Termux (GPLv3) — см. раздел «О приложении».
 */
class AsoRuntimeModule : Module() {

    private val tag = "AsoRuntime"

    private val sessions = ConcurrentHashMap<Int, Process>()
    @Volatile private var sessionSeq = 0

    // ── Пути (единое хранилище внутри приложения) ────────────────────────────

    private fun context(): Context =
        appContext.reactContext ?: throw IllegalStateException("reactContext is null")

    private fun dataRoot(): File = File(context().filesDir, "data")

    private fun prefixDir(): File = File(dataRoot(), "usr")

    private fun homeDir(): File = File(dataRoot(), "home")

    private fun bootstrapMarker(): File = File(dataRoot(), ".bootstrap-done")

    private fun abi(): String =
        (Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a")

    private fun bootstrapAssetName(): String = when {
        abi() == "arm64-v8a" || abi().contains("x86_64") -> "bootstrap-aarch64.zip"
        abi() == "armeabi-v7a" || abi().startsWith("arm") -> "bootstrap-arm.zip"
        else -> "bootstrap-aarch64.zip"
    }

    // ── Module definition ─────────────────────────────────────────────────────

    override fun definition() = ModuleDefinition {
        Name("AsoRuntime")

        Events("onOutput", "onExit")

        AsyncFunction("isInstalled") { promise: expo.modules.kotlin.Promise ->
            promise.resolve(bootstrapMarker().exists())
        }

        AsyncFunction("install") { promise: expo.modules.kotlin.Promise ->
            GlobalScope.launch(Dispatchers.IO) {
                try {
                    installBootstrap()
                    AsoRuntimeService.start(context())
                    promise.resolve(mapOf("ok" to true, "prefix" to prefixDir().absolutePath))
                } catch (e: Exception) {
                    Log.e(tag, "bootstrap install failed", e)
                    promise.resolve(mapOf("ok" to false, "error" to (e.message ?: "$e")))
                }
            }
        }

        AsyncFunction("exec") { cmd: String, cwd: String?, promise: expo.modules.kotlin.Promise ->
            try {
                require(bootstrapMarker().exists()) { "bootstrap not installed" }
                AsoRuntimeService.start(context())
                val proc = startProcess(cmd, cwd)
                val id = ++sessionSeq
                sessions[id] = proc
                streamOutput(id, proc)
                promise.resolve(mapOf("sessionId" to id, "pid" to safePid(proc)))
            } catch (e: Exception) {
                promise.resolve(mapOf("sessionId" to -1, "pid" to 0, "error" to "$e"))
            }
        }

        AsyncFunction("kill") { sessionId: Int, promise: expo.modules.kotlin.Promise ->
            val proc = sessions.remove(sessionId)
            if (proc != null) {
                proc.destroy()
                promise.resolve(true)
            } else promise.resolve(false)
        }
    }

    // ── Установка bootstrap ───────────────────────────────────────────────────

    private fun installBootstrap() {
        if (bootstrapMarker().exists()) return
        Log.i(tag, "installing bootstrap into ${prefixDir().absolutePath}")

        dataRoot().mkdirs()
        prefixDir().mkdirs()
        homeDir().mkdirs()

        val assetName = bootstrapAssetName()
        val stream = try {
            context().assets.open("bootstrap/$assetName")
        } catch (e: Exception) {
            // ABI-специфичный ассет не найден — пробуем запасной arm.
            try { context().assets.open("bootstrap/bootstrap-arm.zip") } catch (e2: Exception) {
                throw IllegalStateException("bootstrap asset not found ($assetName)", e)
            }
        }

        ZipInputStream(stream.buffered()).use { zis ->
            val symlinkLines = ArrayList<Pair<String, String>>()
            var entry = zis.nextEntry
            while (entry != null) {
                val name = entry.name
                if (name == "SYMLINKS.txt") {
                    // читаем симлинки прямо из zip (как TermuxInstaller), не раскладывая файл.
                    // БЕЗ bufferedReader().useLines — закрытие reader закроет zis и сломает поток.
                    val sb = StringBuilder()
                    val buf = ByteArray(4096)
                    while (true) {
                        val n = zis.read(buf)
                        if (n <= 0) break
                        sb.append(String(buf, 0, n, Charsets.UTF_8))
                    }
                    sb.toString().lineSequence().forEach { line ->
                        val parts = line.split("←")
                        if (parts.size == 2) symlinkLines.add(Pair(parts[0].trim(), parts[1].trim()))
                    }
                } else if (!entry.isDirectory) {
                    val target = File(prefixDir(), name)
                    target.parentFile?.mkdirs()
                    target.outputStream().use { out -> zis.copyTo(out) }
                    // Права на исполнение — как в TermuxInstaller:
                    // bin/, libexec, lib/apt/apt-helper, lib/apt/methods → 0700.
                    if (name.startsWith("bin/") || name.startsWith("libexec/") ||
                        name.startsWith("lib/apt/apt-helper") || name.startsWith("lib/apt/methods")) {
                        try { Os.chmod(target.absolutePath, 0x1C0 /*0700*/) } catch (_: Exception) {}
                    }
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }

            // симлинки: target как есть (относительный), link — относительно $PREFIX.
            for ((target, link) in symlinkLines) {
                try {
                    val linkFile = File(prefixDir(), link)
                    linkFile.parentFile?.mkdirs()
                    if (!linkFile.exists()) {
                        // android.system.Os.symlink — доступен с API 21 (minSdk 24)
                        Os.symlink(target, linkFile.absolutePath)
                    }
                } catch (e: Exception) {
                    // на некоторых устройствах symlink запрещён — пропускаем
                    Log.w(tag, "symlink skip: $link -> $target ($e)")
                }
            }
        }

        // Маркер ставим только после успешной распаковки.
        if (!bootstrapMarker().createNewFile()) {
            throw IllegalStateException("marker exists after install")
        }
        Log.i(tag, "bootstrap installed OK (abi=${abi()}, asset=$assetName)")
    }

    // ── Процесс и стриминг ───────────────────────────────────────────────────

    private fun startProcess(cmd: String, cwd: String?): Process {
        val prefix = prefixDir().absolutePath
        val home = homeDir().absolutePath
        val shell = "$prefix/bin/bash"
        val shellFallback = "/system/bin/sh"

        val pb = ProcessBuilder(listOf(shell, "-c", cmd))
        pb.directory(File(cwd ?: home))
        pb.environment()["PREFIX"] = prefix
        pb.environment()["HOME"] = home
        pb.environment()["PATH"] = "$prefix/bin:$prefix/bin/applets:" + (System.getenv("PATH") ?: "/system/bin:/system/xbin")
        pb.environment()["LD_LIBRARY_PATH"] = "$prefix/lib"
        pb.redirectErrorStream(true)
        return try {
            pb.start()
        } catch (e: Exception) {
            // bash не запустился (повреждён/не X) — пробуем системный sh.
            val fb = ProcessBuilder(shellFallback, "-c", cmd)
            fb.directory(pb.directory())
            fb.environment().putAll(pb.environment())
            fb.redirectErrorStream(true)
            fb.start()
        }
    }

    // java.lang.Process.pid() — Java 9+, в Android SDK нет. Берём PID рефлексией
    // к приватному полю `pid` реализации (ProcessImpl на ART), как это делает Termux.
    private fun safePid(proc: Process): Int = try {
        val f = proc.javaClass.getDeclaredField("pid")
        f.isAccessible = true
        f.getInt(proc)
    } catch (e: Exception) { 0 }

    private fun streamOutput(id: Int, proc: Process) {
        GlobalScope.launch(Dispatchers.IO) {
            try {
                val reader = proc.inputStream.bufferedReader()
                val buf = CharArray(2048)
                val sb = StringBuilder()
                while (true) {
                    val n = reader.read(buf)
                    if (n <= 0) break
                    sb.append(buf, 0, n)
                    if (sb.length >= 2048) {
                        val chunk = sb.toString()
                        sb.setLength(0)
                        sendOnMain("onOutput", id, chunk)
                    }
                }
                if (sb.isNotEmpty()) sendOnMain("onOutput", id, sb.toString())
                val code = proc.waitFor()
                sendOnMain("onExit", id, "", code)
            } catch (e: Exception) {
                sendOnMain("onExit", id, "", -1)
            } finally {
                sessions.remove(id)
            }
        }
    }

    private fun sendOnMain(event: String, id: Int, data: String, code: Int = 0) {
        GlobalScope.launch(Dispatchers.Main) {
            if (event == "onOutput") sendEvent("onOutput", mapOf("sessionId" to id, "data" to data))
            else sendEvent("onExit", mapOf("sessionId" to id, "code" to code))
        }
    }
}