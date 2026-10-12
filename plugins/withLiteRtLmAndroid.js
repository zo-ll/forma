const {
  withAndroidManifest,
  withGradleProperties,
  withProjectBuildGradle,
} = require('@expo/config-plugins');

// Add the LiteRT-LM native library entries to the app manifest.
// The AndroidManifest merger needs these entries inside <application>.
function addNativeLibrary(application, name) {
  if (!application['uses-native-library']) {
    application['uses-native-library'] = [];
  }
  const exists = application['uses-native-library'].some(
    (item) => item.$ && item.$['android:name'] === name,
  );
  if (!exists) {
    application['uses-native-library'].push({
      $: {
        'android:name': name,
        'android:required': 'false',
      },
    });
  }
}

// Keep the validation build small. The target phone uses arm64-v8a.
function setGradleProperty(properties, key, value) {
  const existing = properties.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
  } else {
    properties.push({ type: 'property', key, value });
  }
}

// LiteRT-LM 0.18.0 carries Kotlin metadata version 2.4.0. The Kotlin Gradle
// plugin on the buildscript classpath defaults to the React Native version
// (2.1.20). Pin the plugin to android.kotlinVersion. The stdlib uses the same
// property, so the compiler and the stdlib stay in sync.
function pinKotlinGradlePlugin(contents) {
  const unversioned = /classpath\((['"])org\.jetbrains\.kotlin:kotlin-gradle-plugin\1\)/;
  if (!unversioned.test(contents)) {
    return contents;
  }
  return contents.replace(
    unversioned,
    'classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${project.findProperty("android.kotlinVersion") ?: "2.1.20"}")',
  );
}

module.exports = function withLiteRtLmAndroid(config) {
  config = withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];
    if (application) {
      addNativeLibrary(application, 'libOpenCL.so');
      addNativeLibrary(application, 'libvndksupport.so');
    }
    return manifestConfig;
  });

  config = withGradleProperties(config, (gradleConfig) => {
    setGradleProperty(gradleConfig.modResults, 'reactNativeArchitectures', 'arm64-v8a');
    return gradleConfig;
  });

  config = withProjectBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = pinKotlinGradlePlugin(gradleConfig.modResults.contents);
    return gradleConfig;
  });

  return config;
};
