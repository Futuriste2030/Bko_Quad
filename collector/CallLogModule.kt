// Module natif générique tous Android (aucune API Samsung) : lit CallLog.Calls.
// external_id = {lineId}:{dateMs}:{hash} -> idempotent côté POST /calls/import/.
package ml.bkoquad.collector;

import android.provider.CallLog
import com.facebook.react.bridge.*

class CallLogModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "CallLogModule"

    @ReactMethod
    fun getCallsSince(lastTs: Double, promise: Promise) {
        try {
            val lineId = 0 // injecté côté JS (AsyncStorage bko.lineId)
            // Tri DESC (plus récents d'abord), plafond côté JS (slice 500).
            // Jamais de LIMIT dans le tri : le fournisseur le refuse.
            val cursor = ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION),
                "${CallLog.Calls.DATE} > ?",
                arrayOf(lastTs.toLong().toString()),
                "${CallLog.Calls.DATE} DESC"
            ) ?: return promise.resolve(Arguments.createArray())
            val out = Arguments.createArray()
            cursor.use {
                val iNum = it.getColumnIndex(CallLog.Calls.NUMBER)
                val iType = it.getColumnIndex(CallLog.Calls.TYPE)
                val iDate = it.getColumnIndex(CallLog.Calls.DATE)
                val iDur = it.getColumnIndex(CallLog.Calls.DURATION)
                while (it.moveToNext()) {
                    val num = it.getString(iNum) ?: continue
                    // Tous les cas : Entrant = décroché, Manqué = non décroché /
                    // refusé / bloqué / messagerie, Sortant = depuis la ligne.
                    val dir = when (it.getInt(iType)) {
                        CallLog.Calls.INCOMING_TYPE,
                        CallLog.Calls.ANSWERED_EXTERNALLY_TYPE -> "inbound"
                        CallLog.Calls.OUTGOING_TYPE -> "outbound"
                        CallLog.Calls.MISSED_TYPE,
                        CallLog.Calls.REJECTED_TYPE,
                        CallLog.Calls.BLOCKED_TYPE,
                        CallLog.Calls.VOICEMAIL_TYPE -> "missed"
                        else -> continue
                    }
                    val dateMs = it.getLong(iDate)
                    val dur = it.getString(iDur)?.toLongOrNull() ?: 0L
                    val m = Arguments.createMap()
                    m.putString("direction", dir)
                    m.putString("phone_number", num)
                    m.putString("started_at", java.time.Instant.ofEpochMilli(dateMs).toString())
                    m.putInt("duration_seconds", dur.toInt())
                    m.putString("external_id", "$lineId:$dateMs:${(num + dateMs).hashCode()}")
                    out.pushMap(m)
                }
            }
            promise.resolve(out)
        } catch (e: Exception) {
            promise.reject("CALLLOG", e.message, e)
        }
    }
}
