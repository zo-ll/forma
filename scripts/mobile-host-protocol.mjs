/** Pure result validation shared by the device runner and Node regressions. */
export function validateHostResult(result, metadata, mode, runId, count) {
  if (!result || result.ok !== true || result.mode !== mode || result.runId !== runId
    || result.sourceHead !== metadata.sourceHead || result.sourceDigest !== metadata.sourceDigest
    || result.dirty !== metadata.dirty || result.fixtureCount !== metadata.fixtureCount
    || result.reactNative !== metadata.reactNative || result.opSqlite !== metadata.opSqlite
    || result.count !== count) {
    throw new Error('Native host result failed validation: ' + JSON.stringify(result));
  }
}
export function validateRestart(seedPid, verifyPid) {
  if (typeof seedPid !== 'string' || typeof verifyPid !== 'string'
    || !/^\d+$/.test(seedPid) || !/^\d+$/.test(verifyPid) || seedPid === verifyPid) {
    throw new Error('Restart verification requires distinct valid process IDs.');
  }
}
