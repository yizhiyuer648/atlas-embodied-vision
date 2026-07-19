import { CATEGORIES, loadModels, categoryMeta, displayValue, escapeHTML, setQuery } from '../core.js?v=20260719.7';

const NODE = Object.freeze({ width: 158, height: 60, column: 236, row: 82, rootGap: 42 });
const MAIN_TOP = 92;

export async function init() {
  const models = await loadModels();
  const params = new URLSearchParams(location.search);
  let category = CATEGORIES[params.get('category')] ? params.get('category') : 'vla';
  let focus = params.get('focus') || '';
  const select = document.getElementById('lineage-category');
  select.innerHTML = Object.entries(CATEGORIES).map(([key, meta]) => `<option value="${key}">${meta.label}</option>`).join('');
  select.value = category;

  const stage = document.getElementById('lineage-stage');
  const viewport = document.getElementById('lineage-viewport');
  const edgeRoot = document.getElementById('lineage-edges');
  const nodeRoot = document.getElementById('lineage-nodes');
  const summary = document.getElementById('lineage-summary');
  const transform = { x: 30, y: 30, scale: 1 };
  const activePointers = new Map();
  let dragging = false;
  let start = null;
  let pinch = null;
  let layout = new Map();
  let graphBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let fitScale = 1;

  function applyTransform() {
    viewport.setAttribute('transform', `translate(${transform.x} ${transform.y}) scale(${transform.scale})`);
  }

  function minimumScale() {
    return Math.max(.08, Math.min(.3, fitScale || .18));
  }

  function fitToStage() {
    const box = stage.getBoundingClientRect();
    const padding = box.width < 520 ? 14 : 28;
    const width = Math.max(1, graphBounds.maxX - graphBounds.minX);
    const height = Math.max(1, graphBounds.maxY - graphBounds.minY);
    fitScale = Math.max(.08, Math.min(1, (box.width - padding * 2) / width, (box.height - padding * 2) / height));
    transform.scale = fitScale;
    transform.x = (box.width - width * fitScale) / 2 - graphBounds.minX * fitScale;
    transform.y = (box.height - height * fitScale) / 2 - graphBounds.minY * fitScale;
    applyTransform();
  }

  function showReadableStart(centerFocus = true) {
    const box = stage.getBoundingClientRect();
    const target = centerFocus && focus && layout.get(focus);
    transform.scale = box.width < 520 ? .92 : 1;
    if (target) {
      transform.x = box.width / 2 - (target.x + target.w / 2) * transform.scale;
      transform.y = box.height / 2 - (target.y + target.h / 2) * transform.scale;
    } else {
      const padding = box.width < 520 ? 16 : 30;
      transform.x = padding - graphBounds.minX * transform.scale;
      transform.y = 18 - graphBounds.minY * transform.scale;
    }
    applyTransform();
  }

  function render() {
    const categoryModels = models.filter(model => model.category === category);
    const allById = new Map(models.map(model => [model.id, model]));
    const included = new Set(categoryModels.map(model => model.id));
    const ghostParents = [];

    categoryModels.forEach(model => {
      const parent = allById.get(model.lineage_parent);
      if (parent && parent.category !== category && !included.has(parent.id)) {
        included.add(parent.id);
        ghostParents.push({ ...parent, _ghost: true });
      }
    });

    const list = [...categoryModels, ...ghostParents];
    const byId = new Map(list.map(model => [model.id, model]));
    const allChildren = buildChildren(list, byId);
    const isolated = categoryModels.filter(model => {
      const parentUnknown = !model.lineage_parent || model.lineage_parent === 'unknown' || !allById.has(model.lineage_parent);
      return parentUnknown && (allChildren.get(model.id)?.length || 0) === 0;
    });
    const isolatedIds = new Set(isolated.map(model => model.id));
    const mainList = list.filter(model => !isolatedIds.has(model.id));
    const mainById = new Map(mainList.map(model => [model.id, model]));
    const children = buildChildren(mainList, mainById);
    const branchInfo = createBranchInfo(mainById, children);
    children.forEach(group => group.sort((a, b) => compareBranches(a, b, branchInfo)));

    const roots = mainList
      .filter(model => !mainById.has(model.lineage_parent) || model.lineage_parent === model.id)
      .sort((a, b) => compareBranches(a, b, branchInfo));
    const visited = new Set();
    let leafCursor = MAIN_TOP;
    let maxDepth = 0;
    layout = new Map();

    const placeSubtree = (model, depth) => {
      if (visited.has(model.id)) return layout.get(model.id);
      visited.add(model.id);
      maxDepth = Math.max(maxDepth, depth);
      const childGroup = (children.get(model.id) || []).filter(child => !visited.has(child.id));
      let y;
      if (!childGroup.length) {
        y = leafCursor;
        leafCursor += NODE.row;
      } else {
        const childPositions = childGroup.map(child => placeSubtree(child, depth + 1)).filter(Boolean);
        if (childPositions.length) {
          const firstCenter = childPositions[0].y + NODE.height / 2;
          const lastCenter = childPositions[childPositions.length - 1].y + NODE.height / 2;
          y = (firstCenter + lastCenter) / 2 - NODE.height / 2;
        } else {
          y = leafCursor;
          leafCursor += NODE.row;
        }
      }
      const position = { x: 88 + depth * NODE.column, y, w: NODE.width, h: NODE.height, depth };
      layout.set(model.id, position);
      return position;
    };

    roots.forEach(root => {
      placeSubtree(root, 0);
      leafCursor += NODE.rootGap;
    });
    // Defensive fallback for malformed cycles: keep every model visible without inventing an edge.
    mainList.filter(model => !visited.has(model.id)).sort((a, b) => compareBranches(a, b, branchInfo)).forEach(model => {
      placeSubtree(model, 0);
      leafCursor += NODE.rootGap;
    });

    const mainPositions = mainList.map(model => layout.get(model.id)).filter(Boolean);
    const mainBottom = mainPositions.length ? Math.max(...mainPositions.map(position => position.y + position.h)) : MAIN_TOP + NODE.height;
    const mainWidth = 88 + maxDepth * NODE.column + NODE.width + 88;
    let graphWidth = Math.max(1060, mainWidth);
    let isolatedZone = null;

    if (isolated.length) {
      const sidePadding = 38;
      const gapX = 24;
      const maxColumns = Math.max(1, Math.floor((graphWidth - 100 - sidePadding * 2 + gapX) / (NODE.width + gapX)));
      const columns = Math.min(6, maxColumns, isolated.length);
      const rows = Math.ceil(isolated.length / columns);
      const zoneX = 50;
      const zoneY = mainBottom + 86;
      const zoneWidth = graphWidth - 100;
      const zoneHeight = 100 + rows * NODE.height + Math.max(0, rows - 1) * 22 + 28;
      isolatedZone = { x: zoneX, y: zoneY, width: zoneWidth, height: zoneHeight };
      isolated.sort(compareModels).forEach((model, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        layout.set(model.id, {
          x: zoneX + sidePadding + column * (NODE.width + gapX),
          y: zoneY + 82 + row * (NODE.height + 22),
          w: NODE.width,
          h: NODE.height,
          depth: -1
        });
      });
    }

    const edgeModels = mainList.filter(model => mainById.has(model.lineage_parent) && model.lineage_parent !== model.id);
    const edgeMarkup = [];
    const portMarkup = [];
    edgeModels.forEach((model, edgeIndex) => {
      const parent = mainById.get(model.lineage_parent);
      const from = layout.get(parent.id);
      const to = layout.get(model.id);
      if (!from || !to) return;
      const siblings = children.get(parent.id) || [];
      const siblingIndex = Math.max(0, siblings.findIndex(child => child.id === model.id));
      const sourceY = from.y + 13 + (siblingIndex + 1) * (from.h - 26) / (siblings.length + 1);
      const targetY = to.y + to.h / 2;
      const sourceX = from.x + from.w;
      const targetX = to.x;
      const span = Math.max(60, targetX - sourceX);
      const curve = Math.max(42, Math.min(88, span * .46));
      const pathLength = Math.ceil(span + Math.abs(targetY - sourceY) * 1.2 + 90);
      const crossCategory = Boolean(parent._ghost);
      edgeMarkup.push(`<path class="lineage-edge${crossCategory ? ' cross-category' : ''}" style="--path-length:${pathLength};animation-delay:${Math.min(.7, edgeIndex * .035).toFixed(2)}s" d="M${sourceX},${sourceY} C${sourceX + curve},${sourceY} ${targetX - curve},${targetY} ${targetX},${targetY}"/>`);
      portMarkup.push(`<circle class="lineage-port${crossCategory ? ' cross-category' : ''}" cx="${sourceX}" cy="${sourceY}" r="2.7"/><circle class="lineage-port${crossCategory ? ' cross-category' : ''}" cx="${targetX}" cy="${targetY}" r="2.7"/>`);
    });

    const backgrounds = [
      `<g class="lineage-section-label"><text x="50" y="36">已确认方法谱系</text><text class="lineage-section-note" x="50" y="55">父子分支按子树相邻排列；连线仅表示可核验的方法继承</text><line x1="50" y1="70" x2="${graphWidth - 50}" y2="70"/></g>`
    ];
    if (isolatedZone) {
      backgrounds.push(`<g class="lineage-isolated-zone"><rect x="${isolatedZone.x}" y="${isolatedZone.y}" width="${isolatedZone.width}" height="${isolatedZone.height}" rx="18"/><text x="${isolatedZone.x + 34}" y="${isolatedZone.y + 35}">未确认直接上游 · ${isolated.length}</text><text class="lineage-section-note" x="${isolatedZone.x + 34}" y="${isolatedZone.y + 57}">当前资料未确认这些模型的直接前代，因此不绘制推测性连线；点击仍可查看详情</text></g>`);
    }
    edgeRoot.innerHTML = backgrounds.join('') + edgeMarkup.join('') + portMarkup.join('');

    nodeRoot.innerHTML = list.map(model => {
      const position = layout.get(model.id);
      if (!position) return '';
      const meta = categoryMeta(model.category);
      const isIsolated = isolatedIds.has(model.id);
      const metaText = model._ghost
        ? `跨类 · ${categoryMeta(model.category).short}`
        : isIsolated
          ? '直接上游待确认'
          : model.country === 'CN'
            ? 'CN'
            : model.org === 'unknown'
              ? 'unknown'
              : shortName(model.org, 13);
      const classes = [
        'graph-node',
        model._ghost ? 'ghost' : '',
        isIsolated ? 'isolated' : '',
        model.country === 'CN' ? 'cn' : '',
        model.tier === 'A' && !model._ghost ? 'tier-a' : ''
      ].filter(Boolean).join(' ');
      const note = model._ghost ? ` · 跨类别上游（${categoryMeta(model.category).short}）` : isIsolated ? ' · 直接上游尚未确认' : '';
      return `<g class="${classes}" data-id="${escapeHTML(model.id)}" transform="translate(${position.x} ${position.y})" tabindex="0" role="link" aria-label="查看 ${escapeHTML(model.name)}"><title>${escapeHTML(model.name)} · ${escapeHTML(displayValue(model.org))} · ${escapeHTML(displayValue(model.year))}${escapeHTML(note)}</title><rect width="${position.w}" height="${position.h}"/><text x="${position.w / 2}" y="25">${escapeHTML(shortName(model.name, 21))}</text><text class="node-meta" x="${position.w / 2}" y="44">${escapeHTML(displayValue(model.year))} · ${escapeHTML(metaText)}</text>${model.id === focus ? `<circle cx="${position.w - 10}" cy="10" r="4" fill="${meta.color}" filter="url(#nodeGlow)"/>` : ''}</g>`;
    }).join('');

    nodeRoot.querySelectorAll('.graph-node').forEach(node => {
      const go = () => { location.href = `model.html?id=${encodeURIComponent(node.dataset.id)}`; };
      node.addEventListener('click', go);
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          go();
        }
      });
    });

    const positioned = [...layout.values()];
    const isolatedBottom = isolatedZone ? isolatedZone.y + isolatedZone.height : mainBottom;
    graphBounds = {
      minX: 24,
      minY: 0,
      maxX: Math.max(graphWidth + 24, ...positioned.map(position => position.x + position.w + 24)),
      maxY: Math.max(220, isolatedBottom + 34, ...positioned.map(position => position.y + position.h + 34))
    };
    summary.textContent = `${categoryModels.length} 个模型 · ${edgeModels.length} 条已确认关系 · ${isolated.length} 个直接上游待确认`;
    showReadableStart(true);
  }

  function zoomAt(factor, clientX, clientY) {
    const box = stage.getBoundingClientRect();
    const px = clientX - box.left;
    const py = clientY - box.top;
    const old = transform.scale;
    const next = Math.max(minimumScale(), Math.min(2.25, old * factor));
    const worldX = (px - transform.x) / old;
    const worldY = (py - transform.y) / old;
    transform.scale = next;
    transform.x = px - worldX * next;
    transform.y = py - worldY * next;
    applyTransform();
  }

  stage.addEventListener('wheel', event => {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.1 : .9, event.clientX, event.clientY);
  }, { passive: false });

  stage.addEventListener('pointerdown', event => {
    if (event.target.closest('.graph-node')) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { stage.setPointerCapture(event.pointerId); } catch { /* pointer capture unsupported */ }
    if (activePointers.size === 1) {
      dragging = true;
      pinch = null;
      start = { x: event.clientX - transform.x, y: event.clientY - transform.y };
      return;
    }
    const [a, b] = [...activePointers.values()];
    const box = stage.getBoundingClientRect();
    const centerX = (a.x + b.x) / 2 - box.left;
    const centerY = (a.y + b.y) / 2 - box.top;
    dragging = false;
    pinch = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      scale: transform.scale,
      worldX: (centerX - transform.x) / transform.scale,
      worldY: (centerY - transform.y) / transform.scale
    };
  });

  stage.addEventListener('pointermove', event => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size >= 2 && pinch) {
      const [a, b] = [...activePointers.values()];
      const box = stage.getBoundingClientRect();
      const centerX = (a.x + b.x) / 2 - box.left;
      const centerY = (a.y + b.y) / 2 - box.top;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const next = Math.max(minimumScale(), Math.min(2.25, pinch.scale * distance / pinch.distance));
      transform.scale = next;
      transform.x = centerX - pinch.worldX * next;
      transform.y = centerY - pinch.worldY * next;
      applyTransform();
      return;
    }
    if (!dragging || !start) return;
    transform.x = event.clientX - start.x;
    transform.y = event.clientY - start.y;
    applyTransform();
  });

  const finishPointer = event => {
    activePointers.delete(event.pointerId);
    try { stage.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    pinch = null;
    if (activePointers.size === 1) {
      const remaining = [...activePointers.values()][0];
      dragging = true;
      start = { x: remaining.x - transform.x, y: remaining.y - transform.y };
    } else {
      dragging = false;
      start = null;
    }
  };

  stage.addEventListener('pointerup', finishPointer);
  stage.addEventListener('pointercancel', finishPointer);
  document.getElementById('zoom-in').addEventListener('click', () => {
    const box = stage.getBoundingClientRect();
    zoomAt(1.16, box.left + box.width / 2, box.top + box.height / 2);
  });
  document.getElementById('zoom-out').addEventListener('click', () => {
    const box = stage.getBoundingClientRect();
    zoomAt(.86, box.left + box.width / 2, box.top + box.height / 2);
  });
  document.getElementById('zoom-reset').addEventListener('click', fitToStage);
  document.getElementById('zoom-home').addEventListener('click', () => showReadableStart(false));
  select.addEventListener('change', () => {
    category = select.value;
    focus = '';
    setQuery({ category, focus: null });
    render();
  });
  addEventListener('resize', () => showReadableStart(Boolean(focus)), { passive: true });
  setQuery({ category, focus: focus || null });
  render();
}

