package ml.bkoquad.hub;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** Tâche fond 15 min : réveille la synchro même si l'app est fermée. */
public class SyncJobService extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            Sync.run(this);
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true; // replanifier si interrompu par le système
    }
}
