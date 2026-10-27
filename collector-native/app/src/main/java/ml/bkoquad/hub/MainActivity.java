package ml.bkoquad.hub;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.PowerManager;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.content.ContentValues;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;
import android.webkit.GeolocationPermissions;
import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/** Coquille native : config 1 fois, puis WebView plein écran vers la PWA. */
public class MainActivity extends Activity {
    private static final int REQ_CALL_LOG = 41;
    private static final int REQ_WEB = 42;
    private static final int REQ_GEO = 43;
    private static final int REQ_NOTIF = 44;

    private static boolean visible;

    /** Vrai quand l'utilisateur regarde le Hub (pas de notif système redondante). */
    public static boolean isVisible() {
        return visible;
    }

    private WebView web;
    private PermissionRequest pendingWebPerm;
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private int volDownCount;
    private long volDownFirst;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installCrashCatcher();
        // Plus aucune fermeture silencieuse : toute erreur de démarrage
        // s'affiche en plein écran (à photographier / recopier).
        try {
            // L'APK standard est une simple WebView de la PWA : pas de
            // configuration à bloquer, on ouvre directement le Hub.
            if (BuildConfig.IS_COLLECTOR) {
                if (Prefs.isConfigured(this)) showWeb();
                else showConfig();
            } else {
                showWeb();
            }
        } catch (Throwable t) {
            showFatal(t);
        }
        try {
            showCrashIfAny();
        } catch (Throwable ignored) {}
    }

    /** Enregistre tout crash dans crash.log (diagnostic affiché au redémarrage). */
    private void installCrashCatcher() {
        Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            try {
                StringWriter sw = new StringWriter();
                e.printStackTrace(new PrintWriter(sw));
                String report = e.toString() + "\n" + sw;
                if (report.length() > 4000) report = report.substring(0, 4000);
                try (FileOutputStream fos = openFileOutput("crash.log", MODE_PRIVATE)) {
                    fos.write(report.getBytes(StandardCharsets.UTF_8));
                } catch (Exception ignored) {}
            } catch (Exception ignored) {}
            if (prev != null) prev.uncaughtException(t, e);
        });
    }

    private void showCrashIfAny() {
        String report = null;
        try (FileInputStream fis = openFileInput("crash.log")) {
            byte[] buf = new byte[fis.available()];
            if (fis.read(buf) > 0) report = new String(buf, StandardCharsets.UTF_8);
        } catch (Exception ignored) {}
        if (report == null) return;
        deleteFile("crash.log");
        new android.app.AlertDialog.Builder(this)
                .setTitle("Diagnostic — fermeture précédente")
                .setMessage(report)
                .setPositiveButton("OK", null)
                .show();
    }

    /** Écran d'erreur fatale : affiche le diagnostic au lieu de fermer l'app. */
    private void showFatal(Throwable t) {
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));
        String report = "Démarrage impossible :\n" + t + "\n" + sw;
        if (report.length() > 4000) report = report.substring(0, 4000);
        try (FileOutputStream fos = openFileOutput("crash.log", MODE_PRIVATE)) {
            fos.write(report.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {}
        ScrollView scroll = new ScrollView(this);
        TextView v = new TextView(this);
        v.setPadding(32, 32, 32, 32);
        v.setText(report + "\n\nEnvoyez ce texte au support.");
        v.setTextIsSelectable(true);
        scroll.addView(v);
        setContentView(scroll);
    }

    // ---------- Écran de configuration (collecteur uniquement) ----------
    private void showConfig() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout root = vertical();
        root.setBackgroundColor(android.graphics.Color.parseColor("#0f172a"));
        root.setPadding(48, 64, 48, 48);

        TextView brand = new TextView(this);
        brand.setText("BKO Hub");
        brand.setTextSize(30);
        brand.setTypeface(null, android.graphics.Typeface.BOLD);
        brand.setTextColor(android.graphics.Color.parseColor("#ffffff"));
        brand.setPadding(0, 0, 0, 8);
        root.addView(brand);

        TextView sub = new TextView(this);
        sub.setText("Configuration du téléphone collecteur");
        sub.setTextSize(15);
        sub.setTextColor(android.graphics.Color.parseColor("#94a3b8"));
        sub.setPadding(0, 0, 0, 24);
        root.addView(sub);

        // Carte blanche contenant les champs.
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackgroundColor(android.graphics.Color.parseColor("#ffffff"));
        card.setPadding(32, 32, 32, 32);
        android.graphics.drawable.GradientDrawable gd = new android.graphics.drawable.GradientDrawable();
        gd.setColor(android.graphics.Color.parseColor("#ffffff"));
        gd.setCornerRadius(24f);
        card.setBackground(gd);

        TextView cardTitle = new TextView(this);
        cardTitle.setText("Compte collecteur");
        cardTitle.setTextSize(18);
        cardTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        cardTitle.setTextColor(android.graphics.Color.parseColor("#0f172a"));
        cardTitle.setPadding(0, 0, 0, 4);
        card.addView(cardTitle);
        TextView cardHint = new TextView(this);
        cardHint.setText("Téléphone d'entreprise — rôle agent. Configuration unique, verrouillée ensuite.");
        cardHint.setTextSize(12);
        cardHint.setTextColor(android.graphics.Color.parseColor("#64748b"));
        cardHint.setPadding(0, 0, 0, 16);
        card.addView(cardHint);

        // URL du serveur : écrite automatiquement, l'utilisateur n'y touche pas.
        EditText hub = fieldStyled(card, "Adresse du Hub (automatique)", "https://app.bkoquad.ml/");
        hub.setText("https://app.bkoquad.ml/");
        hub.setEnabled(false);
        hub.setTextColor(android.graphics.Color.parseColor("#475569"));

        EditText user = fieldStyled(card, "Nom d'utilisateur", "Ex. collecteur-bamako");
        EditText pass = fieldStyled(card, "Mot de passe", "••••••••");
        pass.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        EditText site = fieldStyled(card, "Site (Bamako / Abidjan)", "Bamako");
        site.setText("Bamako");
        EditText line = fieldStyled(card, "line_id (voir API /lines/)", "Ex. 1");
        line.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);

        TextView err = new TextView(this);
        err.setTextColor(android.graphics.Color.parseColor("#ef4444"));
        err.setPadding(0, 16, 0, 0);

        Button save = new Button(this);
        save.setText("Enregistrer et démarrer");
        save.setTextColor(android.graphics.Color.parseColor("#ffffff"));
        save.setBackgroundColor(android.graphics.Color.parseColor("#E8590C"));
        save.setPadding(24, 24, 24, 24);
        save.setOnClickListener(v -> {
            err.setText("Connexion…");
            err.setTextColor(android.graphics.Color.parseColor("#94a3b8"));
            String hubUrl = hub.getText().toString().trim();
            new Thread(() -> {
                try {
                    Api.Auth auth = Api.login(hubUrl.endsWith("/") ? hubUrl : hubUrl + "/",
                            user.getText().toString().trim(), pass.getText().toString());
                    int lineId = Integer.parseInt(line.getText().toString().trim());
                    Prefs.save(MainActivity.this, hubUrl,
                            site.getText().toString().trim(), lineId,
                            auth.access, auth.refresh);
                    Prefs.setLastTs(MainActivity.this, System.currentTimeMillis());
                    Sync.schedule(MainActivity.this);
                    runOnUiThread(this::showWeb);
                } catch (Exception e) {
                    runOnUiThread(() -> {
                        err.setTextColor(android.graphics.Color.parseColor("#ef4444"));
                        err.setText("Échec : " + e.getMessage());
                    });
                }
            }).start();
        });

        card.addView(save);
        card.addView(err);
        root.addView(card);

        TextView footer = new TextView(this);
        footer.setText("Support : triple appui volume-bas pour rouvrir la configuration.");
        footer.setTextSize(11);
        footer.setTextColor(android.graphics.Color.parseColor("#64748b"));
        footer.setPadding(0, 24, 0, 0);
        root.addView(footer);

        scroll.addView(root);
        setContentView(scroll);
    }

    private EditText fieldStyled(LinearLayout root, String label, String placeholder) {
        TextView l = new TextView(this);
        l.setText(label);
        l.setTextSize(13);
        l.setTypeface(null, android.graphics.Typeface.BOLD);
        l.setTextColor(android.graphics.Color.parseColor("#0f172a"));
        l.setPadding(0, 12, 0, 4);
        root.addView(l);
        EditText e = new EditText(this);
        e.setHint(placeholder);
        e.setPadding(16, 16, 16, 16);
        e.setBackgroundColor(android.graphics.Color.parseColor("#f1f5f9"));
        root.addView(e);
        return e;
    }

    // ---------- Écran principal : la PWA en plein écran, rien d'autre ----------
    // Synchro 100 % automatique : au démarrage + fond toutes les 15 min.
    // Config verrouillée : triple appui volume-bas pour la rouvrir (support).
    private void showWeb() {
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setGeolocationEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.getSettings().setSupportMultipleWindows(true);
        // Téléchargements déclenchés par la PWA (PDF, exports).
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "Téléchargement impossible.", Toast.LENGTH_SHORT).show();
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript("window.BkoQuad={isNativeApp:true};", null);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleExternalUrl(url);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Test local uniquement : le Vite dev utilise un certificat
                // auto-signé (basicSsl). En prod (HTTPS public), refusé.
                if (BuildConfig.DEBUG) handler.proceed();
                else handler.cancel();
            }
        });
        // Autorisations demandées par la PWA (onboarding, scanner QR) :
        // sans WebChromeClient, la WebView les refuse sans rien afficher.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // window.open(...) dans la PWA : on délége au handler d'URL externe
                // plutôt que de créer une nouvelle WebView (qui serait invisible).
                try {
                    WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                    if (transport != null) {
                        WebView newView = new WebView(MainActivity.this);
                        newView.setWebViewClient(new WebViewClient() {
                            @Override
                            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                                return MainActivity.this.shouldOverrideUrlLoading(web, url);
                            }
                        });
                        transport.setWebView(newView);
                        resultMsg.sendToTarget();
                    }
                } catch (Exception ignored) {}
                return true;
            }
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                java.util.List<String> need = new java.util.ArrayList<>();
                for (String res : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                            && checkSelfPermission(Manifest.permission.CAMERA)
                            != PackageManager.PERMISSION_GRANTED) {
                        need.add(Manifest.permission.CAMERA);
                    }
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                            && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                            != PackageManager.PERMISSION_GRANTED) {
                        need.add(Manifest.permission.RECORD_AUDIO);
                    }
                }
                if (need.isEmpty()) {
                    request.grant(request.getResources());
                } else {
                    pendingWebPerm = request;
                    requestPermissions(need.toArray(new String[0]), REQ_WEB);
                }
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeoOrigin = origin;
                    pendingGeoCallback = callback;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION},
                            REQ_GEO);
                }
            }
        });
        // Pont PWA -> natif : window.BkoNative.notify(titre, texte, route).
        web.addJavascriptInterface(new BkoBridge(this), "BkoNative");
        String route = getIntent().getStringExtra("route");
        if (route != null && !route.isEmpty()) {
            web.loadUrl(Prefs.hub(this) + route.replaceFirst("^/", ""));
        } else {
            web.loadUrl(Prefs.hub(this));
        }
        setContentView(web);

        if (BuildConfig.IS_COLLECTOR) {
            if (checkSelfPermission(Manifest.permission.READ_CALL_LOG)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.READ_CALL_LOG,
                        Manifest.permission.READ_PHONE_STATE}, REQ_CALL_LOG);
            } else {
                autoSync();
            }
            // Temps réel : observateur du journal (notification permanente).
            try {
                startForegroundService(new Intent(this, SyncService.class));
            } catch (Exception e) {
                Toast.makeText(this, "Service temps réel non démarré : " + e.getMessage(),
                        Toast.LENGTH_LONG).show();
            }
            askBatteryOnce();
            Sync.schedule(this);
        }
        // Notifications système locales (pont JS + synchros), Android 13+.
        if (android.os.Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF);
        }
    }

    /** Ouvre les liens externes (WhatsApp, tel, mailto, autres sites) dans l'app dédiée. */
    public boolean handleExternalUrl(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        if (lower.startsWith("whatsapp:") || lower.startsWith("tel:") || lower.startsWith("mailto:")
                || lower.startsWith("sms:") || lower.contains("wa.me/") || lower.contains("api.whatsapp.com/")) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "Impossible d'ouvrir le lien.", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            String hub = Prefs.hub(MainActivity.this);
            if (hub != null && !url.startsWith(hub)) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Impossible d'ouvrir le lien.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        }
        return false;
    }

    /** Impression de la page courante. */
    public void printPage() {
        if (web == null) return;
        try {
            // Android WebView gère window.print() via le PrintManager.
            web.evaluateJavascript("window.print()", null);
        } catch (Exception e) {
            Toast.makeText(this, "Impression impossible : " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    /** Télécharge une URL (avec jeton Bearer) et enregistre dans les Téléchargements. */
    public void downloadUrl(String url, String filename, String token) {
        new Thread(() -> {
            try {
                java.net.URL u = new java.net.URL(url);
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) u.openConnection();
                if (token != null && !token.isEmpty()) {
                    c.setRequestProperty("Authorization", "Bearer " + token);
                }
                c.connect();
                java.io.InputStream in = c.getInputStream();
                java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) baos.write(buf, 0, n);
                in.close();
                saveBytes(baos.toByteArray(), filename, c.getContentType());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(this, "Téléchargement impossible : " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    /** Enregistre des octets dans les Téléchargements. */
    private void saveBytes(byte[] data, String filename, String mime) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "application/pdf" : mime);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os != null) os.write(data);
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, values, null, null);
                    runOnUiThread(() -> Toast.makeText(this, "Fichier enregistré : " + filename, Toast.LENGTH_SHORT).show());
                }
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (dir != null && !dir.exists()) dir.mkdirs();
                File out = new File(dir, filename);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(data);
                }
                runOnUiThread(() -> Toast.makeText(this, "Fichier enregistré : " + filename, Toast.LENGTH_SHORT).show());
            }
        } catch (Exception e) {
            runOnUiThread(() -> Toast.makeText(this, "Enregistrement impossible : " + e.getMessage(), Toast.LENGTH_LONG).show());
        }
    }

    /** Enregistre un fichier (base64) dans les Téléchargements. */
    public void saveFile(String base64, String filename, String mime) {
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            saveBytes(data, filename, mime == null ? "application/pdf" : mime);
        } catch (Exception e) {
            runOnUiThread(() -> Toast.makeText(this, "Enregistrement impossible : " + e.getMessage(), Toast.LENGTH_LONG).show());
        }
    }
        try {
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "application/octet-stream" : mime);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os != null) os.write(data);
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, values, null, null);
                    Toast.makeText(this, "Fichier enregistré : " + filename, Toast.LENGTH_SHORT).show();
                }
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (dir != null && !dir.exists()) dir.mkdirs();
                File out = new File(dir, filename);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(data);
                }
                Toast.makeText(this, "Fichier enregistré : " + filename, Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "Enregistrement impossible : " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    /** Synchro silencieuse : seul un échec s'affiche (toast bref). */
    private void autoSync() {
        new Thread(() -> {
            String msg;
            try {
                msg = Sync.run(MainActivity.this);
            } catch (Throwable t) {
                msg = "Échec synchro : " + t;
            }
            if (!msg.startsWith("Synchro OK") && !msg.equals("Rien de nouveau à envoyer.")) {
                String out = msg;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, out, Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    /** Exemption batterie demandée une seule fois (sinon l'OS tue le fond). */
    private void askBatteryOnce() {
        if (Prefs.battAsked(this)) return;
        Prefs.setBattAsked(this);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            new android.app.AlertDialog.Builder(this)
                    .setTitle("Arrière-plan")
                    .setMessage("Pour remonter les appels même app fermée, désactivez l'optimisation batterie pour BKO Collecteur.")
                    .setPositiveButton("OK", (d, w) -> askBatteryExemption())
                    .setNegativeButton("Plus tard", null)
                    .show();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        // L'app déjà ouverte ne repasse pas par onCreate : resynchronise
        // à chaque retour au premier plan (collecteur + permission OK).
        if (BuildConfig.IS_COLLECTOR && Prefs.isConfigured(this)
                && checkSelfPermission(Manifest.permission.READ_CALL_LOG)
                == PackageManager.PERMISSION_GRANTED) {
            autoSync();
        }
    }

    @Override
    protected void onPause() {
        visible = false;
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // Touché d'une notification : ouvre l'écran Hub demandé.
        String route = intent.getStringExtra("route");
        if (web != null && route != null && !route.isEmpty()) {
            web.loadUrl(Prefs.hub(this) + route.replaceFirst("^/", ""));
        }
    }
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_VOLUME_DOWN
                && event.getAction() == KeyEvent.ACTION_DOWN) {
            long now = System.currentTimeMillis();
            if (now - volDownFirst > 2000) {
                volDownCount = 0;
                volDownFirst = now;
            }
            if (++volDownCount >= 3) {
                volDownCount = 0;
                new android.app.AlertDialog.Builder(this)
                        .setTitle("Support")
                        .setMessage("Rouvrir la configuration (ligne, compte) ?")
                        .setPositiveButton("Oui", (d, w) -> {
                            Prefs.clear(this);
                            if (web != null) web.clearHistory();
                            showConfig();
                        })
                        .setNeutralButton("Rattraper 24 h", (d, w) -> {
                            // Reprend les appels des dernières 24 h (ex. test
                            // passé avant le curseur), sans toucher au reste.
                            Prefs.setLastTs(this,
                                    System.currentTimeMillis() - 24L * 3600_000L);
                            autoSync();
                        })
                        .setNegativeButton("Non", null)
                        .show();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    /** Tecno / Infinix / Xiaomi / Huawei tuent le fond par défaut : demander l'exemption. */
    private void askBatteryExemption() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            try {
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_CALL_LOG) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                autoSync();
            } else {
                Toast.makeText(this, "Journal d'appels refusé : collecte impossible (voir paramètres Android).",
                        Toast.LENGTH_LONG).show();
            }
        }
        if (code == REQ_WEB && pendingWebPerm != null) {
            java.util.List<String> granted = new java.util.ArrayList<>();
            for (String res : pendingWebPerm.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                        && checkSelfPermission(Manifest.permission.CAMERA)
                        == PackageManager.PERMISSION_GRANTED) {
                    granted.add(res);
                }
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                        && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED) {
                    granted.add(res);
                }
            }
            if (granted.isEmpty()) pendingWebPerm.deny();
            else pendingWebPerm.grant(granted.toArray(new String[0]));
            pendingWebPerm = null;
        }
        if (code == REQ_GEO && pendingGeoCallback != null) {
            boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
            pendingGeoCallback.invoke(pendingGeoOrigin, ok, false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.getVisibility() == View.VISIBLE && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private LinearLayout vertical() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(32, 32, 32, 32);
        return l;
    }

    private TextView title(String t) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(20);
        return v;
    }

    private TextView hint(String t) {
        TextView v = new TextView(this);
        v.setText(t);
        return v;
    }

    private EditText field(LinearLayout root, String label, String placeholder) {
        TextView l = new TextView(this);
        l.setText(label);
        root.addView(l);
        EditText e = new EditText(this);
        e.setHint(placeholder);
        root.addView(e);
        return e;
    }
}
