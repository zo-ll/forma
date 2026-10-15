#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHostResult, validateRestart, validateSqliteBuildOptions } from './mobile-host-protocol.mjs';
import { checkSourceBoundaries, validateMobileSources } from './check-boundaries.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps/mobile');
const android = join(app, 'android');
// Marked results directory outside the repository.
const resultsDir = resolve('/tmp/forma-mobile-host-results');
const resultsMarker = join(resultsDir, '.forma-mobile-host-results');
const devicePackage = 'dev.forma.mobile.hostgate';
const activity = devicePackage + '/dev.forma.mobile.MainActivity';
const metadataPath = join(app, 'mobile-build.json');
// Relative path inside the repository; excluded from the source fingerprint.
const metadataRepoPath = 'apps/mobile/mobile-build.json';
const MODE_COUNTS = Object.freeze(JSON.parse(readFileSync(join(app, 'host-gate-counts.json'), 'utf8')));
const FIXTURE_COUNT = MODE_COUNTS.fixtures;
const REACT_NATIVE = '0.87.1';
const OP_SQLITE = '18.2.5';
const METADATA_RESULT_PREFIX = 'FORMA_HOST_RESULT ';
const READY_PREFIX = 'FORMA_HOST_READY ';

function run(executable, args, cwd = root, timeout) {
  const result = spawnSync(executable, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 30 * 1024 * 1024, timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(executable + ' exited ' + result.status + '\n' + result.stdout + result.stderr);
  }
  return result.stdout;
}

function read(path) {
  return readFileSync(path, 'utf8');
}
function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Tracked and untracked non-ignored files, except the generated metadata file. */
function repositoryState() {
  const sourceHead = run('git', ['rev-parse', 'HEAD']).trim();
  const porcelain = run('git', ['status', '--porcelain']).split('\n')
    .filter((line) => line.length > 0 && line.slice(3).trim() !== metadataRepoPath);
  const dirty = porcelain.length > 0;
  const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0').filter(Boolean).sort().filter((path) => path !== metadataRepoPath);
  const digest = createHash('sha256');
  for (const path of files) {
    digest.update(path + '\0');
    digest.update(readFileSync(join(root, path)));
  }
  return { sourceHead, dirty, sourceDigest: digest.digest('hex') };
}

function ensureResultsDir() {
  if (existsSync(resultsDir) && !existsSync(resultsMarker)) {
    throw new Error('Refusing to claim an existing unmarked results directory: ' + resultsDir);
  }
  mkdirSync(resultsDir, { recursive: true });
  if (!existsSync(resultsMarker)) {
    write(resultsMarker, JSON.stringify({ purpose: 'forma mobile host gate results', package: devicePackage }) + '\n');
  }
  const marker = JSON.parse(read(resultsMarker));
  if (marker.package !== devicePackage) {
    throw new Error('Refusing to write an unmarked results directory: ' + resultsDir);
  }
}

function walk(directory, predicate, output) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, predicate, output);
    else if (predicate(path)) output.push(path);
  }
}

function findHostgateApk() {
  const candidates = [];
  walk(join(android, 'app/build/outputs/apk'), (path) => path.endsWith('.apk'), candidates);
  const apk = candidates.find((path) => path === join(android, 'app/build/outputs/apk/hostgate/release/app-hostgate-release.apk'));
  if (!apk) throw new Error('No hostgate release APK under ' + join(android, 'app/build/outputs/apk'));
  return apk;
}

function findHostgateSourcemap() {
  const candidates = [];
  walk(join(android, 'app/build/generated/sourcemaps/react'),
    (path) => path.endsWith('index.android.bundle.map'), candidates);
  const map = candidates.find((path) => path === join(android, 'app/build/generated/sourcemaps/react/hostgateRelease/index.android.bundle.map'));
  if (!map) throw new Error('No bundle sourcemap under ' + join(android, 'app/build/generated/sourcemaps/react'));
  return map;
}

function requireMetadata() {
  if (!existsSync(metadataPath)) {
    throw new Error('Missing ' + metadataPath + '. Run the build command first.');
  }
  return JSON.parse(read(metadataPath));
}

function validateRepository(metadata, stage) {
  const state = repositoryState();
  if (state.sourceHead !== metadata.sourceHead || state.sourceDigest !== metadata.sourceDigest || state.dirty !== metadata.dirty) {
    throw new Error('The repository changed ' + stage + '. Rebuild the APK.');
  }
}