function buildChildren(list, byId) {
  const children = new Map(list.map(model => [model.id, []]));
  list.forEach(model => {
    if (model.lineage_parent === model.id) return;
    const parent = byId.get(model.lineage_parent);
    if (parent) children.get(parent.id).push(model);
  });
  return children;
}

function createBranchInfo(byId, children) {
  const memo = new Map();
  const visiting = new Set();
  const getInfo = model => {
    if (memo.has(model.id)) return memo.get(model.id);
    if (visiting.has(model.id)) return { size: 1, year: yearValue(model), name: model.name };
    visiting.add(model.id);
    const descendants = (children.get(model.id) || []).map(getInfo);
    const info = {
      size: 1 + descendants.reduce((total, child) => total + child.size, 0),
      year: Math.min(yearValue(model), ...descendants.map(child => child.year)),
      name: model.name
    };
    visiting.delete(model.id);
    memo.set(model.id, info);
    return info;
  };
  byId.forEach(getInfo);
  return memo;
}

function compareBranches(a, b, info) {
  const left = info.get(a.id) || { size: 1, year: yearValue(a) };
  const right = info.get(b.id) || { size: 1, year: yearValue(b) };
  return left.year - right.year || right.size - left.size || a.name.localeCompare(b.name, 'zh-CN');
}

function compareModels(a, b) {
  return yearValue(a) - yearValue(b) || a.name.localeCompare(b.name, 'zh-CN');
}

function yearValue(model) {
  const year = Number(model.year);
  return Number.isFinite(year) ? year : 9999;
}

function shortName(value, max) {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
