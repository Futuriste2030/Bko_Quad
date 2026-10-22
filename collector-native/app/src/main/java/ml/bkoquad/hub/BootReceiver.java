package ml.bkoquad.hub;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Replanifie la synchro fond après redémarrage du téléphone d'entreprise. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                && Prefs.isConfigured(context)) {
            Sync.schedule(context);
        }
    }
}