function build() {
  console.log('Source boundaries passed (' + checkSourceBoundaries() + ' files).');
  console.log(run('npm', ['run', 'build']));
  console.log(run('npm', ['ci'], app));
  write(metadataPath, JSON.stringify({
    ...repositoryState(), fixtureCount: FIXTURE_COUNT, reactNative: REACT_NATIVE, opSqlite: OP_SQLITE,
  }, null, 2) + '\n');
  const metadata = requireMetadata();
  console.log(run('npm', ['run', 'typecheck'], app));
  console.log(run('./gradlew', [
    ':app:assembleHostgateRelease', '-PreactNativeArchitectures=arm64-v8a',
    '--no-daemon', '--max-workers=2', '-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m',
  ], android, 1800000));
  validateRepository(metadata, 'during the build');

  const apk = findHostgateApk();
  const mapPath = findHostgateSourcemap();
  const sources = (JSON.parse(read(mapPath)).sources ?? []);
  const required = validateMobileSources(sources);
  const sqliteBuildOptions = validateSqliteBuildOptions(run('unzip', ['-p', apk, 'lib/arm64-v8a/libop-sqlite.so']));

  const result = {
    ...metadata,
    apk: apk,
    apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex'),
    sourceMap: mapPath,
    sourceMapEntries: sources.length,
    bundleRequired: required,
    sqliteBuildOptions,
    builtAt: new Date().toISOString(),
  };
  ensureResultsDir();
  write(join(resultsDir, 'build-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('APK: ' + apk + '\nSHA256: ' + result.apkSha256);
  console.log('Mobile bundle graph passed (' + sources.length + ' source entries).');
  console.log('Results: ' + join(resultsDir, 'build-results.json'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectDevice() {
  const listed = run('adb', ['devices']).split('\n')
    .filter((line) => /\tdevice$/.test(line)).map((line) => line.split('\t')[0]);
  const device = process.env.ANDROID_SERIAL ?? (listed.length === 1 ? listed[0] : undefined);
  if (!device || !listed.includes(device)) {
    throw new Error('Connect exactly one Android device, or set ANDROID_SERIAL to a connected device.');
  }
  return device;
}

async function deviceRun() {
  const metadata = requireMetadata();
  validateRepository(metadata, 'since the APK was built');
  if (metadata.fixtureCount !== FIXTURE_COUNT) {
    throw new Error('The built metadata does not match the runner fixture count.');
  }
  const device = selectDevice();
  const adb = (args, timeout = 15000) => run('adb', ['-s', device, ...args], root, timeout);
  const apk = findHostgateApk();
  ensureResultsDir();
  const buildResult = JSON.parse(read(join(resultsDir, 'build-results.json')));
  if (buildResult.sourceHead !== metadata.sourceHead || buildResult.sourceDigest !== metadata.sourceDigest
    || buildResult.apkSha256 !== createHash('sha256').update(readFileSync(apk)).digest('hex')) {
    throw new Error('The APK or build evidence changed. Rebuild before installation.');
  }

  const probe = spawnSync('adb', ['-s', device, 'shell', 'pm', 'path', devicePackage], {
    encoding: 'utf8', timeout: 15000,
  });
  if (probe.error) throw probe.error;
  if (probe.status !== 0 && !(probe.status === 1 && !probe.stdout.trim() && !probe.stderr.trim())) {
    throw new Error('Cannot inspect the hostgate package: ' + probe.stdout + probe.stderr);
  }
  const installed = probe.stdout.trim().length > 0;
  if (installed && !process.argv.includes('--replace-test-host')) {
    throw new Error('The hostgate package is already installed. Inspect it before using --replace-test-host.');
  }
  // A timed-out install fails the run. Do not retry or queue new requests.
  console.log(adb(['install', '-r', apk], 240000));

  const runId = randomUUID();
  const results = [];
  let seedPid = null;
  for (const mode of ['fixtures', 'seed', 'verify']) {
    adb(['shell', 'am', 'force-stop', devicePackage]);
    adb(['shell', 'am', 'start', '-n', activity,
      '--es', 'formaMode', mode, '--es', 'formaRunId', runId]);
    let result;
    let pid = null;
    let readyHandled = false;
    const deadline = Date.now() + 240000;
    while (!result && Date.now() < deadline) {
      await sleep(1000);
      try {
        pid = adb(['shell', 'pidof', devicePackage]).trim();
      } catch {
        continue;
      }
      if (!/^\d+$/.test(pid)) continue;
      const lines = adb(['logcat', '--pid=' + pid, '-d', '-v', 'raw', '-s', 'ReactNativeJS:V']).split('\n');
      for (const line of lines) {
        const at = line.indexOf(METADATA_RESULT_PREFIX);
        if (at < 0) continue;
        try {
          const value = JSON.parse(line.slice(at + METADATA_RESULT_PREFIX.length));
          if (value.runId === runId && value.mode === mode) result = value;
        } catch {
          // Not a structured result line.
        }
      }
      if (mode === 'seed' && !readyHandled
        && lines.some((line) => line.includes(READY_PREFIX + runId))) {
        readyHandled = true;
        adb(['shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']);
        await sleep(1500);
        adb(['shell', 'am', 'start', '-n', activity, '--activity-single-top', '--activity-clear-top',
          '--es', 'formaMode', 'seed', '--es', 'formaRunId', runId]);
      }
    }
    if (!result) throw new Error('No result for mode ' + mode + ' within 240 seconds. Inspect hostgate logs.');
    validateHostResult(result, metadata, mode, runId, MODE_COUNTS[mode]);
    if (mode === 'seed') seedPid = pid;
    if (mode === 'verify') validateRestart(seedPid, pid);
    results.push({ ...result, pid });
    console.log(JSON.stringify(results.at(-1)));
  }
  validateRepository(metadata, 'during the device run');
  ensureResultsDir();
  write(join(resultsDir, 'device-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log('Host gate device results saved outside the repository: ' + join(resultsDir, 'device-results.json'));
  console.log('This is a host harness check. It is not UI gate #14 approval.');
}

const command = process.argv[2];
try {
  if (command == null) throw new Error('Usage: node scripts/mobile-host-device.mjs build|run [--replace-test-host]');
  if (command === 'build') build();
  else if (command === 'run') await deviceRun();
  else throw new Error('Unknown command: ' + command);
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
}