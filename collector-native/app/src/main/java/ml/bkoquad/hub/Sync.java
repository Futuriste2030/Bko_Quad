package ml.bkoquad.hub;

import android.Manifest;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;

import java.util.ArrayList;
import java.util.List;

/** Synchro entreprise : journal -> POST /calls/import/ (lots ≤ 500, refresh auto). */
public final class Sync {
    private Sync() {}

    public static final int JOB_ID = 1001;

    public static String run(Context ctx) {
        if (!Prefs.isConfigured(ctx)) return "Collecteur non configuré.";
        if (!BuildConfig.IS_COLLECTOR) return "Saveur agence : affichage seul, pas de collecte.";
        String hub = Prefs.hub(ctx);
        int lineId = Prefs.lineId(ctx);
        String access = Prefs.access(ctx);

        boolean mayRead = ctx.checkSelfPermission(Manifest.permission.READ_CALL_LOG)
                == PackageManager.PERMISSION_GRANTED;
        List<CallItem> calls = mayRead
                ? CallLogReader.since(ctx, lineId, Prefs.lastTs(ctx))
                : new ArrayList<>();
        if (calls.isEmpty() && !mayRead) return "Permission journal d'appels requise.";
        if (calls.isEmpty()) return "Rien de nouveau à envoyer.";

        try {
            // Curseur = le plus récent envoyé (jamais "maintenant" : sinon
            // les appels du lot non envoyés seraient sautés à jamais).
            long maxTs = Prefs.lastTs(ctx);
            for (CallItem it : calls) maxTs = Math.max(maxTs, it.epochMs);
            try {
                Api.ImportResult r = Api.importCalls(hub, access, lineId, calls);
                Prefs.setLastTs(ctx, maxTs);
                Notifier.onSynced(ctx, r.fresh);
                return "Synchro OK : +" + r.created + ", doublons " + r.skipped + ".";
            } catch (Api.HttpError e) {
                if (e.status != 401) throw e;
                String fresh = Api.refresh(hub, Prefs.refresh(ctx));
                Prefs.setAccess(ctx, fresh);
                Api.ImportResult r = Api.importCalls(hub, fresh, lineId, calls);
                Prefs.setLastTs(ctx, maxTs);
                Notifier.onSynced(ctx, r.fresh);
                return "Synchro OK (session renouvelée) : +" + r.created + ", doublons " + r.skipped + ".";
            }
        } catch (Api.HttpError e) {
            if (e.status == 403) {
                // Rôle insuffisant ou collecte coupée dans Paramètres : inutile
                // de réessayer en boucle, message clair pour l'agence.
                return "Import refusé par le Hub (compte agent requis ou collecte désactivée — voir Paramètres).";
            }
            return "Échec synchro : " + e.getMessage();
        } catch (Exception e) {
            return "Échec synchro : " + e.getMessage();
        }
    }

    /** Planifie la synchro fond toutes les 15 min (persistante au redémarrage). */
    public static void schedule(Context ctx) {
        if (!BuildConfig.IS_COLLECTOR) return;
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, SyncJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15 * 60 * 1000L)
                .setPersisted(true)
                .build();
        js.schedule(job);
    }
}
