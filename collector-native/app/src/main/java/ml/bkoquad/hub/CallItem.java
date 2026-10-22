package ml.bkoquad.hub;

import org.json.JSONObject;

/** Un appel du journal, prêt pour POST /api/v1/calls/import/. */
public final class CallItem {
    public final String direction; // inbound | outbound | missed
    public final String phoneNumber;
    public final String startedAt; // ISO UTC
    public final int durationSeconds;
    public final String externalId; // {line_id}:{dateMs}:{hash} -> idempotent serveur
    public final long epochMs; // date d'appel en ms (curseur de synchro)

    public CallItem(String direction, String phoneNumber, String startedAt,
                    int durationSeconds, String externalId, long epochMs) {
        this.direction = direction;
        this.phoneNumber = phoneNumber;
        this.startedAt = startedAt;
        this.durationSeconds = durationSeconds;
        this.externalId = externalId;
        this.epochMs = epochMs;
    }

    public JSONObject toJson() throws Exception {
        JSONObject o = new JSONObject();
        o.put("direction", direction);
        o.put("phone_number", phoneNumber);
        o.put("started_at", startedAt);
        o.put("duration_seconds", durationSeconds);
        o.put("external_id", externalId);
        return o;
    }
}
