#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = resolve(process.env.FORMA_ANDROID_TEST_HOST ?? join(tmpdir(), 'forma-storage-fixture-host'));
const packageName = 'dev.forma.storage.fixturehost';
const command = process.argv[2];
function run(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 30 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(executable + ' exited ' + result.status + '\n' + result.stdout + result.stderr);
  return result.stdout;
}
function repositoryState() {
  const sourceHead = run('git', ['rev-parse', 'HEAD']).trim();
  const dirty = run('git', ['status', '--porcelain']).trim().length > 0;
  const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean).sort();
  const digest = createHash('sha256');
  for (const path of files) { digest.update(path + '\0'); digest.update(readFileSync(join(root, path))); }
  return { sourceHead, dirty, sourceDigest: digest.digest('hex') };
}
function read(path) { return readFileSync(path, 'utf8'); }
function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
function prepare() {
  run('npm', ['run', 'build']);
  const marker = join(host, '.forma-test-host.json');
  if (!existsSync(host)) {
    run('npx', ['--yes', '@react-native-community/cli@20.2.0', 'init', 'FormaFixtureHost', '--version', '0.87.1',
      '--directory', host, '--package-name', packageName, '--skip-install', '--skip-git-init', 'true']);
    write(marker, JSON.stringify({ packageName, purpose: 'synthetic-storage-fixtures' }));
  } else if (!existsSync(marker) || JSON.parse(read(marker)).packageName !== packageName) {
    throw new Error('Refusing to modify an unmarked directory: ' + host);
  }
  const manifestPath = join(host, 'package.json');
  const manifest = JSON.parse(read(manifestPath));
  manifest.dependencies['@op-engineering/op-sqlite'] = '18.2.5';
  manifest.dependencies['@forma/core'] = 'file:' + join(root, 'packages/core');
  manifest.dependencies['@forma/adapters'] = 'file:' + join(root, 'packages/adapters');
  write(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(run('npm', ['install'], host));
  copyFileSync(join(root, 'scripts/android/App.tsx'), join(host, 'App.tsx'));
  write(join(host, 'forma-build.json'), JSON.stringify({
    ...repositoryState(), reactNative: '0.87.1', opSqlite: '18.2.5', fixtureCount: 143,
  }, null, 2));
  write(join(host, 'metro.config.js'), `const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('node:path');
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [${JSON.stringify(root)}],
  resolver: {
    extraNodeModules: {'forma-fixtures': ${JSON.stringify(join(root, '.build/tests/fixtures'))}},
    nodeModulesPaths: [path.join(__dirname, 'node_modules'), ${JSON.stringify(join(root, 'node_modules'))}],
  },
});\n`);
  const activity = join(host, 'android/app/src/main/java/dev/forma/storage/fixturehost/MainActivity.kt');
  write(activity, `package dev.forma.storage.fixturehost
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "FormaFixtureHost"
  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
      override fun getLaunchOptions(): Bundle = Bundle().apply {
        putString("formaMode", intent.getStringExtra("formaMode") ?: "fixtures")
        putString("formaRunId", intent.getStringExtra("formaRunId") ?: "manual")
      }
    }
}\n`);
  const appGradle = join(host, 'android/app/build.gradle');
  const freshnessMarker = '// Forma fixture bundle freshness';
  if (!read(appGradle).includes(freshnessMarker)) write(appGradle, read(appGradle) + `
${freshnessMarker}
tasks.matching { it.name == "createBundleReleaseJsAndAssets" }.configureEach {
  outputs.upToDateWhen { false }
  outputs.doNotCacheIf("Fixture sources include external repository directories") { true }
}
`);
  const androidManifest = join(host, 'android/app/src/main/AndroidManifest.xml');
  const xml = read(androidManifest).replace('<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">')
    .replace('<uses-permission android:name="android.permission.INTERNET" />',
      '<uses-permission android:name="android.permission.INTERNET" tools:node="remove" />');
  write(androidManifest, xml);
  console.log('Prepared synthetic test host: ' + host);
}
function build() {
  prepare();
  console.log(run('./gradlew', [':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--no-daemon', '--max-workers=2',
    '-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m'], join(host, 'android')));
  const state = repositoryState(); const metadata = JSON.parse(read(join(host, 'forma-build.json')));
  if (state.sourceHead !== metadata.sourceHead || state.sourceDigest !== metadata.sourceDigest) {
    throw new Error('Repository changed during the build. Rebuild the test host.');
  }
  const mapPath = join(host, 'android/app/build/generated/sourcemaps/react/release/index.android.bundle.map');
  const sources = JSON.parse(read(mapPath)).sources;
  const forbidden = sources.filter((path) => /(?:packages\/adapters\/(?:src|dist)\/node\/|(?:^|\/)node:|\/node\/dist\/database\.js)/.test(path));
  if (forbidden.length) throw new Error('Node modules reached the mobile bundle: ' + forbidden.join(', '));
  const apk = join(host, 'android/app/build/outputs/apk/release/app-release.apk');
  console.log('APK: ' + apk + '\nSHA256: ' + createHash('sha256').update(readFileSync(apk)).digest('hex'));
  console.log('Mobile bundle source check passed (' + sources.length + ' source entries).');
}
async function deviceRun() {
  const metadata = JSON.parse(read(join(host, 'forma-build.json'))); const state = repositoryState();
  if (state.sourceHead !== metadata.sourceHead || state.sourceDigest !== metadata.sourceDigest) {
    throw new Error('The test APK has stale source metadata. Rebuild it before device verification.');
  }
  const listed = run('adb', ['devices']).split('\n').filter((line) => /\tdevice$/.test(line)).map((line) => line.split('\t')[0]);
  const device = process.env.ANDROID_SERIAL ?? (listed.length === 1 ? listed[0] : undefined);
  if (!device || !listed.includes(device)) throw new Error('Connect exactly one phone, or set ANDROID_SERIAL to a connected device.');
  const adb = (args) => run('adb', ['-s', device, ...args]);
  const apk = join(host, 'android/app/build/outputs/apk/release/app-release.apk');
  if (!existsSync(apk)) throw new Error('Build the test APK first.');
  const probe = spawnSync('adb', ['-s', device, 'shell', 'pm', 'path', packageName], { encoding: 'utf8' });
  if (probe.error) throw probe.error;
  // Android pm returns 1 with empty output when the package is absent.
  if (probe.status !== 0 && !(probe.status === 1 && !probe.stdout.trim() && !probe.stderr.trim())) {
    throw new Error('Cannot inspect the test package: ' + probe.stdout + probe.stderr);
  }
  if (probe.stdout.trim() && !process.argv.includes('--replace-test-host')) {
    throw new Error('The test package already exists. Inspect it before using --replace-test-host.');
  }
  console.log(adb(['install', '-r', apk]));
  const results = []; let seedPid;
  for (const mode of ['fixtures', 'seed', 'verify']) {
    adb(['shell', 'am', 'force-stop', packageName]);
    const runId = randomUUID();
    adb(['shell', 'am', 'start', '-n', packageName + '/.MainActivity', '--es', 'formaMode', mode, '--es', 'formaRunId', runId]);
    let result; let pid;
    const deadline = Date.now() + 180000;
    while (!result && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try { pid = adb(['shell', 'pidof', packageName]).trim(); } catch { continue; }
      if (!/^\d+$/.test(pid)) continue;
      const logs = adb(['logcat', '--pid=' + pid, '-d', '-v', 'raw', '-s', 'ReactNativeJS:V']);
      for (const line of logs.split('\n')) {
        const at = line.indexOf('FORMA_STORAGE_RESULT '); if (at < 0) continue;
        try { const value = JSON.parse(line.slice(at + 21)); if (value.runId === runId && value.mode === mode) result = value; } catch { /* Non-result log line. */ }
      }
    }
    if (!result) throw new Error('No result for mode ' + mode + ' within 180 seconds. Inspect the test package logs.');
    if (!result.ok || result.sourceHead !== metadata.sourceHead || result.sourceDigest !== metadata.sourceDigest
      || result.count !== (mode === 'fixtures' ? metadata.fixtureCount : 1)) throw new Error(JSON.stringify(result));
    if (mode === 'seed') seedPid = pid;
    if (mode === 'verify' && pid === seedPid) throw new Error('Restart verification did not use a new process.');
    results.push({ ...result, pid }); console.log(JSON.stringify(results.at(-1)));
  }
  write(join(host, 'device-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('Native fixture and process-restart results saved outside the repository. This is not workout UI gate #14 approval.');
}
try {
  if (command === 'prepare') prepare();
  else if (command === 'build') build();
  else if (command === 'run') await deviceRun();
  else throw new Error('Usage: node scripts/android-test-host.mjs prepare|build|run [--replace-test-host]');
} catch (cause) { console.error(cause instanceof Error ? cause.message : cause); process.exitCode = 1; }
