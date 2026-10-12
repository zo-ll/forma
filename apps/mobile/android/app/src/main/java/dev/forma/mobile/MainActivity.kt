package dev.forma.mobile

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Forma"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        override fun getLaunchOptions(): Bundle = Bundle().apply {
          if (BuildConfig.HOST_GATE) {
            val mode = intent.getStringExtra("formaMode")
            val runId = intent.getStringExtra("formaRunId")
            if (mode in setOf("fixtures", "seed", "verify") && runId != null && runId.matches(Regex("[A-Za-z0-9-]{1,128}"))) {
              putString("formaMode", mode)
              putString("formaRunId", runId)
            }
          }
        }
      }
}
