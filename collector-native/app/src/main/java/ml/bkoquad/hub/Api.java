package ml.bkoquad.hub;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.List;
import java.util.Scanner;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** Appels directs à l'API Hub (aucune dépendance externe). */
public final class Api {
    private Api() {}

    public static final class Auth {
        public final String access;
        public final String refresh;
        Auth(String access, String refresh) { this.access = access; this.refresh = refresh; }
    }

    public static final class ImportResult {
        public final int created;
        public final int skipped;
        public final java.util.List<CallItem> fresh; // créés : téléphone + direction
        ImportResult(int created, int skipped, java.util.List<CallItem> fresh) {
            this.created = created; this.skipped = skipped; this.fresh = fresh;
        }
    }

    public static final class HttpError extends Exception {
        public final int status;
        HttpError(int status, String body) { super("HTTP " + status + " : " + body); this.status = status; }
    }

    private static String post(String url, String body, String bearer) throws Exception {
        trustLocalDev();
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(20000);
        c.setReadTimeout(20000);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        if (bearer != null && !bearer.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + bearer);
        try (OutputStream os = c.getOutputStream()) {
            os.write(body.getBytes(StandardCharsets.UTF_8));
        }
        int status = c.getResponseCode();
        String resp = "";
        try (Scanner s = new Scanner(status >= 400 ? c.getErrorStream() : c.getInputStream(),
                StandardCharsets.UTF_8.name()).useDelimiter("\\A")) {
            if (s.hasNext()) resp = s.next();
        } catch (Exception ignored) {}
        if (status >= 400) throw new HttpError(status, resp);
        return resp;
    }

    /**
     * Test local uniquement : le Vite dev utilise un certificat auto-signé
     * (basicSsl), absent du magasin système Android. En DEBUG on l'accepte ;
     * en release la validation reste stricte.
     */
    private static void trustLocalDev() {
        if (!BuildConfig.DEBUG) return;
        try {
            TrustManager[] tm = new TrustManager[]{new X509TrustManager() {
                public void checkClientTrusted(X509Certificate[] c, String a) {}
                public void checkServerTrusted(X509Certificate[] c, String a) {}
                public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            }};
            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, tm, new SecureRandom());
            HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());
            HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);
        } catch (Exception ignored) {}
    }

    /** Connexion du compte collecteur (rôle agent) : rend access + refresh. */
    public static Auth login(String hub, String username, String password) throws Exception {
        JSONObject body = new JSONObject();
        body.put("username", username);
        body.put("password", password);
        String resp = post(hub + "api/v1/auth/token/", body.toString(), null);
        JSONObject o = new JSONObject(resp);
        return new Auth(o.getString("access"), o.getString("refresh"));
    }

    public static String refresh(String hub, String refreshToken) throws Exception {
        JSONObject body = new JSONObject();
        body.put("refresh", refreshToken);
        JSONObject o = new JSONObject(post(hub + "api/v1/auth/refresh/", body.toString(), null));
        return o.getString("access");
    }

    /** Remontée collecteur : lots ≤ 500, external_id idempotent côté serveur. */
    public static ImportResult importCalls(String hub, String access, int lineId,
                                          List<CallItem> calls) throws Exception {
        JSONObject body = new JSONObject();
        body.put("line_id", lineId);
        JSONArray arr = new JSONArray();
        for (CallItem it : calls) arr.put(it.toJson());
        body.put("calls", arr);
        JSONObject o = new JSONObject(post(hub + "api/v1/calls/import/", body.toString(), access));
        java.util.List<CallItem> fresh = new java.util.ArrayList<>();
        org.json.JSONArray got = o.optJSONArray("fresh");
        if (got != null) {
            for (int i = 0; i < got.length(); i++) {
                org.json.JSONObject f = got.optJSONObject(i);
                if (f == null) continue;
                fresh.add(new CallItem(f.optString("direction", "missed"),
                        f.optString("phone_number", "?"), "", 0, "", 0));
            }
        }
        return new ImportResult(o.optInt("created", 0), o.optInt("skipped", 0), fresh);
    }
}
