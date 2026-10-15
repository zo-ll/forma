package dev.forma.mobile

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class FormaDevicePackage : BaseReactPackage() {
  override fun getModule(name: String, context: ReactApplicationContext): NativeModule? = when (name) {
    FormaDeviceModule.NAME -> FormaDeviceModule(context)
    FormaModelsModule.NAME -> FormaModelsModule(context)
    FormaInferenceModule.NAME -> FormaInferenceModule(context)
    else -> null
  }
  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    listOf(FormaDeviceModule.NAME, FormaModelsModule.NAME, FormaInferenceModule.NAME).associateWith { name ->
      ReactModuleInfo(name, name, false, false, false, true)
    }
  }
}
