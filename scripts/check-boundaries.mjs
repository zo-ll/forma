#!/usr/bin/env node
import {builtinModules} from 'node:module';
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const normalize = value => value.replaceAll('\\', '/');
const nodeImport = value => value.startsWith('node:') || builtins.has(value);
const nodeAdapter = value => /(?:^|\/)@forma\/adapters\/node(?:\/|$)|(?:^|\/)packages\/adapters\/(?:src|dist)\/node(?:\/|$)/.test(normalize(value));

function sourceFiles(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

export function validateSource(text, path, owner, coreRoot = resolve(root, 'packages/core/src')) {
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      imports.push(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      imports.push(node.argument.literal);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      imports.push(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      imports.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const value of imports) {
    if (!value || !ts.isStringLiteralLike(value)) throw new Error(`${path}: computed module access is not permitted`);
    const name = value.text;
    if (owner === 'core') {
      const target = relative(coreRoot, resolve(dirname(path), name));
      if (!(name.startsWith('./') || name.startsWith('../')) || target === '..' || target.startsWith('..' + sep) || isAbsolute(target)) {
        throw new Error(`${path}: core import escapes its owner: ${name}`);
      }
    } else if (nodeImport(name) || nodeAdapter(name)) {
      throw new Error(`${path}: Node import reached mobile: ${name}`);
    }
  }
  return imports.length;
}

/** Inspect resolved map entries, not only the mobile client's direct imports. */
export function validateMobileSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0 || sources.some(path => typeof path !== 'string')) {
    throw new Error('The mobile source map must have nonempty string entries');
  }
  for (const original of sources) {
    const path = normalize(original);
    const packageName = path.match(/(?:^|\/)node_modules\/([^/@][^/]*)(?:\/|$)/)?.[1];
    if (/(?:^|\/)node:|(?:^|\/)node\/internal\//.test(path)
      || nodeImport(path) || (packageName && nodeImport(packageName)) || nodeAdapter(path)) {
      throw new Error('Node modules reached the mobile bundle: ' + original);
    }
    if (/(?:^|\/)node_modules\/braces(?:\/|$)/.test(path)) {
      throw new Error('The known build-only braces advisory reached the mobile bundle');
    }
  }
  const required = {
    opSqlite: sources.some(path => path.includes('op-sqlite')),
    mobileHost: sources.some(path => /(?:packages\/mobile-host|@forma\/mobile-host)/.test(normalize(path))),
    deviceSpec: sources.some(path => path.includes('NativeFormaDevice')),
    hostGate: sources.some(path => /mobile\/src\/gate/.test(normalize(path))),
  };
  const missing = Object.entries(required).filter(([, found]) => !found).map(([name]) => name);
  if (missing.length) throw new Error('Required mobile graph modules are missing: ' + missing.join(', '));
  return required;
}

export function checkSourceBoundaries(base = root) {
  const core = resolve(base, 'packages/core/src');
  const mobile = resolve(base, 'apps/mobile');
  const groups = [
    ['core', sourceFiles(core)],
    ['mobile', [...sourceFiles(resolve(mobile, 'src')), resolve(mobile, 'App.tsx'), resolve(mobile, 'index.js')]],
    ['mobile', sourceFiles(resolve(base, 'packages/mobile-host/src'))],
    ['mobile', sourceFiles(resolve(base, 'packages/adapters/src/android'))],
    ['mobile', sourceFiles(resolve(base, 'packages/adapters/src/sqlite'))],
  ];
  let files = 0;
  for (const [owner, paths] of groups) for (const path of paths) {
    validateSource(readFileSync(path, 'utf8'), path, owner, core);
    files++;
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Source boundaries passed (${checkSourceBoundaries()} files).`);
    if (process.argv[2]) {
      const map = JSON.parse(readFileSync(process.argv[2], 'utf8'));
      validateMobileSources(map.sources);
      console.log(`Mobile bundle boundaries passed (${map.sources.length} entries).`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
