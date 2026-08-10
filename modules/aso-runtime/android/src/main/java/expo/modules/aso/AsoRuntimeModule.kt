package expo.modules.aso

import android.content.Context
import android.os.Build
import android.os.Environment
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
        abi() == "arm64-v8a" -> "bootstrap-aarch64.zip"
        abi() == "armeabi-v7a" || abi().startsWith("arm") -> "bootstrap-arm.zip"
        // x86_64 (эмулятор) — arm64-архив НЕЛЬЗЯ: ELF другой архитектуры -> exec 126.
        abi().contains("x86_64") -> "bootstrap-x86_64.zip"
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

        // execCapture — команда одним вызовом: запуск + сбор вывода + ожидание завершения.
        // Без событий: JS не может потерять onExit (гонка) — результат приходит в promise.
        AsyncFunction("execCapture") { cmd: String, cwd: String?, promise: expo.modules.kotlin.Promise ->
            GlobalScope.launch(Dispatchers.IO) {
                try {
                    require(bootstrapMarker().exists()) { "bootstrap not installed" }
                    AsoRuntimeService.start(context())
                    val proc = startProcess(cmd, cwd)
                    val reader = proc.inputStream.bufferedReader()
                    val sb = StringBuilder()
                    val buf = CharArray(4096)
                    while (true) {
                        val n = reader.read(buf)
                        if (n <= 0) break
                        if (sb.length < 64 * 1024) {
                            sb.append(buf, 0, n)
                            if (sb.length > 64 * 1024) { // оставляем маркер обрезки
                                sb.setLength(64 * 1024)
                                sb.append("\n[вывод обрезан: >64 КБ]\n")
                            }
                        }
                    }
                    val code = proc.waitFor()
                    val out = sb.toString()
                    if (code != 0) {
                        // Логируем КОНКРЕТИКУ: bash всегда пишет причину в вывод
                        // («Permission denied» / «Exec format error» / «cannot execute»).
                        Log.w(tag, "exec exit=$code cmd=$cmd out=${out.trim().takeLast(300)}")
                    }
                    promise.resolve(
                        if (code == 0) mapOf("ok" to true, "output" to out, "code" to code)
                        else mapOf(
                            "ok" to false, "output" to out, "code" to code,
                            "error" to ("exit $code" + if (out.isNotBlank()) ": " + out.trim().takeLast(300) else ""),
                        )
                    )
                } catch (e: Exception) {
                    promise.resolve(mapOf("ok" to false, "output" to "", "code" to -1, "error" to "$e"))
                }
            }
        }

        // Доступ «Все файлы» (MANAGE_EXTERNAL_STORAGE, Android 11+).
        // Приложение может писать в хранилище только после того, как пользователь
        // выдал разрешение в системных настройках. Проверка честная: без диалогов.
        AsyncFunction("hasStorageAccess") { promise: expo.modules.kotlin.Promise ->
            try {
                val ctx = context()
                val ok = if (Build.VERSION.SDK_INT >= 30) {
                    Environment.isExternalStorageManager()
                } else {
                    ctx.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                        android.content.pm.PackageManager.PERMISSION_GRANTED
                }
                promise.resolve(ok)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        // Открывает системный экран разрешения «Все файлы» (Android 11+).
        AsyncFunction("openStorageSettings") { promise: expo.modules.kotlin.Promise ->
            try {
                val ctx = context()
                if (Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager()) {
                    val intent = android.content.Intent(
                        android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    )
                    intent.data = android.net.Uri.parse("package:${ctx.packageName}")
                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    ctx.startActivity(intent)
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        // Переустановка среды: сброс маркера .bootstrap-done + остановка сервиса.
        // При следующей команде bootstrap распакуется ЗАНОВО (chmod, symlinks, shebang,
        // probe) — чинит среды, оставшиеся от старых APK с битыми файлами.
        AsyncFunction("resetBootstrap") { promise: expo.modules.kotlin.Promise ->
            try {
                bootstrapMarker().delete()
                bootstrapMarker().parentFile?.listFiles()?.forEach { f ->
                    if (f.name != ".bootstrap-done") f.deleteRecursively()
                }
                AsoRuntimeService.stop(context())
                promise.resolve(true)
            } catch (e: Exception) {
                promise.resolve(false)
            }
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
            if (abi().contains("x86_64")) {
                // arm-архив на x86_64 не подойдёт (ELF) — честная ошибка вместо 126.
                throw IllegalStateException("нет bootstrap-x86_64.zip в ассетах — соберите x86_64-архив", e)
            }
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
            // ВАЖНО: в SYMLINKS.txt часть целей АБСОЛЮТНЫЕ (/data/data/com.termux/files/usr/... —
            // для Termux PREFIX всегда такой). У нас другой PREFIX — заменяем префикс,
            // иначе симлинк битый и команда падает (126/127).
            val termuxPrefix = "/data/data/com.termux/files/usr"
            val myPrefix = prefixDir().absolutePath
            for ((target, link) in symlinkLines) {
                try {
                    val linkFile = File(prefixDir(), link)
                    linkFile.parentFile?.mkdirs()
                    if (!linkFile.exists()) {
                        val fixedTarget =
                            if (target.startsWith(termuxPrefix)) myPrefix + target.substring(termuxPrefix.length)
                            else target
                        // android.system.Os.symlink — доступен с API 21 (minSdk 24)
                        Os.symlink(fixedTarget, linkFile.absolutePath)
                    }
                } catch (e: Exception) {
                    // на некоторых устройствах symlink запрещён — пропускаем
                    Log.w(tag, "symlink skip: $link -> $target ($e)")
                }
            }

            // fix-shebang: скрипты bootstrap собраны с PREFIX=/data/data/com.termux/files/usr —
            // интерпретатор по этому пути у нас НЕ существует -> «command invoked cannot execute» (126).
            fixShebangs()
        }

        // Маркер ставим только после успешной распаковки.
        if (!bootstrapMarker().createNewFile()) {
            throw IllegalStateException("marker exists after install")
        }
        Log.i(tag, "bootstrap installed OK (abi=${abi()}, asset=$assetName)")
    }

    /**
     * Гарантирует битам исполнения на бинарниках bootstrap.
     * Старые APK (маркер уже стоит, installBootstrap не перезапускается) оставили
     * файлы bin/ без +x → exit 126. Проверка одного файла — дёшево, полный проход
     * — только если прав нет (иначе каждый exec чинил бы всё подряд).
     */
    private fun ensureExecutable(prefix: String) {
        val bash = File(prefix, "bin/bash")
        if (!bash.exists() || bash.canExecute()) return
        Log.w(tag, "бинарники bootstrap без +x — чиню права (bin/, libexec/, apt)")
        val roots = listOf(
            File(prefix, "bin"),
            File(prefix, "libexec"),
            File(prefix, "lib/apt/apt-helper"),
            File(prefix, "lib/apt/methods"),
        )
        for (root in roots) {
            if (!root.isDirectory) continue
            root.walkTopDown().filter { it.isFile }.forEach { f ->
                try { Os.chmod(f.absolutePath, 0x1C0 /*0700*/) } catch (_: Exception) {}
            }
        }
    }

    /**
     * Переписывает shebang скриптов с чужого Termux-PREFIX на наш:
     * `#!/data/data/com.termux/files/usr/bin/sh` → `#!<наш prefix>/bin/sh`.
     * Иначе интерпретатор не существует и команда падает с 126.
     * Правим bin/, libexec/ и скрипты dpkg (нужны для apt).
     */
    private fun fixShebangs() {
        val old = "#!/data/data/com.termux/files/usr/bin/"
        val new = "#!${prefixDir().absolutePath}/bin/"
        val roots = listOf(
            File(prefixDir(), "bin"),
            File(prefixDir(), "libexec"),
            File(prefixDir(), "var/lib/dpkg/info"),
        )
        var fixed = 0
        for (root in roots) {
            if (!root.exists()) continue
            root.walkTopDown().filter { it.isFile }.forEach { f ->
                try {
                    val first = java.io.RandomAccessFile(f, "r").use { raf ->
                        val b = ByteArray(2)
                        if (raf.read(b) < 2) return@forEach
                        if (b[0] != '#'.code.toByte() || b[1] != '!'.code.toByte()) return@forEach
                        raf.seek(0)
                        raf.readLine()
                    } ?: return@forEach
                    if (first.startsWith(old)) {
                        val text = f.readText(Charsets.UTF_8)
                        f.writeText(new + text.substring(old.length))
                        fixed++
                    }
                } catch (_: Exception) {}
            }
        }
        if (fixed > 0) Log.i(tag, "fix-shebang: переписано $fixed скриптов")
    }

    // ── Процесс и стриминг ───────────────────────────────────────────────────

    private var runtimeUsable: Boolean? = null

    /**
     * Проверяет, может ли система исполнять бинарники bootstrap из app-data.
     * На MIUI (SELinux enforcing) execve файлов с меткой app_data_file запрещён
     * → даже после chmod +x любая команда падает с exit 126 (avc: denied execute).
     * Если bootstrap не исполняем — работаем через системный PATH (toybox, ~200
     * команд) и /system/bin/sh. Результат кэшируем на время жизни процесса.
     */
    private fun probeRuntimeUsable(prefix: String): Boolean {
        runtimeUsable?.let { return it }
        val sh = File(prefix, "bin/sh")
        if (!sh.exists()) {
            runtimeUsable = false
            return false
        }
        return try {
            val p = ProcessBuilder(listOf(sh.absolutePath, "-c", "echo ok"))
                .redirectErrorStream(true)
                .start()
            val out = p.inputStream.bufferedReader().readText().trim()
            val code = p.waitFor()
            val ok = code == 0 && out == "ok"
            runtimeUsable = ok
            if (!ok) Log.w(tag, "SELinux блокирует bootstrap (probe exit=$code) — переключаюсь на системный PATH / toybox")
            ok
        } catch (e: Exception) {
            Log.w(tag, "probe bootstrap failed: $e — системный PATH", e)
            runtimeUsable = false
            false
        }
    }

    private fun startProcess(cmd: String, cwd: String?): Process {
        val prefix = prefixDir().absolutePath
        val home = homeDir().absolutePath
        val useBootstrap = probeRuntimeUsable(prefix)
        val shell = if (useBootstrap) "$prefix/bin/bash" else "/system/bin/sh"
        val shellFallback = "/system/bin/sh"

        // Старые установки (маркер .bootstrap-done уже есть) не получали chmod при
        // обновлении APK — бинарники лежат без права на выполнение, любая команда
        // падает с exit 126 (Permission denied). Чиним ДО каждого запуска: быстро
        // проверяем bash, при отсутствии прав — полный проход chmod 0700.
        if (useBootstrap) ensureExecutable(prefix)

        // Системные пути Android: toybox-команды (ls, mkdir, sed, find, tar, ps…)
        // работают без нашей песочницы. Если bootstrap исполняем — его bin/ идёт
        // ПЕРВЫМ (bash/apt/python), иначе системный PATH без usr/bin (SELinux).
        val sysPath = "/system/bin:/system/xbin:/product/bin:/apex/com.android.runtime/bin:" +
            "/apex/com.android.art/bin:/system_ext/bin:/odm/bin:/vendor/bin:/vendor/xbin"
        val path = if (useBootstrap) "$prefix/bin:$prefix/bin/applets:$sysPath" else sysPath

        val pb = ProcessBuilder(listOf(shell, "-c", cmd))
        pb.directory(File(cwd ?: home))
        pb.environment()["PREFIX"] = prefix
        pb.environment()["TERMUX_PREFIX"] = prefix
        pb.environment()["HOME"] = home
        pb.environment()["PATH"] = path
        // LD_LIBRARY_PATH указываем только когда bootstrap исполняем: системные
        // toybox-бинарники не зависят от наших lib/, а чужие lib впереди могут поломать их.
        if (useBootstrap) pb.environment()["LD_LIBRARY_PATH"] = "$prefix/lib"
        // Android-песочница: /tmp как такового нет — даём свой (иначе bash/apt падают).
        val tmpDir = File(prefixDir(), "tmp")
        try { tmpDir.mkdirs() } catch (_: Exception) {}
        pb.environment()["TMPDIR"] = tmpDir.absolutePath
        pb.environment()["TMP"] = tmpDir.absolutePath
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