package ml.bkoquad.hub;

import android.content.Context;
import android.content.SharedPreferences;

/** Configuration du collecteur : 1 téléphone d'entreprise = 1 site + 1 line_id. */
public final class Prefs {
    private static final String FILE = "bko_hub";

    private Prefs() {}

    private static SharedPreferences of(Context ctx) {
        return ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public static boolean isConfigured(Context ctx) {
        SharedPreferences p = of(ctx);
        return !p.getString("access", "").isEmpty()
                && !p.getString("refresh", "").isEmpty()
                && p.getInt("line_id", 0) > 0;
    }

    public static void save(Context ctx, String hub, String site, int lineId,
                            String access, String refresh) {
        of(ctx).edit()
                .putString("hub", hub)
                .putString("site", site)
                .putInt("line_id", lineId)
                .putString("access", access)
                .putString("refresh", refresh)
                .apply();
    }

    public static String hub(Context ctx) {
        String h = of(ctx).getString("hub", "https://hub.bko-quad.ml/");
        return h.endsWith("/") ? h : h + "/";
    }

    public static String site(Context ctx) { return of(ctx).getString("site", "Bamako"); }
    public static int lineId(Context ctx) { return of(ctx).getInt("line_id", 0); }
    public static String access(Context ctx) { return of(ctx).getString("access", ""); }
    public static String refresh(Context ctx) { return of(ctx).getString("refresh", ""); }
    public static long lastTs(Context ctx) { return of(ctx).getLong("last_ts", 0L); }

    public static void setAccess(Context ctx, String access) {
        of(ctx).edit().putString("access", access).apply();
    }

    public static void setLastTs(Context ctx, long ts) {
        of(ctx).edit().putLong("last_ts", ts).apply();
    }

    public static void clear(Context ctx) {
        of(ctx).edit().clear().apply();
    }

    public static boolean battAsked(Context ctx) {
        return of(ctx).getBoolean("batt_asked", false);
    }

    public static void setBattAsked(Context ctx) {
        of(ctx).edit().putBoolean("batt_asked", true).apply();
    }
}
