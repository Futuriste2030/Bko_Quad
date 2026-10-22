package ml.bkoquad.hub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.database.ContentObserver;
import android.net.Uri;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.CallLog;

/**
 * Service avant-plan (notification permanente) : observe le journal d'appels
 * et remonte chaque nouvel appel ~10 s après sa fin. Complète la synchro
 * fond 15 min. Démarré uniquement par la saveur collecteur.
 */
public class SyncService extends Service {
    private static final int NOTIF_ID = 7;
    private static final String CHANNEL = "collecte";
    // L'entrée du journal est écrite à la fin de l'appel avec sa durée
    // définitive : 10 s suffisent, pas besoin d'attendre une minute.
    private static final long DEBOUNCE_MS = 10_000;

    private Handler handler;
    private final Runnable pending = new Runnable() {
        @Override public void run() {
            new Thread(() -> Sync.run(SyncService.this)).start();
        }
    };

    private final ContentObserver observer = new ContentObserver(new Handler(Looper.getMainLooper())) {
        @Override public void onChange(boolean selfChange) { debounce(); }
        @Override public void onChange(boolean selfChange, Uri uri) { debounce(); }
    };

    private void debounce() {
        if (handler == null) return;
        handler.removeCallbacks(pending);
        handler.postDelayed(pending, DEBOUNCE_MS);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.createNotificationChannel(new NotificationChannel(
                    CHANNEL, "Collecte des appels", NotificationManager.IMPORTANCE_LOW));
        }
        Notification notif = new Notification.Builder(this, CHANNEL)
                .setContentTitle("BKO Collecteur")
                .setContentText("Remontée des appels active")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .build();
        startForeground(NOTIF_ID, notif);
        handler = new Handler(Looper.getMainLooper());
        try {
            getContentResolver().registerContentObserver(
                    CallLog.Calls.CONTENT_URI, true, observer);
        } catch (SecurityException ignored) {
            // Permission accordée plus tard : l'observateur se réenregistre
            // au prochain démarrage du service.
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            getContentResolver().unregisterContentObserver(observer);
        } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
