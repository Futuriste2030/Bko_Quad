package ml.bkoquad.hub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import java.util.List;

/** Notifications système 100 % locales (aucun Firebase) : synchros +
 *  alertes PWA relayées par le pont JS. Le toucher rouvre l'écran Hub. */
public final class Notifier {
    private static final String CHANNEL = "hub";

    private Notifier() {}

    public static boolean allowed(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33) {
            return ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                    == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    public static void show(Context ctx, String title, String body, String route) {
        if (!allowed(ctx)) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Alertes Hub", NotificationManager.IMPORTANCE_DEFAULT));
        Intent it = new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (route != null && !route.isEmpty()) it.putExtra("route", route);
        int code = (int) (System.currentTimeMillis() % 100000);
        PendingIntent pi = PendingIntent.getActivity(ctx, code, it,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(ctx, CHANNEL)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(code, n);
    }

    /** Alertes de synchro : nouveaux appels remontés pendant que l'app est invisible. */
    public static void onSynced(Context ctx, List<CallItem> fresh) {
        if (fresh == null || fresh.isEmpty()) return;
        if (MainActivity.isVisible()) return; // l'utilisateur regarde déjà le Hub
        int missed = 0, inbound = 0, outbound = 0;
        StringBuilder sample = new StringBuilder();
        for (CallItem it : fresh) {
            if ("missed".equals(it.direction)) missed++;
            else if ("inbound".equals(it.direction)) inbound++;
            else if ("outbound".equals(it.direction)) outbound++;
            if (sample.length() < 60) {
                if (sample.length() > 0) sample.append(", ");
                sample.append(it.phoneNumber);
            }
        }
        StringBuilder body = new StringBuilder();
        if (missed > 0) body.append(missed).append(" manqué(s)");
        if (inbound > 0) {
            if (body.length() > 0) body.append(", ");
            body.append(inbound).append(" entrant(s)");
        }
        if (outbound > 0) {
            if (body.length() > 0) body.append(", ");
            body.append(outbound).append(" sortant(s)");
        }
        if (sample.length() > 0) body.append(" — ").append(sample);
        show(ctx, "BKO — " + fresh.size() + " nouvel(s) appel(s)", body.toString(), "/appels");
    }
}
