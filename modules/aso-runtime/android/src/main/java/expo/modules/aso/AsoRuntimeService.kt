package expo.modules.aso

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * AsoRuntimeService — foreground service «Агент активен».
 *
 * Держит рантайм-процессы живыми, пока приложение в фоне: system не убивает
 * процессы приложения в foreground-службе. Запускается при первой установке
 * bootstrap (или первой команде), останавливается при kill.
 *
 * Требует в манифесте: android.permission.FOREGROUND_SERVICE (добавляет
 * config plugin) и объявление сервиса с action START_FOREGROUND.
 */
class AsoRuntimeService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createChannel()
        val notification = buildNotification()
        // API 34+ требует типа foreground service для некоторых типов;
        // dataSync подходит для фоновых команд/установки пакетов.
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notification)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val ch = NotificationChannel(CHANNEL_ID, "Агент Aso", NotificationManager.IMPORTANCE_LOW)
            mgr.createNotificationChannel(ch)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pi = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Агент Aso активен")
            .setContentText("Выполняю команды во встроенном Linux-рантайме")
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val CHANNEL_ID = "aso_agent"
        const val NOTIF_ID = 42

        fun start(ctx: Context) {
            val i = Intent(ctx, AsoRuntimeService::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(i)
            } else {
                ctx.startService(i)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, AsoRuntimeService::class.java))
        }
    }
}