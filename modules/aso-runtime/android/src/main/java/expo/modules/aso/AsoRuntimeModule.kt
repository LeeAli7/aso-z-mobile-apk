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

    // ── proot: полноценный Linux (Alpine rootfs) как рабочая среда агента ──
    // proot-бинарник статический (не зависит от SELinux-исполняемости app-data),
    // rootfs содержит bash, python3, pip, git, apk — «python не может юзать» уходит.
    private fun prootDir(): File = File(dataRoot(), "proot")

    private fun prootBin(): File = File(prootDir(), "proot")

    private fun rootfsDir(): File = File(dataRoot(), "proot/rootfs")

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

    private fun prootAssetName(): String = when {
        abi() == "arm64-v8a" -> "proot-aarch64-static"
        abi() == "armeabi-v7a" || abi().startsWith("arm") -> "proot-arm-static"
        abi().contains("x86_64") -> "proot-x86_64-static"
        else -> "proot-aarch64-static"
    }

    private fun rootfsAssetName(): String = when {
        abi() == "arm64-v8a" -> "rootfs-aarch64.zip"
        abi() == "armeabi-v7a" || abi().startsWith("arm") -> "rootfs-armv7.zip"
        abi().contains("x86_64") -> "rootfs-x86_64.zip"
        else -> "rootfs-aarch64.zip"
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

        // Открывает список «Оптимизация батареи» (Android 6+).
        // ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS НЕ требует permission
        // REQUEST_IGNORE_BATTERY_OPTIMIZATIONS в манифесте (в отличие от
        // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) — просто показывает
        // системный список приложений, где пользователь выбирает Aso-z.
        AsyncFunction("openBatterySettings") { promise: expo.modules.kotlin.Promise ->
            try {
                val ctx = context()
                val intent = android.content.Intent(
                    android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
                )
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.resolve(false)
            }
        }

        // Открывает системные настройки уведомлений приложения (Android 8+).
        AsyncFunction("openNotificationSettings") { promise: expo.modules.kotlin.Promise ->
            try {
                val ctx = context()
                val intent = android.content.Intent(
                    android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS,
                )
                intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
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

        // Текущий режим среды (без запуска команд): "proot" | "bootstrap" | "toybox" | "unknown".
        // Используется UI, чтобы показать, почему команды идут через toybox (SELinux).
        Function("getRuntimeMode") {
            runtimeMode ?: "unknown"
        }
    }

    // ── Установка bootstrap ───────────────────────────────────────────────────

    private fun installBootstrap() {
        // v2.5.5+: bootstrap теперь содержит python3 (не входит в старые распаковки).
        // Если маркер стоит, но python3 у распакованного bootstrap НЕТ — это старый
        // bootstrap: переустанавливаем (чинит «toybox» у пользователей прошлых версий).
        if (bootstrapMarker().exists()) {
            val py = File(prefixDir(), "bin/python3")
            if (py.exists()) return // свежий bootstrap — ок
            Log.w(tag, "старый bootstrap без python3 — переустанавливаю")
            dataRoot().listFiles()?.forEach { f ->
                if (f.name != ".bootstrap-done" && f.name != "proot") f.deleteRecursively()
            }
            bootstrapMarker().delete()
        }
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

        // apt в официальной сборке Termux зашит на /data/data/com.termux/files/usr:
        // чиним конфиг/ключи/CA сразу после распаковки.
        ensureAptConfig(prefixDir().absolutePath)

        // Mark bootstrap as done only after successful unpack.
        if (!bootstrapMarker().createNewFile()) {
            throw IllegalStateException("marker exists after install")
        }

        // ── proot: бинарник + rootfs (полноценная Linux-среда, python3) ──
        // rootfs и proot НЕ критичны для установки (если собьются при распаковке —
        // останется старый путь toybox/bash), поэтому оборачиваем в try/catch.
        try {
            installProot()
        } catch (e: Exception) {
            Log.e(tag, "proot install failed — остаёмся на bootstrap/toybox", e)
        }

        Log.i(tag, "bootstrap installed OK (abi=${abi()}, asset=$assetName)")
    }

    /** Распаковать proot-бинарник и Alpine rootfs (python3, pip, git, bash, apk). */
        private fun installProot() {
            prootDir().mkdirs()
            rootfsDir().mkdirs()

            // 1) статический proot
            val pName = prootAssetName()
            val pAsset = context().assets.open("proot/$pName")
            val pOut = prootBin()
            pOut.outputStream().use { out -> pAsset.copyTo(out) }
            try { Os.chmod(pOut.absolutePath, 0x1ED /*0755*/) } catch (_: Exception) {}
            Log.i(tag, "proot binary: $pName (${pOut.length()} bytes)")

            // 2) rootfs: zip с одним entry rootfs.tar (tar хранит unix-права).
            // ВАЖНО: не класть .tar.gz в ассеты — aapt/AGP автоматически распаковывает
            // gz при упаковке APK (rootfs-aarch64.tar.gz превращается в .tar), и наш
            // GZIPInputStream-парсер ломается. .zip AGP не трогает (как bootstrap).
            val rName = rootfsAssetName()
            val rAsset = context().assets.open("rootfs/$rName")
            extractRootfsZip(rAsset.buffered(), rootfsDir())
            Log.i(tag, "rootfs installed: $rName")
            // resolv.conf/hosts в офлайн-rootfs отсутствуют — дописываем сразу.
            ensureProotNet()
        }

        /**
         * Распаковка rootfs из zip (внутри — один файл rootfs.tar).
         * Права хранятся в tar-заголовках (ld-musl обязан быть 0755, иначе execve «Permission denied»).
         * Поддержан минимальный USTAR/pax: 'x' (длинные имена), '1' (hardlink), '2' (symlink),
         * '5' (dir), '0'/'\0' (file).
         */
        private fun extractRootfsZip(input: java.io.InputStream, dest: File) {
            val zis = java.util.zip.ZipInputStream(input)
            val entry = zis.nextEntry
            if (entry == null) throw IllegalStateException("rootfs zip is empty")
            extractTar(zis, dest)
        }

        private fun extractTar(tarIn: java.io.InputStream, dest: File) {
            val hdr = ByteArray(512)
            var longName: String? = null
            var paxName: String? = null

            while (true) {
                if (!readFully(tarIn, hdr)) break
                val type = hdr[156].toInt().toChar()
                val size = parseOctal(hdr, 124, 12).toInt()
                val data = ByteArray(size)
                readFully(tarIn, data)
                // выравнивание до 512
                val pad = (512 - size % 512) % 512
                skip(tarIn, pad.toLong())

                when (type) {
                    'x' -> {
                        // pax extended header: "path=<длинное имя>\n"
                        val txt = String(data, Charsets.UTF_8)
                        txt.lineSequence().forEach { line ->
                            val sp = line.indexOf(' ')
                            if (sp > 0 && line.indexOf('=', sp) > 0) {
                                val key = line.substring(sp + 1, line.indexOf('=', sp))
                                if (key == "path") paxName = line.substring(line.indexOf('=', sp) + 1)
                            }
                        }
                    }
                    'L' -> {
                        longName = String(data, Charsets.UTF_8).trimEnd('\u0000')
                    }
                    else -> {
                        var name = longName ?: paxName ?: String(hdr, 0, 100, Charsets.UTF_8).trimEnd('\u0000', ' ')
                        longName = null
                        paxName = null
                        if (name.isEmpty()) break // нулевой блок = конец архива
                        val target = File(dest, name)
                        when (type) {
                            '5' -> {
                                target.mkdirs()
                                try { Os.chmod(target.absolutePath, 0x1ED /*0755*/) } catch (_: Exception) {}
                            }
                            '2' -> {
                                val link = String(hdr, 157, 100, Charsets.UTF_8).trimEnd('\u0000', ' ')
                                target.parentFile?.mkdirs()
                                try { if (!target.exists()) Os.symlink(link, target.absolutePath) } catch (_: Exception) {}
                            }
                            '1' -> {
                                // hardlink: копируем целевой файл (в rootfs их 2: gawk-5.3.1, zipinfo)
                                val link = String(hdr, 157, 100, Charsets.UTF_8).trimEnd('\u0000', ' ')
                                val src = File(dest, link)
                                target.parentFile?.mkdirs()
                                try {
                                    src.copyTo(target, overwrite = true)
                                    chmodTarMode(target, hdr)
                                } catch (_: Exception) {}
                            }
                            else -> {
                                target.parentFile?.mkdirs()
                                target.outputStream().use { out -> out.write(data) }
                                chmodTarMode(target, hdr)
                            }
                        }
                    }
                }
            }
        }

        /**
         * Права из tar-заголовка (поле mode, offset 100). ВАЖНО: ld-musl интерпретатор
         * (/lib/ld-musl-*.so.1) обязан быть 0755, иначе execve падает «Permission denied».
         * Биты exec берём как в архиве; владелец/группа — не нужны (одно приложение).
         */
    private fun chmodTarMode(f: File, hdr: ByteArray) {
        val mode = (parseOctal(hdr, 100, 8).toInt() and 0x1FF) // rwx для user/group/other
        val mode7 = mode and 0x1C0 != 0 // хоть один x-бит (0700) — считаем исполняемым
        val mode1 = mode and 0x1 != 0 // x для all
        val use755 = mode7 || mode1
        try {
            Os.chmod(f.absolutePath, if (use755) 0x1ED /*0755*/ else 0x1A4 /*0644*/)
        } catch (_: Exception) {}
    }

    private fun parseOctal(b: ByteArray, off: Int, len: Int): Long {
        val s = String(b, off, len, Charsets.UTF_8).trimEnd('\u0000', ' ').trim()
        if (s.isEmpty()) return 0
        return s.toLongOrNull(8) ?: 0
    }

    /** Читает ровно size байт или пока не кончится поток. */
    private fun readFully(zis: java.io.InputStream, b: ByteArray): Boolean {
        var off = 0
        while (off < b.size) {
            val n = zis.read(b, off, b.size - off)
            if (n < 0) break
            off += n
        }
        return off > 0
    }

    private fun skip(zis: java.io.InputStream, n: Long) {
        var remaining = n
        val buf = ByteArray(4096)
        while (remaining > 0) {
            val toRead = minOf(remaining, buf.size.toLong()).toInt()
            val read = zis.read(buf, 0, toRead)
            if (read < 0) break
            remaining -= read
        }
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

    /**
     * Чинит apt из официальной сборки Termux: его конфиг жёстко зашит на
     * /data/data/com.termux/files/usr, а наш PREFIX другой — apt падает с
     * «W: Unable to read .../apt.conf.d/ (Permission denied)» и
     * «E: Unable to determine a suitable packaging system type».
     *
     * Решение: переменная APT_CONFIG (документированная опция самого apt) указывает
     * на наш $PREFIX/etc/apt/apt.conf, который задаёт Dir "<наш PREFIX>" — все
     * относительные пути (apt.conf.d, sources.list, var/lib/apt, var/cache/apt)
     * резолвятся от нашего префикса. Дополнительно:
     *  - sources.list с официальным репозиторием Termux (если ни одного источника нет);
     *    [trusted=yes] — когда в архиве нет GPG-ключей Termux (подпись не проверяется).
     *  - CA-бандл из системных сертификатов Android (аналог termux-ca-certificates):
     *    без него TLS-валидация https://packages.termux.dev падает (certificate verify
     *    failed). Отдаём OpenSSL через SSL_CERT_FILE в startProcess.
     * Идемпотентна: дёшево, можно звать на каждом старте (чинит и старые установки).
     */
    private fun ensureAptConfig(prefix: String) {
        try {
            val aptEtc = File(prefix, "etc/apt")
            aptEtc.mkdirs()

            // 1) APT_CONFIG-таргет — всегда актуальный префикс (перезаписываем).
            // Полный набор Dir::* путей, чтобы не упираться в зашитые дефолты Termux.
            val aptConf = File(aptEtc, "apt.conf")
            val configText = """
                Dir "$prefix";
                Dir::State "var/lib/apt";
                Dir::State::status "var/lib/dpkg/status";
                Dir::Cache "var/cache/apt";
                Dir::Cache::archives "var/cache/apt/archives";
                Dir::Etc "etc/apt";
                Dir::Etc::main "apt.conf";
                Dir::Etc::parts "apt.conf.d";
                Dir::Etc::sourcelist "sources.list";
                Dir::Etc::sourceparts "sources.list.d";
                Dir::Etc::trusted "trusted.gpg";
                Dir::Etc::trustedparts "trusted.gpg.d";
                Dir::Log "var/log/apt";
            """.trimIndent() + "\n"
            if (!aptConf.exists() || aptConf.readText() != configText) aptConf.writeText(configText)

            // 2) sources.list — только если ни одного источника нет.
            val hasSources = File(aptEtc, "sources.list").exists() ||
                File(aptEtc, "sources.list.d").let { it.isDirectory && it.listFiles()?.isNotEmpty() == true }
            if (!hasSources) {
                val hasKeys =
                    File(aptEtc, "trusted.gpg.d").listFiles()?.any { it.name.endsWith(".gpg") } == true ||
                        File(aptEtc, "keys").listFiles()?.any { it.name.endsWith(".gpg") || it.name.endsWith(".key") } == true
                val trust = if (hasKeys) "" else " [trusted=yes]"
                File(aptEtc, "sources.list").writeText(
                    "deb$trust https://packages.termux.dev/apt/termux-main stable main\n"
                )
            }

            // 3) CA-бандл (tls/ в Termux-style). Собираем из системного хранилища Android:
            // /system/etc/security/cacerts/*.0 и /apex/com.android.conscrypt/cacerts/*.0.
            val tlsDir = File(prefix, "etc/tls")
            val certPem = File(tlsDir, "cert.pem")
            if (!certPem.exists()) {
                val dirs = listOf(
                    File("/system/etc/security/cacerts"),
                    File("/apex/com.android.conscrypt/cacerts"),
                )
                val sb = StringBuilder()
                for (d in dirs) {
                    if (!d.isDirectory) continue
                    val files = d.listFiles() ?: continue
                    for (f in files.sortedBy { it.name }) {
                        if (!f.isFile || !f.name.contains(".")) continue
                        try { sb.append(f.readText(Charsets.UTF_8)) } catch (_: Exception) {}
                    }
                }
                if (sb.isNotEmpty()) {
                    tlsDir.mkdirs()
                    certPem.writeText(sb.toString())
                    Log.i(tag, "apt fix: CA-бандл собран в $certPem (${sb.length} байт)")
                }
            }
        } catch (e: Exception) {
            Log.w(tag, "ensureAptConfig: $e")
        }
    }

    // ── Процесс и стриминг ───────────────────────────────────────────────────

    private var runtimeMode: String? = null // "proot" | "bootstrap" | "toybox"

    /**
     * Выбирает рабочую среду агента:
     *   1. proot (Alpine rootfs: python3, pip, bash, git, apk) — полноценный Linux,
     *      работает даже если SELinux блокирует прямой execve из app-data (MIUI).
     *   2. Termux bootstrap (bash/apt) — если proot недоступен/не установился.
     *   3. toybox (/system/bin/sh) — последний шанс.
     * Результат кэшируем на время жизни процесса.
     */
    private fun detectRuntimeMode(): String {
        runtimeMode?.let { return it }

        // ВАЖНО: чиним права bootstrap ДО любого probe. Старые установки (маркер стоит,
        // файлы лежат) после обновления APK теряют +x — probe падал с 126, и мы навсегда
        // уходили в toybox, потому что ensureExecutable вызывался ТОЛЬКО при useBootstrap=true
        // (замкнутый круг: probe=false → чинить некому). Теперь chmod всегда первым.
        if (prefixDir().resolve("bin/bash").exists()) ensureExecutable(prefixDir().absolutePath)

        // proot мог не установиться при апдейте (маркер .bootstrap-done уже был с прошлой
        // версии — installBootstrap не перезапускается). Доустанавливаем, если бинарник
        // или rootfs отсутствуют; при сбое — тихо уходим на bootstrap/toybox.
        if (!prootBin().exists() || !File(rootfsDir(), "bin/sh").exists()) {
            try { installProot() } catch (e: Exception) {
                Log.e(tag, "lazy proot install failed — bootstrap/toybox", e)
            }
        }

        // 1) proot (Alpine rootfs) — теперь ОСНОВНАЯ среда: полноценный Linux
        //    (bash, coreutils, python3, pip, git, curl…) с нативным apk.
        //    apt в Termux-bootstrap зашит на /data/data/com.termux/files/usr и
        //    неработоспособен под нашим PREFIX (Permission denied) — поэтому
        //    bootstrap больше не основной, а лишь запасной вариант.
        // 2) bootstrap (Termux-style bash/apt) — fallback там, где proot не работает.
        // 3) toybox — последний шанс.
        val mode = when {
            probeProotUsable() -> "proot"
            probeBootstrapUsable(prefixDir().absolutePath) -> "bootstrap"
            else -> "toybox"
        }
        runtimeMode = mode
        Log.i(tag, "runtime mode: $mode")
        return mode
    }

    /** proot-среда: статический proot + Alpine rootfs с python3. Полный тест — запуск sh. */
    private fun probeProotUsable(): Boolean {
        val pbin = prootBin()
        if (!pbin.exists()) return false
        val sh = File(rootfsDir(), "bin/sh")
        if (!sh.exists()) return false
        ensureProotNet()
        return try {
            val args = ArrayList<String>()
            args.add(pbin.absolutePath); args.add("-0"); args.add("-r"); args.add(rootfsDir().absolutePath)
            for (sys in listOf("/system", "/dev", "/proc", "/sys", "/storage")) {
                if (File(sys).exists()) { args.add("-b"); args.add("$sys:$sys") }
            }
            args.add("-w"); args.add("/root"); args.add("/bin/sh"); args.add("-c"); args.add("echo ok")
            val p = ProcessBuilder(args).redirectErrorStream(true).start()
            val out = p.inputStream.bufferedReader().readText().trim()
            val code = p.waitFor()
            val ok = code == 0 && out == "ok"
            if (!ok) Log.w(tag, "proot probe fail (exit=$code out=$out) — переключение на bootstrap/toybox")
            ok
        } catch (e: Exception) {
            Log.w(tag, "proot probe exception: $e")
            false
        }
    }

    /**
     * Обеспечивает сеть внутри Alpine-rootfs: собранный офлайн rootfs НЕ содержит
     * /etc/resolv.conf и /etc/hosts — без них apk/pip/git падают с DNS-ошибками.
     * Берём системный resolv.conf Android (если есть), иначе публичные DNS.
     * rootfs в app-data доступен на запись — пишем файлы напрямую (не bind).
     * Идемпотентна: зовём при каждой инициализации proot.
     */
    private fun ensureProotNet() {
        try {
            val etc = File(rootfsDir(), "etc")
            etc.mkdirs()
            val resolv = File(etc, "resolv.conf")
            val content = try {
                val sys = File("/system/etc/resolv.conf")
                if (sys.exists()) {
                    val t = sys.readText(Charsets.UTF_8).trim()
                    if (t.isNotEmpty()) t + "\n" else ""
                } else ""
            } catch (_: Exception) { "" }
            val effective = if (content.isNotEmpty()) content
            else "nameserver 8.8.8.8\nnameserver 1.1.1.1\n"
            val existing = if (resolv.exists()) try { resolv.readText() } catch (_: Exception) { "" } else ""
            if (existing != effective) {
                resolv.writeText(effective)
                Log.i(tag, "proot net: resolv.conf записан (${if (content.isNotEmpty()) "системный" else "fallback DNS"})")
            }
            val hosts = File(etc, "hosts")
            if (!hosts.exists()) {
                hosts.writeText("127.0.0.1 localhost\n::1 localhost\n")
            }
        } catch (e: Exception) {
            Log.w(tag, "ensureProotNet: $e")
        }
    }

    /**
     * Проверяет, может ли система исполнять бинарники bootstrap из app-data.
     * Пробуем bin/bash (реальный файл), а НЕ bin/sh — sh это симлинк из
     * SYMLINKS.txt, который на некоторых устройствах не создаётся, из-за чего
     * probe ложно падал и мы уходили в toybox, хотя Termux-style bootstrap жив.
     * На MIUI (SELinux enforcing) execve файлов с меткой app_data_file запрещён
     * → даже после chmod +x любая команда падает с exit 126 (avc: denied execute).
     * Если bootstrap не исполняем — остаётся toybox (системный PATH).
     */
    private fun probeBootstrapUsable(prefix: String): Boolean {
        val bash = File(prefix, "bin/bash")
        if (!bash.exists()) return false
        return try {
            // ВАЖНО: Termux-бинарники имеют RUNPATH=/data/data/com.termux/files/usr/lib
            // (захардкожен при сборке). У нас PREFIX другой — поэтому запуск обязан
            // идти С LD_LIBRARY_PATH=$prefix/lib (иначе linker64 не найдёт .so по
            // RUNPATH). Раньше probe звал bash БЕЗ окружения → ложный toybox, хотя
            // боевой startProcess (с env) работал. Теперь probe = боевой запуск.
            val pb = ProcessBuilder(listOf(bash.absolutePath, "-c", "echo ok"))
            pb.redirectErrorStream(true)
            pb.environment()["PREFIX"] = prefix
            pb.environment()["TERMUX_PREFIX"] = prefix
            pb.environment()["HOME"] = "$prefix/home"
            pb.environment()["PATH"] = "$prefix/bin:$prefix/bin/applets:/system/bin:/system/xbin"
            pb.environment()["LD_LIBRARY_PATH"] = "$prefix/lib"
            pb.environment()["TMPDIR"] = "$prefix/tmp"
            pb.environment()["TMP"] = "$prefix/tmp"
            val p = pb.start()
            val out = p.inputStream.bufferedReader().readText().trim()
            val code = p.waitFor()
            val ok = code == 0 && out == "ok"
            if (!ok) Log.w(tag, "bootstrap probe fail (exit=$code out=$out) — toybox")
            ok
        } catch (e: Exception) {
            Log.w(tag, "probe bootstrap failed: $e — системный PATH", e)
            false
        }
    }

    private fun startProcess(cmd: String, cwd: String?): Process {
        val prefix = prefixDir().absolutePath
        val home = homeDir().absolutePath
        // Ленивый фикс apt для уже установленных bootstrap (маркер стоит) —
        // создаёт $PREFIX/etc/apt/apt.conf, sources.list и CA-бандл при первом старте.
        ensureAptConfig(prefix)
        val mode = detectRuntimeMode()

        // Рабочая папка команды. Проекты агента живут в files/vibe/<id> — команды
        // должны выполняться ВНУТРИ проекта, чтобы относительные пути
        // (write_file/read_file/list_files, mkdir -p и т.п.) попадали в файлы
        // проекта, а не в $HOME. Если переданный cwd не существует — HOME.
        val workDir = when {
            cwd != null && File(cwd).isDirectory -> cwd
            cwd != null -> {
                Log.w(tag, "cwd не существует: $cwd — использую HOME")
                home
            }
            else -> home
        }

        if (mode == "proot") {
            // Полноценный Linux: Alpine rootfs с python3. Home пользователя пробрасываем
            // внутрь /root — файлы проекта и агентские записи остаются видимыми с обеих сторон.
            val tmpDir = File(rootfsDir(), "tmp")
            try { tmpDir.mkdirs() } catch (_: Exception) {}
            val args = ArrayList<String>()
            args.add(prootBin().absolutePath)
            args.add("-0")
            args.add("-r")
            args.add(rootfsDir().absolutePath)
            // Пробрасываем системные каталоги ТОЛЬКО если они существуют на устройстве
            // (на всех Android они есть; на эмуляторах/хосте может не быть).
            for (sys in listOf("/system", "/dev", "/proc", "/sys", "/storage")) {
                if (File(sys).exists()) { args.add("-b"); args.add("$sys:$sys") }
            }
            args.add("-b"); args.add("$home:/root")
            // Проект агента (files/vibe/<id>) пробрасываем 1:1 — внутри rootfs он
            // виден по ТОМУ ЖЕ абсолютному пути, и команда с cwd=проект работает.
            // Если cwd внутри $HOME — отдельный bind не нужен (home уже в /root).
            val projectCwd = workDir != home && File(workDir).isDirectory
            if (projectCwd) {
                args.add("-b"); args.add("$workDir:$workDir")
            }
            // Внутренний cwd proot: пути под $HOME отображаем на /root/…,
            // проекты — как есть (они забинжены 1:1).
            val prootCwd = when {
                workDir.startsWith(home) -> "/root" + workDir.substring(home.length)
                else -> workDir
            }
            args.add("-w"); args.add(prootCwd)
            args.add("/bin/sh"); args.add("-c"); args.add(cmd)
            val pb = ProcessBuilder(args)
            pb.directory(File(workDir))
            pb.environment()["HOME"] = "/root"
            pb.environment()["PATH"] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
            pb.environment()["TMPDIR"] = "/tmp"
            pb.environment()["TMP"] = "/tmp"
            pb.environment()["SHELL"] = "/bin/sh"
            // Локаль UTF-8, чтобы Python не падал на ASCII-дефолте
            pb.environment()["LANG"] = "C.UTF-8"
            pb.environment()["LC_ALL"] = "C.UTF-8"
            pb.redirectErrorStream(true)
            return pb.start()
        }

        val useBootstrap = mode == "bootstrap"
        // bin/bash ВМЕСТО bin/sh: sh — симлинк из SYMLINKS.txt, на части устройств
        // не создаётся (пропуск symlink'а) → команды падали 127 даже при живом
        // Termux-style bootstrap. bash — реальный файл, всегда на месте.
        val shell = if (useBootstrap) "$prefix/bin/bash" else "/system/bin/sh"
        val shellFallback = "/system/bin/sh"

        // Системные пути Android: toybox-команды (ls, mkdir, sed, find, tar, ps…)
        // работают без нашей песочницы. Если bootstrap исполняем — его bin/ идёт
        // ПЕРВЫМ (bash/apt/python), иначе системный PATH без usr/bin (SELinux).
        val sysPath = "/system/bin:/system/xbin:/product/bin:/apex/com.android.runtime/bin:" +
            "/apex/com.android.art/bin:/system_ext/bin:/odm/bin:/vendor/bin:/vendor/xbin"
        val path = if (useBootstrap) "$prefix/bin:$prefix/bin/applets:$sysPath" else sysPath

        if (useBootstrap && !File(shell).exists()) {
            // совсем старая установка без bash — тащим из toybox
            return ProcessBuilder("/system/bin/sh", "-c", cmd).apply {
                directory(File(workDir))
                environment()["HOME"] = home
                environment()["PATH"] = sysPath
            }.start()
        }

        val pb = ProcessBuilder(listOf(shell, "-c", cmd))
        pb.directory(File(workDir))
        pb.environment()["PREFIX"] = prefix
        pb.environment()["TERMUX_PREFIX"] = prefix
        pb.environment()["HOME"] = home
        pb.environment()["PATH"] = path
        // LD_LIBRARY_PATH указываем только когда bootstrap исполняем: системные
        // toybox-бинарники не зависят от наших lib/, а чужие lib впереди могут поломать их.
        if (useBootstrap) pb.environment()["LD_LIBRARY_PATH"] = "$prefix/lib"
        // apt (Termux-сборка) зашит на /data/data/com.termux/files/usr — перенаправляем
        // его конфиг на наш PREFIX через APT_CONFIG (см. ensureAptConfig).
        if (useBootstrap) pb.environment()["APT_CONFIG"] = "$prefix/etc/apt/apt.conf"
        // CA-бандл из системных сертификатов Android (если собран) — для https-репозитория.
        if (useBootstrap) {
            val certPem = File(prefix, "etc/tls/cert.pem")
            if (certPem.exists()) pb.environment()["SSL_CERT_FILE"] = certPem.absolutePath
        }
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