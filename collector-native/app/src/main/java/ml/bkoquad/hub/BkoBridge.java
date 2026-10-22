package ml.bkoquad.hub;

import android.webkit.JavascriptInterface;

/** Pont PWA -> natif : la PWA appelle window.BkoNative.notify(...)
 *  pour transformer ses alertes (cloche 60 s) en notifications système. */
public final class BkoBridge {
    private final MainActivity activity;

    public BkoBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void notify(String title, String body, String route) {
        Notifier.show(activity.getApplicationContext(),
                title == null ? "BKO Hub" : title,
                body == null ? "" : body,
                route == null ? "/appels" : route);
    }
}
