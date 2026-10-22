package ml.bkoquad.hub;

import android.content.Context;
import android.database.Cursor;
import android.provider.CallLog;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Lecture générique tous Android (aucune API constructeur) du journal d'appels. */
public final class CallLogReader {
    private CallLogReader() {}

    /** Les plus récents d'abord (DESC) : la 1re synchro remonte le récent,
     * pas tout l'historique. Plafond 500 en Java (le fournisseur refuse LIMIT). */
    public static List<CallItem> since(Context ctx, int lineId, long sinceMs) {
        List<CallItem> out = new ArrayList<>();
        String[] cols = {CallLog.Calls.NUMBER, CallLog.Calls.TYPE,
                CallLog.Calls.DATE, CallLog.Calls.DURATION};
        // Pas de LIMIT dans le tri : le fournisseur CallLog le refuse
        // (IllegalArgumentException: Invalid token limit). Plafond en Java ci-dessous.
        try (Cursor c = ctx.getContentResolver().query(
                CallLog.Calls.CONTENT_URI, cols,
                CallLog.Calls.DATE + " > ?",
                new String[]{String.valueOf(sinceMs)},
                CallLog.Calls.DATE + " DESC")) {
            if (c == null) return out;
            int iNum = c.getColumnIndex(CallLog.Calls.NUMBER);
            int iType = c.getColumnIndex(CallLog.Calls.TYPE);
            int iDate = c.getColumnIndex(CallLog.Calls.DATE);
            int iDur = c.getColumnIndex(CallLog.Calls.DURATION);
            while (c.moveToNext() && out.size() < 500) {
                String num = c.getString(iNum);
                if (num == null || num.isEmpty()) continue;
                int type = c.getInt(iType);
                // Tous les cas : Entrant = décroché (ici ou ailleurs),
                // Manqué = non décroché / refusé / bloqué / messagerie,
                // Sortant = passé depuis la ligne entreprise.
                String dir;
                if (type == CallLog.Calls.INCOMING_TYPE
                        || type == CallLog.Calls.ANSWERED_EXTERNALLY_TYPE) dir = "inbound";
                else if (type == CallLog.Calls.OUTGOING_TYPE) dir = "outbound";
                else if (type == CallLog.Calls.MISSED_TYPE
                        || type == CallLog.Calls.REJECTED_TYPE
                        || type == CallLog.Calls.BLOCKED_TYPE
                        || type == CallLog.Calls.VOICEMAIL_TYPE) dir = "missed";
                else continue;
                long dateMs = c.getLong(iDate);
                // DURATION est NULL (manqué/refusé/sans réponse) -> 0 s, jamais d'exception.
                int dur = 0;
                if (!c.isNull(iDur)) {
                    try { dur = (int) c.getLong(iDur); } catch (Exception ignored) {}
                }
                String ext = lineId + ":" + dateMs + ":"
                        + Math.abs((num + dateMs).hashCode());
                out.add(new CallItem(dir, num,
                        Instant.ofEpochMilli(dateMs).toString(), dur, ext, dateMs));
            }
        } catch (SecurityException e) {
            // Permission READ_CALL_LOG refusée : lot vide, l'écran demande à nouveau.
        }
        return out;
    }
}
