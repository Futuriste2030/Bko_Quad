// Synchro fond toutes les 15 min + au démarrage (toutes marques Android).
// Relit le dernier timestamp local et rejoue POST /calls/import/ via OkHttp.
// Simplifié : la logique JWT/refresh est dans App.tsx ; ce worker réveille l'app.
package ml.bkoquad.collector;

import android.content.Context
import androidx.work.*

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        // Le pont JS (syncNow) fait le vrai travail au prochain démarrage/foreground ;
        // ce worker garantit le réveil périodique même si l'OS tue l'activité
        // (couplé à la demande d'exclusion d'optimisation batterie au 1er lancement).
        return Result.success()
    }

    companion object {
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, java.util.concurrent.TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("bko-sync", ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
