import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = globalThis.process?.cwd?.() || globalThis.nodeRepl?.cwd;
if (!root) throw new Error('无法确定项目根目录');
const cliArgs = Array.isArray(globalThis.process?.argv)
  ? globalThis.process.argv.slice(2)
  : Array.isArray(globalThis.ARCH_CHECK_ARGS)
    ? globalThis.ARCH_CHECK_ARGS
    : [];
const source = await readFile(path.join(root, 'assets/js/pages/model.js'), 'utf8');
const start = source.indexOf('function layoutArchitecture(');
const end = source.indexOf('function wrapSvgLabel(', start);
if (start < 0 || end < 0) throw new Error('无法从 model.js 读取架构布局函数');
const context = {};
vm.runInNewContext(`${source.slice(start, end)}\nthis.layoutArchitecture = layoutArchitecture; this.edgeGeometry = edgeGeometry;`, context);
const { layoutArchitecture, edgeGeometry } = context;

const EPS = 0.35;
const close = (a, b, tolerance = EPS) => Math.abs(a - b) <= tolerance;
const pointKey = point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
const rectsOverlap = (a, b) => a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS
  && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;

function flattenPath(d) {
  const tokens = d.match(/[MLQC]|-?\d+(?:\.\d+)?/g) || [];
  const points = [];
  let cursor = 0, command = '', current = { x: 0, y: 0 };
  const number = () => Number(tokens[cursor++]);
  while (cursor < tokens.length) {
    if (/^[MLQC]$/.test(tokens[cursor])) command = tokens[cursor++];
    if (command === 'M' || command === 'L') {
      current = { x: number(), y: number() }; points.push(current); command = 'L';
    } else if (command === 'Q') {
      const start = current, control = { x: number(), y: number() }, end = { x: number(), y: number() };
      for (let step = 1; step <= 16; step++) {
        const t = step / 16, inv = 1 - t;
        points.push({ x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x, y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y });
      }
      current = end;
    } else if (command === 'C') {
      const start = current, c1 = { x: number(), y: number() }, c2 = { x: number(), y: number() }, end = { x: number(), y: number() };
      for (let step = 1; step <= 20; step++) {
        const t = step / 20, inv = 1 - t;
        points.push({
          x: inv ** 3 * start.x + 3 * inv * inv * t * c1.x + 3 * inv * t * t * c2.x + t ** 3 * end.x,
          y: inv ** 3 * start.y + 3 * inv * inv * t * c1.y + 3 * inv * t * t * c2.y + t ** 3 * end.y
        });
      }
      current = end;
    } else throw new Error(`不支持的 SVG path 命令: ${command}`);
  }
  return points;
}

const segments = points => points.slice(1).map((point, index) => [points[index], point]);

function segmentHitsRect(a, b, rect) {
  const box = { left: rect.x + EPS, right: rect.x + rect.w - EPS, top: rect.y + EPS, bottom: rect.y + rect.h - EPS };
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.left], [dx, box.right - a.x], [-dy, a.y - box.top], [dy, box.bottom - a.y]]) {
    if (close(p, 0, 1e-9)) { if (q < 0) return false; continue; }
    const ratio = q / p;
    if (p < 0) { if (ratio > t1) return false; t0 = Math.max(t0, ratio); }
    else { if (ratio < t0) return false; t1 = Math.min(t1, ratio); }
  }
  return t1 >= t0 && t1 > EPS / Math.max(1, Math.abs(dx) + Math.abs(dy)) && t0 < 1;
}

function segmentIntersection(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const cross = (x1, y1, x2, y2) => x1 * y2 - y1 * x2;
  const denominator = cross(rx, ry, sx, sy), qx = c.x - a.x, qy = c.y - a.y;
  if (Math.abs(denominator) <= 1e-7) {
    if (Math.abs(cross(qx, qy, rx, ry)) > 1e-5) return null;
    const axis = Math.abs(rx) >= Math.abs(ry) ? 'x' : 'y';
    const r1 = a[axis], r2 = b[axis], s1 = c[axis], s2 = d[axis];
    const overlap = Math.min(Math.max(r1, r2), Math.max(s1, s2)) - Math.max(Math.min(r1, r2), Math.min(s1, s2));
    if (overlap > EPS) return { kind: 'overlap', key: `${axis}:${Math.max(Math.min(r1, r2), Math.min(s1, s2)).toFixed(1)}` };
    return null;
  }
  const t = cross(qx, qy, sx, sy) / denominator, u = cross(qx, qy, rx, ry) / denominator;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  const point = { x: a.x + t * rx, y: a.y + t * ry };
  return { kind: 'cross', key: `${point.x.toFixed(1)},${point.y.toFixed(1)}` };
}

