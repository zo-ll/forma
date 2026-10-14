#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(root, 'scripts/dependency-audit-baseline.json');

export function auditFinding(name, value, lock) {
  if (!value || !['low', 'moderate', 'high', 'critical'].includes(value.severity)
    || !Array.isArray(value.nodes) || value.nodes.length === 0 || !Array.isArray(value.via)) {
    throw new Error(`Invalid audit finding: ${name}`);
  }
  const nodes = value.nodes.map(path => {
    const version = lock.packages?.[path]?.version;
    if (typeof path !== 'string' || typeof version !== 'string') throw new Error(`Unresolved audit node: ${name}`);
    return {path, version};
  }).sort((a, b) => a.path.localeCompare(b.path));
  const via = value.via.map(item => {
    if (typeof item === 'string') return item;
    if (!item || typeof item.url !== 'string' || typeof item.name !== 'string'
      || typeof item.range !== 'string' || typeof item.severity !== 'string') throw new Error(`Invalid advisory: ${name}`);
    return {name: item.name, url: item.url, range: item.range, severity: item.severity};
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {name, severity: value.severity, nodes, via};
}

/** Match installed versions, paths, severity, and every direct/propagated cause. */
export function validateAudit(report, accepted, lock, today = new Date().toISOString().slice(0, 10)) {
  if (!report || report.error || !report.vulnerabilities || Array.isArray(report.vulnerabilities)
    || report.metadata?.vulnerabilities?.total !== Object.keys(report.vulnerabilities).length) {
    throw new Error('The dependency audit has no complete verdict');
  }
  const findings = Object.entries(report.vulnerabilities).map(([name, value]) => auditFinding(name, value, lock));
  if (findings.length && (!accepted || typeof accepted.expires !== 'string' || today > accepted.expires)) {
    throw new Error('The known dependency risk approval is absent or expired');
  }
  for (const finding of findings) {
    if (finding.severity === 'critical' || !accepted.findings.some(item => JSON.stringify(item) === JSON.stringify(finding))) {
      throw new Error(`Unapproved dependency finding: ${finding.name} (${finding.severity})`);
    }
  }
  return findings.length;
}

function check() {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const output = resolve(process.env.FORMA_CI_RESULTS ?? resolve(tmpdir(), 'forma-ci-results'));
  mkdirSync(output, {recursive: true});
  for (const [name, cwd] of [['root', root], ['mobile', resolve(root, 'apps/mobile')]]) {
    const result = spawnSync('npm', ['audit', '--json'], {cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024});
    if (result.error || ![0, 1].includes(result.status)) throw new Error(`${name}: npm audit did not complete`);
    let report;
    try {report = JSON.parse(result.stdout);} catch {throw new Error(`${name}: npm audit returned no JSON verdict`);}
    if (report.error || !report.vulnerabilities || !report.metadata) throw new Error(`${name}: the audit registry returned no verdict`);
    // Only dependency data reaches artifacts, not npm diagnostics or environment variables.
    writeFileSync(resolve(output, `audit-${name}.json`), JSON.stringify({vulnerabilities: report.vulnerabilities, metadata: report.metadata}, null, 2) + '\n');
    const lock = JSON.parse(readFileSync(resolve(cwd, 'package-lock.json'), 'utf8'));
    const count = validateAudit(report, baseline[name], lock);
    if ((count === 0) !== (result.status === 0)) throw new Error(`${name}: audit exit code disagrees with its verdict`);
    console.log(count === 0 ? `${name}: dependency audit clean.`
      : `${name}: ${count} known findings remain; approval expires ${baseline[name].expires}. See docs/ci.md.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {check();} catch (error) {console.error(error.message); process.exitCode = 1;}
}
