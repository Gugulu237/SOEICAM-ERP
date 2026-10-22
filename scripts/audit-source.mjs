// Read-only reachability audit. Next entry points and maintenance/test references
// are roots; nothing is deleted by this script. Existing data and env files are
// never read. Literal dynamic imports and file-based source references count.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.json', '.jsonc', '.css'];
const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const sources = walk(path.join(root, 'src')).filter(file => extensions.includes(path.extname(file)));
const maintenance = ['scripts', 'tests'].flatMap(directory => walk(path.join(root, directory))).filter(file => extensions.includes(path.extname(file)));
const files = [...sources, ...maintenance], known = new Set(files), edges = new Map(), unresolved = [];
const relative = file => path.relative(root, file).replaceAll('\\', '/');
function resolve(from, specifier) {
  let base;
  if (specifier.startsWith('@/')) base = path.join(root, 'src', specifier.slice(2));
  else if (specifier.startsWith('src/') || specifier.startsWith('scripts/') || specifier.startsWith('base44/')) base = path.join(root, specifier);
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier);
  else return null;
  return [base, ...extensions.map(extension => base + extension), ...extensions.map(extension => path.join(base, 'index' + extension))].find(file => known.has(file)) || null;
}
for (const file of files) {
  const imports = new Set(), text = fs.readFileSync(file, 'utf8');
  if (/\.(?:jsonc?|css)$/.test(file)) { edges.set(file, imports); continue; }
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  function visit(node) {
    if (ts.isStringLiteralLike(node)) { const target = resolve(file, node.text); if (target) imports.add(target); }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && !ts.isStringLiteralLike(node.arguments[0])) unresolved.push(relative(file));
    ts.forEachChild(node, visit);
  }
  visit(ast); edges.set(file, imports);
}
const roots = [...maintenance, ...sources.filter(file => /(?:^|[\\/])(?:page|route|layout|template|loading|error|not-found|default)\.[jt]sx?$/.test(file) || /[\\/]proxy\.js$/.test(file))];
const reachable = new Set();
function visit(file) { if (reachable.has(file)) return; reachable.add(file); for (const target of edges.get(file) || []) visit(target); }
roots.forEach(visit);
const dormant = sources.filter(file => !reachable.has(file));
console.log(JSON.stringify({ source_files: sources.length, entry_and_maintenance_roots: roots.length, reachable_source_files: sources.length - dormant.length, dormant_bytes: dormant.reduce((sum, file) => sum + fs.statSync(file).size, 0), dormant: dormant.map(relative), non_literal_dynamic_imports: [...new Set(unresolved)] }, null, 2));
