package ml.bkoquad.hub;

import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

/** Pont PWA -> natif : la PWA appelle window.BkoNative.notify(...)
 *  pour transformer ses alertes (cloche 60 s) en notifications système,
 *  et window.BkoNative.openExternal(url) pour ouvrir un lien externe
 *  (WhatsApp, PDF, etc.) dans l'application dédiée. */
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

    @JavascriptInterface
    public void openExternal(String url) {
        if (url == null || url.trim().isEmpty()) return;
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim())));
        } catch (Exception e) {
            activity.runOnUiThread(() ->
                    Toast.makeText(activity, "Impossible d'ouvrir le lien.", Toast.LENGTH_SHORT).show());
        }
    }

    @JavascriptInterface
    public void printPage() {
        activity.printPage();
    }

    @JavascriptInterface
    public void saveFile(String base64, String filename, String mime) {
        activity.saveFile(base64, filename, mime);
    }
}