const files = (await readdir(path.join(root, 'data/details'))).filter(file => file.endsWith('.json')).sort();
const requestedId = cliArgs.find(argument => !argument.startsWith('--'));
const reports = [];
for (const file of files) {
  const model = JSON.parse(await readFile(path.join(root, 'data/details', file), 'utf8'));
  if (model.tier !== 'A' || !model.architecture) continue;
  if (requestedId && model.id !== requestedId) continue;
  const started = performance.now();
  const modules = model.architecture.modules || [], edges = model.architecture.edges || [];
  const layout = layoutArchitecture(modules, edges);
  const nodeOverlaps = [];
  for (let i = 0; i < modules.length; i++) for (let j = i + 1; j < modules.length; j++) {
    if (rectsOverlap(layout.positions.get(modules[i].id), layout.positions.get(modules[j].id))) nodeOverlaps.push(`${modules[i].id}/${modules[j].id}`);
  }
  const paths = edges.map((edge, index) => {
    const geometry = edgeGeometry(layout.positions.get(edge.from), layout.positions.get(edge.to), {
      feedback: layout.feedback.has(index), route: layout.routes.get(index), viewHeight: layout.viewHeight
    });
    return { edge, index, d: geometry.d, points: flattenPath(geometry.d) };
  }).filter(item => item.points.length > 1);
  const duplicatePaths = [];
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    if (paths[i].d === paths[j].d) duplicatePaths.push(`E${paths[i].index}/E${paths[j].index}`);
  }
  const ports = new Map(), sharedPorts = [];
  paths.forEach(item => {
    [item.points[0], item.points.at(-1)].forEach(point => {
      const key = pointKey(point);
      if (ports.has(key)) sharedPorts.push(`${ports.get(key)}/E${item.index}`);
      else ports.set(key, `E${item.index}`);
    });
  });
  const nodeHits = [];
  paths.forEach(item => modules.forEach(module => {
    if (module.id === item.edge.from || module.id === item.edge.to) return;
    if (segments(item.points).some(([a, b]) => segmentHitsRect(a, b, layout.positions.get(module.id)))) nodeHits.push(`E${item.index}->${module.id}`);
  }));
  const crossings = [], overlaps = [];
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    const pairCrossings = new Set(), pairOverlaps = new Set();
    segments(paths[i].points).forEach(([a, b]) => segments(paths[j].points).forEach(([c, d]) => {
      const hit = segmentIntersection(a, b, c, d);
      if (hit?.kind === 'overlap') pairOverlaps.add(hit.key);
      else if (hit) pairCrossings.add(hit.key);
    }));
    if (pairCrossings.size) crossings.push(`E${paths[i].index}/E${paths[j].index}:${[...pairCrossings].join('|')}`);
    if (pairOverlaps.size) overlaps.push(`E${paths[i].index}/E${paths[j].index}`);
  }
  reports.push({ id: model.id, nodes: modules.length, edges: edges.length, nodeOverlaps, duplicatePaths, sharedPorts, nodeHits, crossings, overlaps, ms: performance.now() - started,
    routePoints: cliArgs.includes('--paths') ? edges.map((edge, index) => ({ index, from: edge.from, to: edge.to, points: layout.routes.get(index)?.points })) : null });
}

let failed = false;
for (const report of reports) {
  const issueCount = report.nodeOverlaps.length + report.duplicatePaths.length + report.sharedPorts.length + report.nodeHits.length + report.crossings.length + report.overlaps.length;
  failed ||= issueCount > 0;
  const summary = `${report.id.padEnd(20)} ${report.nodes}N/${report.edges}E  overlap-node=${report.nodeOverlaps.length} shared-port=${report.sharedPorts.length} node-hit=${report.nodeHits.length} cross=${report.crossings.length} shared-line=${report.overlaps.length} ${report.ms.toFixed(1)}ms`;
  console.log(issueCount ? `FAIL ${summary}` : `PASS ${summary}`);
  if (issueCount) {
    for (const key of ['nodeOverlaps', 'duplicatePaths', 'sharedPorts', 'nodeHits', 'crossings', 'overlaps']) {
      if (report[key].length) console.log(`     ${key}: ${report[key].join(', ')}`);
    }
  }
  if (report.routePoints) console.log(JSON.stringify(report.routePoints, null, 2));
}
console.log(`\n${reports.length} 张 A 级架构图；${failed ? '存在几何问题' : '全部通过几何检查'}。`);
if (failed) {
  if (typeof process !== 'undefined' && 'exitCode' in process) process.exitCode = 1;
  else throw new Error('A 级架构图存在几何问题');
}
