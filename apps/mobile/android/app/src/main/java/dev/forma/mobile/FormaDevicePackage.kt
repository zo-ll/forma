package dev.forma.mobile

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class FormaDevicePackage : BaseReactPackage() {
  override fun getModule(name: String, context: ReactApplicationContext): NativeModule? =
    if (name == FormaDeviceModule.NAME) FormaDeviceModule(context) else null
  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(FormaDeviceModule.NAME to ReactModuleInfo(FormaDeviceModule.NAME, FormaDeviceModule.NAME, false, false, false, true))
  }
}
