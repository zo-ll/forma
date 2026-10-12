package dev.forma.mobile

import com.facebook.react.bridge.ReactApplicationContext
import java.util.TimeZone
import java.util.UUID

class FormaDeviceModule(context: ReactApplicationContext) : NativeFormaDeviceSpec(context) {
  override fun getName() = NAME
  override fun newId(): String = UUID.randomUUID().toString()
  override fun deviceTimeZone(): String = TimeZone.getDefault().id
  override fun isHostGate(): Boolean = BuildConfig.HOST_GATE
  private val preferences = context.getSharedPreferences("forma.preferences.v1", 0)
  override fun readPreferences(): String? = preferences.getString("value", null)
  override fun writePreferences(value: String): Boolean {
    require(value.length <= 4096) { "Preferences exceed the supported size." }
    return preferences.edit().putString("value", value).commit()
  }
  override fun readGateSnapshot(): String? {
    check(BuildConfig.HOST_GATE) { "Test snapshots require the isolated hostgate build." }
    return preferences.getString("gateSnapshot", null)
  }
  override fun writeGateSnapshot(value: String): Boolean {
    check(BuildConfig.HOST_GATE) { "Test snapshots require the isolated hostgate build." }
    require(value.length <= 65536) { "Test snapshot exceeds the supported size." }
    return preferences.edit().putString("gateSnapshot", value).commit()
  }
  companion object { const val NAME = "FormaDevice" }
}
