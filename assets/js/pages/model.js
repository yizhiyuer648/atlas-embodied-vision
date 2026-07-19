import {
  loadModels, loadModelDetail, categoryMeta, displayValue, isKnown, isOpenSource, escapeHTML, setupBreadcrumbs,
  isFavorite, toggleFavorite, initCardInteractions, initReveals, modelCard, cachedFetchJSON,
  repoFromURL, formatCompact, formatDate, toast
} from '../core.js?v=20260719.10';

export async function init() {
  const models = await loadModels();
  const id = new URLSearchParams(location.search).get('id');
  const summary = models.find(item => item.id === id);
  const root = document.getElementById('model-detail');
  if (!summary) {
    root.innerHTML = `<section class="not-found"><p class="eyebrow">404 / MODEL NOT FOUND</p><h1>这张模型卡还不在图鉴里。</h1><p>链接可能已失效，也可以回到图鉴重新搜索。</p><a class="button button-primary" href="explore.html">返回模型图鉴</a></section>`;
    setupBreadcrumbs('model', '未找到模型'); return;
  }
  let model = summary;
  try { model = await loadModelDetail(id); }
  catch { /* 详情文件缺失时退回索引里的基础信息 */ }
  document.title = `${model.name} · Atlas`;
  setupBreadcrumbs('model', model.name);
  const meta = categoryMeta(model.category);
  const lineage = buildLineage(model, models);
  const related = models.filter(item => item.category === model.category && item.id !== model.id)
    .sort((a, b) => Number(a.lineage_parent === model.id || model.lineage_parent === a.id) - Number(b.lineage_parent === model.id || model.lineage_parent === b.id)).reverse().slice(0, 3);

  root.innerHTML = `
    <section class="detail-hero">
      <div>
        <span class="category-badge" style="--badge-color:${meta.color}">${escapeHTML(meta.label)}</span>
        <h1>${escapeHTML(model.name)}</h1>
        <p class="lead">${escapeHTML(model.one_liner_zh)}</p>
        <dl class="detail-meta">
          ${metaPair('机构', displayValue(model.org))}${metaPair('国家 / 地区', displayValue(model.country))}${metaPair('首次公开', displayValue(model.year))}${metaPair('详解级别', model.tier === 'A' ? 'A · 架构与代码' : 'B · 深度解读')}
          ${Number.isFinite(model.citations?.count) ? metaPair(`引用数（${model.citations.as_of || '快照'}）`, formatCompact(model.citations.count)) : ''}
          <div class="meta-pair" id="repo-heat" hidden><dt>仓库热度</dt><dd></dd></div>
        </dl>
      </div>
      <div class="detail-actions">
        <button class="favorite-button ${isFavorite(model.id) ? 'active' : ''}" data-detail-favorite aria-label="${isFavorite(model.id) ? '取消收藏' : '收藏'} ${escapeHTML(model.name)}" aria-pressed="${isFavorite(model.id)}">${isFavorite(model.id) ? '★' : '☆'}</button>
        <button id="citation-button" class="button button-ghost" type="button">查看引用数</button>
        <a class="button button-ghost" href="compare.html?ids=${encodeURIComponent(model.id)}">加入对比</a>
      </div>
    </section>

    <section class="detail-section reveal-section">
      <div class="detail-section-head"><h2>核心思想</h2><p>先用一句话确定它解决的问题，再看真正让它与前代不同的机制。</p></div>
      <div class="idea-grid">
        <article class="idea-card"><h3>KEY IDEA</h3><p>${escapeHTML(model.key_idea_zh || '公开资料仍在整理中。')}</p><div class="tag-list">${(model.tags || []).map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join('')}</div></article>
        <div class="source-links">
          ${sourceLink('论文 / 项目页', model.paper_url, '↗')}
          ${sourceLink('代码仓库', model.github_url, '↗')}
        </div>
      </div>
    </section>

    ${sectionsArticle(model)}
    ${evidenceSection(model)}
    ${model.tier === 'A' && model.architecture ? architectureSection(model) : ''}
    ${model.tier === 'A' && model.code ? codeSection(model) : ''}

    <section class="detail-section reveal-section">
      <div class="detail-section-head"><h2>演化关系</h2><p>谱系表示公开工作之间的主要继承或概念延续，不等同于代码分支关系。</p></div>
      <div class="lineage-strip">${lineage.map((item, index) => `${index ? '<span class="lineage-arrow">→</span>' : ''}<a class="lineage-pill ${item.id === model.id ? 'current' : ''}" href="model.html?id=${encodeURIComponent(item.id)}">${escapeHTML(item.name)} · ${escapeHTML(displayValue(item.year))}</a>`).join('')}</div>
      <a class="text-link" href="lineage.html?category=${model.category}&focus=${encodeURIComponent(model.id)}">在完整谱系图中查看 <span>↗</span></a>
    </section>

    <section class="detail-section reveal-section">
      <div class="detail-section-head"><h2>继续探索</h2><p>同一技术主线中，最值得放在一起理解的模型。</p></div>
      <div class="related-grid">${related.map((item, index) => modelCard(item, { delay: index * 80, compact: true })).join('')}</div>
    </section>`;

  root.querySelector('[data-detail-favorite]').addEventListener('click', event => {
    const active = toggleFavorite(model.id); event.currentTarget.classList.toggle('active', active);
    event.currentTarget.textContent = active ? '★' : '☆'; event.currentTarget.setAttribute('aria-pressed', String(active));
  });
  initCardInteractions(root); initReveals(root);
  setupTocSpy(root);
  if (model.architecture) animateArchitecture(model.architecture);
  setupCodeCopy(model);
  setupCitation(model);
  setupRepoHeat(model);
}

function metaPair(label, value) { return `<div class="meta-pair"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`; }

function sourceLink(label, url, icon) {
  const known = isKnown(url);
  return `<a class="source-link ${known ? '' : 'disabled'}" ${known ? `href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer"` : 'aria-disabled="true"'}><span>${escapeHTML(label)}${known ? '' : ' · unknown'}</span><span>${known ? icon : '—'}</span></a>`;
}

function sectionsArticle(model) {
  const sections = (Array.isArray(model.sections) ? model.sections : []).filter(section => section && section.title && section.body);
  if (!sections.length) return '';
  return `<section class="detail-section reveal-section">
    <div class="detail-section-head"><h2>深入解读</h2><p>以下内容依据论文原文与官方公开资料整理，按主题分节，可通过目录直接跳转。</p></div>
    <div class="article-layout">
      <nav class="article-toc" aria-label="解读目录"><p>目录</p>${sections.map((section, index) => `<a href="#reading-${index}">${escapeHTML(section.title)}</a>`).join('')}</nav>
      <div class="article-body">
        ${sections.map((section, index) => `<section class="article-section" id="reading-${index}"><h3>${escapeHTML(section.title)}</h3>${paragraphs(section.body)}</section>`).join('')}
      </div>
    </div>
  </section>`;
}

function paragraphs(text) {
  return String(text).split(/\n+/).map(part => part.trim()).filter(Boolean).map(part => `<p>${escapeHTML(part)}</p>`).join('');
}

function evidenceSection(model) {
  const claims = Array.isArray(model.evidence_claims) ? model.evidence_claims.filter(item => item?.claim) : [];
  if (!claims.length) return `<section class="detail-section evidence-section reveal-section">
    <div class="detail-section-head"><h2>证据账本</h2><p>本条目的断言级页码与评测条件仍待补齐。现有论文和代码链接只证明来源存在，不代表页面中的每项判断都已逐句核验。</p></div>
    <div class="evidence-empty"><span>CLAIM-LEVEL EVIDENCE · PENDING</span><p>后续维护会优先为定量结果、版本差异和行业影响判断补充来源定位。</p></div>
  </section>`;
  return `<section class="detail-section evidence-section reveal-section">
    <div class="detail-section-head"><h2>证据账本</h2><p>把论文报告、Atlas 解读和待核验判断分开。页码、表格与评测条件以所列版本为准，跨论文数字不能直接视为公平比较。</p></div>
    <div class="evidence-ledger">
      ${claims.map((item, index) => evidenceClaim(item, index)).join('')}
    </div>
  </section>`;
}

function evidenceClaim(item, index) {
  const type = item.type || 'paper_report';
  const types = {
    paper_report: ['论文报告', 'reported'], atlas_interpretation: ['Atlas 解读', 'interpretation'],
    independent_replication: ['独立复现', 'replicated'], pending: ['尚未核验', 'pending']
  };
  const [label, className] = types[type] || types.pending;
  const sourceURL = isKnown(item.source_url) ? item.source_url : '';
  return `<article class="evidence-claim" style="--claim-index:${index}">
    <div class="evidence-claim-head"><span class="evidence-kind ${className}">${label}</span><span class="evidence-id">E-${String(index + 1).padStart(2, '0')}</span></div>
    <h3>${escapeHTML(item.claim)}</h3>
    ${item.scope ? `<p class="evidence-scope">适用范围：${escapeHTML(item.scope)}</p>` : ''}
    <dl>
      ${item.locator ? `<div><dt>原文定位</dt><dd>${escapeHTML(item.locator)}</dd></div>` : ''}
      ${item.conditions ? `<div><dt>评测条件</dt><dd>${escapeHTML(item.conditions)}</dd></div>` : ''}
      ${item.checked_at ? `<div><dt>核验日期</dt><dd>${escapeHTML(item.checked_at)}</dd></div>` : ''}
    </dl>
    ${sourceURL ? `<a href="${escapeHTML(sourceURL)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.source_label || '打开原始来源')} <span aria-hidden="true">↗</span></a>` : '<span class="evidence-source-pending">来源定位待补充</span>'}
  </article>`;
}

function setupTocSpy(root) {
  const links = [...root.querySelectorAll('.article-toc a')];
  const targets = links.map(link => root.querySelector(link.getAttribute('href'))).filter(Boolean);
  if (!links.length || targets.length !== links.length || !('IntersectionObserver' in window)) return;
  const activate = id => links.forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${id}`));
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible.length) activate(visible[0].target.id);
  }, { rootMargin: '-20% 0px -65% 0px' });
  targets.forEach(target => observer.observe(target));
}

function architectureSection(model) {
  const architecture = model.architecture;
  const modules = architecture.modules || [];
  const edges = architecture.edges || [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const layout = layoutArchitecture(modules, edges);
  const pathByEdge = edges.map((edge, i) => {
    const geometry = edgeGeometry(layout.positions.get(edge.from), layout.positions.get(edge.to), {
      feedback: layout.feedback.has(i), route: layout.routes.get(i), viewHeight: layout.viewHeight
    });
    return { ...edge, ...geometry, feedback: layout.feedback.has(i), id: `arch-path-${i}` };
  }).filter(edge => edge.d);
  return `<section class="detail-section reveal-section">
    <div class="detail-section-head"><h2>架构数据流</h2><p>${escapeHTML(architecture.description_zh || '按公开架构资料整理的数据流。')}</p></div>
    <div class="architecture-shell">
      <div class="architecture-caption"><span><i></i>前向传播循环演示</span><span class="architecture-scroll-hint">左右滑动查看完整数据流 · 模块与连接依据公开架构整理</span></div>
      <div class="architecture-scroll" tabindex="0" aria-label="可横向滚动的架构图">
        <svg class="architecture-svg" style="min-width:${layout.viewWidth}px" viewBox="0 0 ${layout.viewWidth} ${layout.viewHeight}" role="img" aria-label="${escapeHTML(model.name)} 架构数据流图">
          <defs><marker id="arch-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#b3ac97"/></marker></defs>
          ${pathByEdge.map(edge => `<path id="${edge.id}" class="arch-edge${edge.feedback ? ' feedback' : ''}" d="${edge.d}"/>${edge.label ? `<text class="arch-edge-label" x="${edge.labelX}" y="${edge.labelY}" text-anchor="middle">${escapeHTML(edge.label)}</text>` : ''}`).join('')}
          ${modules.map(module => {
            const p = layout.positions.get(module.id);
            const lines = wrapSvgLabel(module.label);
            const labelY = p.y + (lines.length > 1 ? 25 : 31);
            return `<g class="arch-module" data-module="${escapeHTML(module.id)}" data-stage="${p.rank}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="12"/><text class="arch-label" x="${p.x + p.w / 2}" y="${labelY}">${lines.map((line, index) => `<tspan x="${p.x + p.w / 2}" dy="${index ? 15 : 0}">${escapeHTML(line)}</tspan>`).join('')}</text><text class="arch-type" x="${p.x + p.w / 2}" y="${p.y + p.h - 9}">${escapeHTML(module.type || '')}</text></g>`;
          }).join('')}
          ${reducedMotion ? '' : pathByEdge.map((edge, i) => `<circle class="flow-dot" r="4"><animateMotion dur="${Math.max(2.8, (architecture.flow_ms || 4800) / 1000)}s" begin="${(i * .38).toFixed(2)}s" repeatCount="indefinite"><mpath href="#${edge.id}"/></animateMotion></circle>`).join('')}
        </svg>
      </div>
    </div>
  </section>`;
}

function layoutArchitecture(modules, edges) {
  const ids = new Set(modules.map(module => module.id));
  const adjacency = new Map(modules.map(module => [module.id, []]));
  const incoming = new Map(modules.map(module => [module.id, []]));
  const outgoing = new Map(modules.map(module => [module.id, []]));
  const feedback = new Set();
  const hasPath = (start, target) => {
    const stack = [start], seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      (adjacency.get(current) || []).forEach(next => stack.push(next));
    }
    return false;
  };
  edges.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) return;
    if (edge.kind === 'feedback' || edge.from === edge.to || hasPath(edge.to, edge.from)) feedback.add(index);
    else {
      adjacency.get(edge.from).push(edge.to);
      outgoing.get(edge.from).push(index);
      incoming.get(edge.to).push(index);
    }
  });

  const indegree = new Map(modules.map(module => [module.id, 0]));
  adjacency.forEach(targets => targets.forEach(target => indegree.set(target, indegree.get(target) + 1)));
  const ranks = new Map(modules.map(module => [module.id, 0]));
  const queue = modules.filter(module => indegree.get(module.id) === 0).map(module => module.id);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    (adjacency.get(current) || []).forEach(target => {
      ranks.set(target, Math.max(ranks.get(target), ranks.get(current) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    });
  }

  const groups = new Map();
  modules.forEach(module => {
    const rank = ranks.get(module.id) || 0;
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank).push(module);
  });
  const maxRank = Math.max(0, ...groups.keys());

  // Sugiyama-style barycentric sweeps: reorder nodes inside each layer by the
  // centre of their neighbours in the adjacent/connected layers.  Keeping the
  // best sweep prevents a later pass from trading fewer crossings for a large
  // number of unnecessarily diagonal edges.
  const originalOrder = new Map(modules.map((module, index) => [module.id, index]));
  let order = new Map();
  const refreshOrder = () => {
    order = new Map();
    groups.forEach(group => group.forEach((module, index) => order.set(module.id, index)));
  };
  const normalizedOrder = id => {
    const group = groups.get(ranks.get(id) || 0) || [];
    if (group.length < 2) return .5;
    return (order.get(id) || 0) / (group.length - 1);
  };
  const barycenter = (module, edgeIndexes, useSource) => {
    const values = edgeIndexes.map(index => normalizedOrder(useSource ? edges[index].from : edges[index].to));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const crossingScore = () => {
    refreshOrder();
    const forward = edges.map((edge, index) => ({ ...edge, index }))
      .filter(edge => ids.has(edge.from) && ids.has(edge.to) && !feedback.has(edge.index));
    let crossings = 0;
    for (let i = 0; i < forward.length; i++) {
      for (let j = i + 1; j < forward.length; j++) {
        const a = forward[i], b = forward[j];
        if (ranks.get(a.from) !== ranks.get(b.from) || ranks.get(a.to) !== ranks.get(b.to)) continue;
        if (a.from === b.from || a.to === b.to) continue;
        const sourceDelta = (order.get(a.from) || 0) - (order.get(b.from) || 0);
        const targetDelta = (order.get(a.to) || 0) - (order.get(b.to) || 0);
        if (sourceDelta * targetDelta < 0) crossings++;
      }
    }
    const diagonalCost = forward.reduce((sum, edge) => sum + Math.abs(normalizedOrder(edge.from) - normalizedOrder(edge.to)), 0);
    return crossings * 1000 + diagonalCost;
  };
  refreshOrder();
  let bestGroups = new Map([...groups].map(([rank, group]) => [rank, [...group]]));
  let bestScore = crossingScore();
  for (let pass = 0; pass < 8; pass++) {
    for (let rank = 1; rank <= maxRank; rank++) {
      const group = groups.get(rank) || [];
      const stable = new Map(group.map((module, index) => [module.id, index]));
      group.sort((a, b) => {
        const av = barycenter(a, incoming.get(a.id) || [], true);
        const bv = barycenter(b, incoming.get(b.id) || [], true);
        if (av === null && bv === null) return stable.get(a.id) - stable.get(b.id);
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv || stable.get(a.id) - stable.get(b.id);
      });
      refreshOrder();
    }
    for (let rank = maxRank - 1; rank >= 0; rank--) {
      const group = groups.get(rank) || [];
      const stable = new Map(group.map((module, index) => [module.id, index]));
      group.sort((a, b) => {
        const av = barycenter(a, outgoing.get(a.id) || [], false);
        const bv = barycenter(b, outgoing.get(b.id) || [], false);
        if (av === null && bv === null) return stable.get(a.id) - stable.get(b.id);
        if (av === null) return 1;
        if (bv === null) return -1;
        return av - bv || stable.get(a.id) - stable.get(b.id);
      });
      refreshOrder();
    }
    const score = crossingScore();
    if (score < bestScore) {
      bestScore = score;
      bestGroups = new Map([...groups].map(([rank, group]) => [rank, [...group]]));
    }
  }
  groups.clear();
  bestGroups.forEach((group, rank) => groups.set(rank, group));
  refreshOrder();

  const maxRows = Math.max(1, ...[...groups.values()].map(group => group.length));
  const rowById = new Map();
  groups.forEach(group => group.forEach((module, row) => rowById.set(module.id, row)));
  const validEdges = edges.map((edge, index) => ({ ...edge, index }))
    .filter(edge => ids.has(edge.from) && ids.has(edge.to));
  const estimatedLabelWidth = value => [...String(value || '')].reduce((width, char) =>
    width + (/[^\x00-\xff]/.test(char) ? 8.2 : 4.8), 0);
  const maxDirectLabelWidth = Math.max(0, ...validEdges.map(edge => estimatedLabelWidth(edge.label)));
  const nodeW = 136, nodeH = 72;
  const stepX = Math.max(224, Math.ceil(nodeW + Math.min(154, maxDirectLabelWidth) + 38));
  const rowGap = 42, marginX = 58, laneGap = 18;
  const viewWidth = Math.max(1000, marginX * 2 + nodeW + maxRank * stepX);
  const contentHeight = maxRows * nodeH + Math.max(0, maxRows - 1) * rowGap;
  // Reserve a small bank of genuine outside corridors.  Long/cross-layer edges
  // may use them without sending a vertical leg through another module.
  const outerLaneCount = Math.max(3, Math.min(6, Math.ceil(validEdges.length / 2)));
  const topSpace = 52 + outerLaneCount * laneGap;
  const bottomSpace = 56 + outerLaneCount * laneGap;
  const viewHeight = Math.max(430, topSpace + contentHeight + bottomSpace);
  const extraSpace = viewHeight - topSpace - contentHeight - bottomSpace;
  const nodeTop = topSpace + extraSpace / 2;
  const positions = new Map();
  [...groups.entries()].sort((a, b) => a[0] - b[0]).forEach(([rank, group]) => {
    const groupHeight = group.length * nodeH + Math.max(0, group.length - 1) * rowGap;
    const startY = nodeTop + (contentHeight - groupHeight) / 2;
    group.forEach((module, row) => positions.set(module.id, {
      x: marginX + rank * stepX, y: startY + row * (nodeH + rowGap),
      w: nodeW, h: nodeH, rank, row
    }));
  });

  const contentBottom = nodeTop + contentHeight;
  const routes = routeArchitectureEdges({
    modules, validEdges, positions, ranks, rowById, feedback, originalOrder,
    viewWidth, viewHeight, nodeTop, contentBottom, outerLaneCount, laneGap
  });
  return { positions, feedback, routes, viewWidth, viewHeight };
}

// Orthogonal obstacle router used by every A-level architecture.  It evaluates
// several edge orders and four-sided ports against a sparse visibility grid.
// Existing paths are expensive obstacles too, so a long edge takes a real
// top/bottom corridor instead of cutting vertically through nodes or earlier
// data-flow lines.
function routeArchitectureEdges({
  modules, validEdges, positions, ranks, rowById, feedback, originalOrder,
  viewWidth, viewHeight, nodeTop, contentBottom, outerLaneCount, laneGap
}) {
  const clearance = 12, obstaclePadding = 7;
  const round = value => Math.round(value * 1000) / 1000;
  const pointKey = point => `${round(point.x)}:${round(point.y)}`;
  const plans = new Map(validEdges.map(edge => [edge.index, { edge }]));
  const incidents = new Map(modules.map(module => [module.id, []]));
  validEdges.forEach(edge => {
    incidents.get(edge.from).push({ edge, role: 'source', opposite: positions.get(edge.to) });
    incidents.get(edge.to).push({ edge, role: 'target', opposite: positions.get(edge.from) });
  });
  incidents.forEach(list => {
    list.sort((a, b) => a.opposite.y - b.opposite.y || a.opposite.x - b.opposite.x
      || originalOrder.get(a.edge.from) - originalOrder.get(b.edge.from)
      || originalOrder.get(a.edge.to) - originalOrder.get(b.edge.to)
      || a.edge.index - b.edge.index || a.role.localeCompare(b.role));
    list.forEach((incident, slot) => Object.assign(plans.get(incident.edge.index), {
      [`${incident.role}Slot`]: slot, [`${incident.role}Count`]: list.length
    }));
  });

  const sidePoint = (position, side, slot, count) => {
    const along = (start, length) => count <= 1 ? start + length / 2 : start + 14 + slot * ((length - 28) / (count - 1));
    if (side === 'left') return { port: { x: position.x, y: along(position.y, position.h) }, lead: { x: position.x - clearance, y: along(position.y, position.h) } };
    if (side === 'right') return { port: { x: position.x + position.w, y: along(position.y, position.h) }, lead: { x: position.x + position.w + clearance, y: along(position.y, position.h) } };
    if (side === 'top') return { port: { x: along(position.x, position.w), y: position.y }, lead: { x: along(position.x, position.w), y: position.y - clearance } };
    return { port: { x: along(position.x, position.w), y: position.y + position.h }, lead: { x: along(position.x, position.w), y: position.y + position.h + clearance } };
  };
  plans.forEach(plan => {
    const from = positions.get(plan.edge.from), to = positions.get(plan.edge.to);
    plan.sourcePorts = Object.fromEntries(['left', 'right', 'top', 'bottom'].map(side => [side,
      sidePoint(from, side, plan.sourceSlot || 0, plan.sourceCount || 1)]));
    plan.targetPorts = Object.fromEntries(['left', 'right', 'top', 'bottom'].map(side => {
      // Incoming arcs that use the horizontal sides are ordered top-to-bottom.
      // On top/bottom sides they must be reversed: the farthest-left source
      // receives the farthest port, allowing nested skip connections to close
      // without every inner route crossing the outer route's final stem.
      const slot = side === 'top' || side === 'bottom'
        ? (plan.targetCount || 1) - 1 - (plan.targetSlot || 0)
        : plan.targetSlot || 0;
      return [side, sidePoint(to, side, slot, plan.targetCount || 1)];
    }));
  });

  const xs = new Set([18, viewWidth - 18]), ys = new Set([18, viewHeight - 18]);
  const addX = value => xs.add(round(value));
  const addY = value => ys.add(round(value));
  positions.forEach(position => {
    [position.x - clearance, position.x, position.x + position.w, position.x + position.w + clearance].forEach(addX);
    [position.y - clearance, position.y, position.y + position.h, position.y + position.h + clearance].forEach(addY);
  });
  plans.forEach(plan => {
    Object.values(plan.sourcePorts).concat(Object.values(plan.targetPorts)).forEach(({ port, lead }) => {
      addX(port.x); addY(port.y); addX(lead.x); addY(lead.y);
    });
  });
  const rankXs = [...new Set([...positions.values()].map(position => position.x))].sort((a, b) => a - b);
  for (let index = 0; index < rankXs.length - 1; index++) {
    const left = rankXs[index] + positions.values().next().value.w;
    const right = rankXs[index + 1];
    [left + 24, (left + right) / 2, right - 24].forEach(addX);
  }
  for (let lane = 0; lane < outerLaneCount; lane++) {
    addY(24 + lane * laneGap);
    addY(viewHeight - 24 - lane * laneGap);
  }
  // The middle of every free row gap is useful for short dog-legs and keeps
  // those paths inside the content field instead of needlessly using the rim.
  const yBounds = [...new Set([...positions.values()].flatMap(position => [position.y, position.y + position.h]))].sort((a, b) => a - b);
  for (let index = 0; index < yBounds.length - 1; index++) {
    if (yBounds[index + 1] - yBounds[index] > obstaclePadding * 2 + 4) addY((yBounds[index] + yBounds[index + 1]) / 2);
  }
  addY(nodeTop - 22); addY(contentBottom + 22);

  const xValues = [...xs].sort((a, b) => a - b), yValues = [...ys].sort((a, b) => a - b);
  const obstacles = [...positions.values()].map(position => ({
    left: position.x - obstaclePadding, right: position.x + position.w + obstaclePadding,
    top: position.y - obstaclePadding, bottom: position.y + position.h + obstaclePadding
  }));
  const insideObstacle = point => obstacles.some(box => point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom);
  const segmentBlocked = (a, b) => obstacles.some(box => {
    if (Math.abs(a.y - b.y) < .01) return a.y > box.top && a.y < box.bottom && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right;
    return a.x > box.left && a.x < box.right && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom;
  });
  const grid = [], gridIndex = new Map();
  yValues.forEach(y => xValues.forEach(x => {
    const point = { x, y };
    if (insideObstacle(point)) return;
    gridIndex.set(pointKey(point), grid.length);
    grid.push(point);
  }));
  const adjacencyGrid = Array.from({ length: grid.length }, () => []);
  const link = (a, b) => {
    if (a === undefined || b === undefined || segmentBlocked(grid[a], grid[b])) return;
    const distance = Math.abs(grid[a].x - grid[b].x) + Math.abs(grid[a].y - grid[b].y);
    const direction = Math.abs(grid[a].x - grid[b].x) > .01 ? 1 : 2;
    adjacencyGrid[a].push({ index: b, distance, direction });
    adjacencyGrid[b].push({ index: a, distance, direction });
  };
  yValues.forEach(y => {
    let previous;
    xValues.forEach(x => {
      const current = gridIndex.get(pointKey({ x, y }));
      if (current !== undefined) { if (previous !== undefined) link(previous, current); previous = current; }
      else previous = undefined;
    });
  });
  xValues.forEach(x => {
    let previous;
    yValues.forEach(y => {
      const current = gridIndex.get(pointKey({ x, y }));
      if (current !== undefined) { if (previous !== undefined) link(previous, current); previous = current; }
      else previous = undefined;
    });
  });

  const segmentRelation = (a, b, c, d) => {
    const ah = Math.abs(a.y - b.y) < .01, ch = Math.abs(c.y - d.y) < .01;
    if (ah === ch) {
      const sameLine = ah ? Math.abs(a.y - c.y) < .01 : Math.abs(a.x - c.x) < .01;
      if (!sameLine) return null;
      const [a1, a2, c1, c2] = ah ? [a.x, b.x, c.x, d.x] : [a.y, b.y, c.y, d.y];
      const overlap = Math.min(Math.max(a1, a2), Math.max(c1, c2)) - Math.max(Math.min(a1, a2), Math.min(c1, c2));
      if (overlap > .01) return { kind: 'overlap', amount: overlap };
      if (overlap > -.01) return { kind: 'touch', amount: 0 };
      return null;
    }
    const horizontalA = ah, horizontal = horizontalA ? [a, b] : [c, d], vertical = horizontalA ? [c, d] : [a, b];
    const x = vertical[0].x, y = horizontal[0].y;
    if (x >= Math.min(horizontal[0].x, horizontal[1].x) - .01 && x <= Math.max(horizontal[0].x, horizontal[1].x) + .01
      && y >= Math.min(vertical[0].y, vertical[1].y) - .01 && y <= Math.max(vertical[0].y, vertical[1].y) + .01) {
      const endpoint = [a, b].some(point => Math.abs(point.x - x) < .01 && Math.abs(point.y - y) < .01)
        && [c, d].some(point => Math.abs(point.x - x) < .01 && Math.abs(point.y - y) < .01);
      return { kind: endpoint ? 'touch' : 'cross', amount: 0 };
    }
    return null;
  };
  const pathSegments = points => points.slice(1).map((point, index) => [points[index], point]);
  const segmentPenalty = (a, b, existingPaths) => existingPaths.reduce((sum, path) => sum + pathSegments(path).reduce((inner, [c, d]) => {
    const relation = segmentRelation(a, b, c, d);
    if (!relation) return inner;
    if (relation.kind === 'overlap') return inner + 5000000 + relation.amount * 1000;
    return inner + (relation.kind === 'cross' ? 1000000 : 650000);
  }, 0), 0);

  class MinHeap {
    constructor() { this.items = []; }
    push(item) {
      const items = this.items; items.push(item); let index = items.length - 1;
      while (index) { const parent = (index - 1) >> 1; if (items[parent][0] <= item[0]) break; items[index] = items[parent]; index = parent; }
      items[index] = item;
    }
    pop() {
      const items = this.items, first = items[0], tail = items.pop();
      if (items.length && tail) {
        let index = 0;
        while (true) {
          let child = index * 2 + 1; if (child >= items.length) break;
          if (child + 1 < items.length && items[child + 1][0] < items[child][0]) child++;
          if (items[child][0] >= tail[0]) break;
          items[index] = items[child]; index = child;
        }
        items[index] = tail;
      }
      return first;
    }
    get length() { return this.items.length; }
  }
  const findGridPath = (start, target, existingPaths, forward) => {
    const startIndex = gridIndex.get(pointKey(start)), targetIndex = gridIndex.get(pointKey(target));
    if (startIndex === undefined || targetIndex === undefined) return null;
    const stateCount = grid.length * 3, distances = new Float64Array(stateCount), previous = new Int32Array(stateCount);
    distances.fill(Infinity); previous.fill(-1);
    const startState = startIndex * 3;
    distances[startState] = 0;
    const heuristic = point => Math.abs(point.x - target.x) + Math.abs(point.y - target.y);
    const heap = new MinHeap(); heap.push([heuristic(start), startState, 0]);
    let winner = -1;
    while (heap.length) {
      const [, state, distance] = heap.pop();
      if (distance !== distances[state]) continue;
      const pointIndex = Math.floor(state / 3), priorDirection = state % 3;
      if (pointIndex === targetIndex) { winner = state; break; }
      adjacencyGrid[pointIndex].forEach(next => {
        const a = grid[pointIndex], b = grid[next.index];
        const bend = priorDirection && priorDirection !== next.direction ? 26 : 0;
        const reverse = forward && next.direction === 1 && b.x < a.x ? next.distance * 2.2 : 0;
        const cost = next.distance + bend + reverse + segmentPenalty(a, b, existingPaths);
        const nextState = next.index * 3 + next.direction;
        if (distance + cost >= distances[nextState]) return;
        distances[nextState] = distance + cost; previous[nextState] = state;
        heap.push([distances[nextState] + heuristic(b), nextState, distances[nextState]]);
      });
    }
    if (winner < 0) return null;
    const result = [];
    for (let state = winner; state >= 0; state = previous[state]) {
      result.push(grid[Math.floor(state / 3)]);
      if (state === startState) break;
    }
    return result.reverse();
  };
  const simplify = points => {
    const deduped = points.filter((point, index) => !index || Math.abs(point.x - points[index - 1].x) > .01 || Math.abs(point.y - points[index - 1].y) > .01);
    const result = [];
    deduped.forEach(point => {
      while (result.length > 1) {
        const a = result.at(-2), b = result.at(-1);
        if ((Math.abs(a.x - b.x) < .01 && Math.abs(b.x - point.x) < .01)
          || (Math.abs(a.y - b.y) < .01 && Math.abs(b.y - point.y) < .01)) result.pop();
        else break;
      }
      result.push(point);
    });
    return result;
  };
  const pathStats = (points, existingPaths) => {
    const stats = { crossings: 0, overlaps: 0, touches: 0, overlapLength: 0 };
    pathSegments(points).forEach(([a, b]) => existingPaths.forEach(path => pathSegments(path).forEach(([c, d]) => {
      const relation = segmentRelation(a, b, c, d);
      if (!relation) return;
      if (relation.kind === 'overlap') { stats.overlaps++; stats.overlapLength += relation.amount; }
      else if (relation.kind === 'cross') stats.crossings++;
      else stats.touches++;
    })));
    return stats;
  };
  const pathLength = points => pathSegments(points).reduce((sum, [a, b]) => sum + Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 0);
  const candidatePairs = edge => feedback.has(edge.index)
    ? [['bottom', 'bottom'], ['top', 'top'], ['right', 'left'], ['bottom', 'top'], ['top', 'bottom'], ['right', 'bottom'], ['top', 'left'], ['left', 'right']]
    : [['right', 'left'], ['top', 'top'], ['bottom', 'bottom'], ['right', 'top'], ['right', 'bottom'], ['top', 'left'], ['bottom', 'left'], ['top', 'bottom'], ['bottom', 'top']];
  const orientationBias = (edge, sourceSide, targetSide) => {
    if (feedback.has(edge.index)) return sourceSide === 'bottom' && targetSide === 'bottom' ? 0 : sourceSide === targetSide ? 30 : 70;
    if (sourceSide === 'right' && targetSide === 'left') return 0;
    return sourceSide === targetSide ? 36 : 62;
  };
  const routeOne = (edge, existingPaths) => {
    const plan = plans.get(edge.index), candidates = [];
    candidatePairs(edge).forEach(([sourceSide, targetSide]) => {
      const source = plan.sourcePorts[sourceSide], target = plan.targetPorts[targetSide];
      const middle = findGridPath(source.lead, target.lead, existingPaths, !feedback.has(edge.index));
      if (!middle) return;
      const points = simplify([source.port, source.lead, ...middle, target.lead, target.port]);
      const stats = pathStats(points, existingPaths);
      const score = stats.overlaps * 50000000 + stats.crossings * 10000000 + stats.touches * 5000000
        + stats.overlapLength * 10000 + pathLength(points) + (points.length - 2) * 26
        + orientationBias(edge, sourceSide, targetSide);
      candidates.push({ points, score, sourceSide, targetSide });
    });
    if (candidates.length) return candidates.sort((a, b) => a.score - b.score)[0];
    const source = plan.sourcePorts.right, target = plan.targetPorts.left;
    const laneY = feedback.has(edge.index) ? viewHeight - 24 : 24;
    return { points: simplify([source.port, source.lead, { x: source.lead.x, y: laneY }, { x: target.lead.x, y: laneY }, target.lead, target.port]), sourceSide: 'right', targetSide: 'left' };
  };
  const span = edge => Math.abs((ranks.get(edge.to) || 0) - (ranks.get(edge.from) || 0));
  const rowDistance = edge => Math.abs((rowById.get(edge.to) || 0) - (rowById.get(edge.from) || 0));
  const edgeOrders = [
    [...validEdges].sort((a, b) => Number(feedback.has(a.index)) - Number(feedback.has(b.index)) || span(a) - span(b) || rowDistance(a) - rowDistance(b) || a.index - b.index),
    [...validEdges].sort((a, b) => Number(feedback.has(b.index)) - Number(feedback.has(a.index)) || span(b) - span(a) || rowDistance(b) - rowDistance(a) || a.index - b.index),
    [...validEdges].sort((a, b) => a.index - b.index),
    [...validEdges].sort((a, b) => b.index - a.index),
    [...validEdges].sort((a, b) => rowDistance(b) - rowDistance(a) || span(b) - span(a) || a.index - b.index)
  ];
  const chooseLabelPoint = (points, label = '', isFeedback = false) => {
    const segments = pathSegments(points).map(([a, b], index) => ({ a, b, index, horizontal: Math.abs(a.y - b.y) < .01, length: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) }));
    const labelWidth = [...String(label || '')].reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 8.2 : 4.8), 0);
    const horizontal = segments.filter(item => item.horizontal && item.length >= labelWidth + 14);
    const segment = horizontal.filter(item => item.index && item.index < segments.length - 1).sort((a, b) => b.length - a.length)[0]
      || horizontal.sort((a, b) => b.length - a.length)[0];
    if (segment) return {
      labelX: (segment.a.x + segment.b.x) / 2,
      // Feedback paths commonly run beside the forward path. Put their label
      // below the lane so two baselines cannot collapse onto each other.
      labelY: segment.a.y + (isFeedback ? 18 : -7)
    };
    const vertical = segments.filter(item => !item.horizontal).sort((a, b) => b.length - a.length)[0];
    if (vertical) {
      const rightX = vertical.a.x + labelWidth / 2 + 9;
      const leftX = vertical.a.x - labelWidth / 2 - 9;
      return {
        labelX: rightX + labelWidth / 2 < viewWidth - 12 ? rightX : leftX,
        labelY: (vertical.a.y + vertical.b.y) / 2 + 4
      };
    }
    const fallback = segments.sort((a, b) => b.length - a.length)[0];
    return { labelX: ((fallback?.a.x || 0) + (fallback?.b.x || 0)) / 2, labelY: (fallback?.a.y || 0) - 7 };
  };
  const scoreRoutes = routeMap => {
    let crossings = 0, overlaps = 0, touches = 0, overlapLength = 0, length = 0, bends = 0;
    const paths = validEdges.map(edge => routeMap.get(edge.index).points);
    paths.forEach(path => { length += pathLength(path); bends += Math.max(0, path.length - 2); });
    for (let index = 0; index < paths.length; index++) {
      const stats = pathStats(paths[index], paths.slice(index + 1));
      crossings += stats.crossings; overlaps += stats.overlaps; touches += stats.touches; overlapLength += stats.overlapLength;
    }
    return overlaps * 1e12 + crossings * 1e11 + touches * 1e10 + overlapLength * 1e7 + bends * 1000 + length;
  };
  let bestRoutes, bestScore = Infinity;
  for (const order of edgeOrders) {
    const routeMap = new Map(), existingPaths = [];
    order.forEach(edge => {
      const route = routeOne(edge, existingPaths);
      Object.assign(route, chooseLabelPoint(route.points, edge.label, feedback.has(edge.index)));
      routeMap.set(edge.index, route); existingPaths.push(route.points);
    });
    const score = scoreRoutes(routeMap);
    if (score < bestScore) { bestScore = score; bestRoutes = routeMap; }
    // Any line contact contributes at least 1e10.  Once a completely clean
    // drawing is found, the per-edge search has already minimized bends and
    // length, so further global permutations only delay first paint.
    if (score < 1e10) break;
  }
  const resolvedRoutes = bestRoutes || new Map();
  // Labels are laid out only after every path is known. This keeps a readable
  // caption from sitting on a neighbouring module, another caption, or a data
  // line even when two short forward/feedback lanes are very close together.
  const routePaths = [...resolvedRoutes.values()].map(route => route.points);
  const placedLabels = [];
  const overlapsBox = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const segmentHitsBox = (a, b, box) => {
    if (Math.abs(a.y - b.y) < .01) return a.y > box.top && a.y < box.bottom
      && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right;
    if (Math.abs(a.x - b.x) < .01) return a.x > box.left && a.x < box.right
      && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom;
    return false;
  };
  validEdges.forEach(edge => {
    const route = resolvedRoutes.get(edge.index);
    if (!route || !edge.label) return;
    const width = [...String(edge.label)].reduce((total, char) => total + (/[^\x00-\xff]/.test(char) ? 8.2 : 4.8), 0);
    const initial = chooseLabelPoint(route.points, edge.label, feedback.has(edge.index));
    const candidates = [initial];
    pathSegments(route.points).forEach(([a, b]) => {
      const horizontal = Math.abs(a.y - b.y) < .01;
      for (const fraction of [.5, .34, .66]) {
        if (horizontal) {
          const x = a.x + (b.x - a.x) * fraction;
          const ys = feedback.has(edge.index) ? [a.y + 18, a.y - 7] : [a.y - 7, a.y + 18];
          ys.forEach(y => candidates.push({ labelX: x, labelY: y }));
        } else {
          const y = a.y + (b.y - a.y) * fraction + 4;
          candidates.push({ labelX: a.x + width / 2 + 9, labelY: y });
          candidates.push({ labelX: a.x - width / 2 - 9, labelY: y });
        }
      }
    });
    const unique = [...new Map(candidates.map(candidate => [`${candidate.labelX.toFixed(2)}:${candidate.labelY.toFixed(2)}`, candidate])).values()];
    const ranked = unique.map((candidate, order) => {
      const box = {
        left: candidate.labelX - width / 2 - 3, right: candidate.labelX + width / 2 + 3,
        top: candidate.labelY - 11, bottom: candidate.labelY + 5
      };
      let score = order + Math.abs(candidate.labelX - initial.labelX) * .02 + Math.abs(candidate.labelY - initial.labelY) * .02;
      if (box.left < 8 || box.right > viewWidth - 8 || box.top < 8 || box.bottom > viewHeight - 8) score += 1e12;
      positions.forEach(position => {
        if (overlapsBox(box, { left: position.x - 2, right: position.x + position.w + 2, top: position.y - 2, bottom: position.y + position.h + 2 })) score += 1e10;
      });
      routePaths.forEach(points => pathSegments(points).forEach(([a, b]) => {
        if (segmentHitsBox(a, b, box)) score += 1e8;
      }));
      placedLabels.forEach(other => { if (overlapsBox(box, other)) score += 1e9; });
      return { candidate, box, score };
    }).sort((a, b) => a.score - b.score)[0];
    Object.assign(route, ranked.candidate);
    placedLabels.push(ranked.box);
  });
  return resolvedRoutes;
}

function edgeGeometry(from, to, { feedback = false, route = null, viewHeight = 430 } = {}) {
  if (!from || !to) return { d: '' };
  if (route?.points?.length > 1) {
    const points = route.points;
    const format = value => String(Math.round(value * 100) / 100);
    const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    let d = `M${format(points[0].x)},${format(points[0].y)}`;
    for (let index = 1; index < points.length - 1; index++) {
      const previous = points[index - 1], point = points[index], next = points[index + 1];
      const radius = Math.min(9, distance(previous, point) / 2, distance(point, next) / 2);
      const direction = delta => Math.abs(delta) < .01 ? 0 : Math.sign(delta);
      const before = {
        x: point.x + direction(previous.x - point.x) * radius,
        y: point.y + direction(previous.y - point.y) * radius
      };
      const after = {
        x: point.x + direction(next.x - point.x) * radius,
        y: point.y + direction(next.y - point.y) * radius
      };
      d += ` L${format(before.x)},${format(before.y)} Q${format(point.x)},${format(point.y)} ${format(after.x)},${format(after.y)}`;
    }
    const last = points.at(-1);
    d += ` L${format(last.x)},${format(last.y)}`;
    return { d, labelX: route.labelX, labelY: route.labelY };
  }
  const sx = route?.sx ?? from.x + from.w;
  const sy = route?.sy ?? from.y + from.h / 2;
  const tx = route?.tx ?? to.x;
  const ty = route?.ty ?? to.y + to.h / 2;
  if (feedback || route?.mode === 'feedback' || to.rank <= from.rank) {
    const laneY = route?.laneY ?? viewHeight - 28;
    const d = `M${sx},${sy} C${sx},${sy + 14} ${sx},${laneY - 10} ${sx},${laneY} L${tx},${laneY} C${tx},${laneY - 10} ${tx},${ty + 14} ${tx},${ty}`;
    return { d, labelX: (sx + tx) / 2, labelY: laneY - 7 };
  }

  if (route?.mode === 'direct' || !route) {
    const curve = Math.max(24, (tx - sx) * .46);
    return {
      d: `M${sx},${sy} C${sx + curve},${sy} ${tx - curve},${ty} ${tx},${ty}`,
      labelX: (sx + tx) / 2,
      labelY: route?.labelY ?? (sy + ty) / 2 - 9
    };
  }

  const laneY = route.laneY;
  const gap = Math.max(48, tx - sx);
  const sourceLead = Math.min(32 + (route.sourceOrder || 0) * 6, gap * .4);
  const targetLead = Math.min(32 + (route.targetOrder || 0) * 6, gap * .4);
  let exitX = sx + sourceLead, entryX = tx - targetLead;
  if (entryX - exitX < 16) {
    exitX = sx + gap * .34;
    entryX = sx + gap * .66;
  }
  const sourceDirection = laneY < sy ? -1 : 1;
  const targetDirection = laneY < ty ? -1 : 1;
  const d = `M${sx},${sy} C${sx + 12},${sy} ${exitX},${sy} ${exitX},${sy + sourceDirection * 14} L${exitX},${laneY - sourceDirection * 10} Q${exitX},${laneY} ${exitX + 10},${laneY} L${entryX - 10},${laneY} Q${entryX},${laneY} ${entryX},${laneY - targetDirection * 10} L${entryX},${ty + targetDirection * 14} C${entryX},${ty} ${tx - 12},${ty} ${tx},${ty}`;
  return { d, labelX: (exitX + entryX) / 2, labelY: laneY - 7 };
}

function wrapSvgLabel(value, limit = 20) {
  const text = String(value || '').trim();
  if (!text) return [''];
  const units = char => /[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1;
  const lines = [''];
  let width = 0;
  for (const char of text) {
    const charWidth = units(char);
    if (width + charWidth > limit && lines.length < 2) {
      lines.push(char === ' ' ? '' : char);
      width = char === ' ' ? 0 : charWidth;
    } else if (width + charWidth > limit) {
      lines[1] = `${lines[1].replace(/…$/, '').slice(0, -1)}…`;
      break;
    } else {
      lines[lines.length - 1] += char;
      width += charWidth;
    }
  }
  return lines.map(line => line.trim()).filter(Boolean);
}

function codeSection(model) {
  const code = model.code;
  const lines = Array.isArray(code.lines) ? code.lines : [];
  return `<section class="detail-section reveal-section">
    <div class="detail-section-head"><h2>核心代码</h2><p>来自公开仓库关键路径的教学化摘录，已简化非核心工程细节。右侧中文说明与代码逐行对应。</p></div>
    <div class="code-shell">
      <div class="code-toolbar"><span class="code-source">${escapeHTML(code.source_repo || model.github_url || 'unknown')} · ${escapeHTML(code.source_path || 'unknown')} · 已简化</span><button id="copy-code" class="copy-code" type="button">复制代码</button></div>
      <div class="code-scroll"><table class="code-table"><tbody>${lines.map((line, i) => `<tr><td class="line-no">${i + 1}</td><td class="line-code">${highlightCode(line.code || '')}</td><td class="line-comment">${escapeHTML(line.comment_zh || '')}</td></tr>`).join('')}</tbody></table></div>
    </div>
  </section>`;
}

function highlightCode(code) {
  let safe = escapeHTML(code);
  const tokens = [];
  safe = safe.replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, match => {
    tokens.push(`<span class="tok-str">${match}</span>`);
    return `___TOK${'X'.repeat(tokens.length)}___`;
  });
  safe = safe.replace(/(#.*)$/g, '<span class="tok-com">$1</span>');
  safe = safe.replace(/\b(class|def|return|if|else|elif|for|while|in|import|from|as|with|self|True|False|None|const|let|function|new|await|async)\b/g, '<span class="tok-key">$1</span>');
  safe = safe.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  return safe.replace(/___TOK(X+)___/g, (_, marker) => tokens[marker.length - 1] || '');
}

function setupCodeCopy(model) {
  const button = document.getElementById('copy-code');
  if (!button || !model.code?.lines) return;
  button.addEventListener('click', async () => {
    const text = model.code.lines.map(line => line.code || '').join('\n');
    button.disabled = true;
    button.textContent = '复制中…';
    const copied = await copyCodeText(text);
    const selected = copied ? false : selectCodeBlock();
    button.textContent = copied ? '已复制' : selected ? '已选中 · Ctrl+C' : '复制失败';
    if (copied) toast('核心代码已复制');
    else if (selected) toast('浏览器限制自动复制，代码已选中，请按 Ctrl+C');
    setTimeout(() => { button.textContent = '复制代码'; button.disabled = false; }, 1500);
  });
}

function selectCodeBlock() {
  const code = document.querySelector('.code-table');
  const selection = window.getSelection?.();
  if (!code || !selection) return false;
  const range = document.createRange();
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.rangeCount === 1 && !selection.isCollapsed;
}

async function copyCodeText(text) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Clipboard timeout')), 800))
    ]);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try { copied = document.execCommand('copy'); }
    catch { copied = false; }
    textarea.remove();
    return copied;
  }
}

function animateArchitecture(architecture) {
  const modules = [...document.querySelectorAll('.arch-module')];
  if (!modules.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const stages = [...new Set(modules.map(module => Number(module.dataset.stage) || 0))].sort((a, b) => a - b);
  let index = 0;
  const interval = Math.max(650, (architecture.flow_ms || 4800) / stages.length);
  const timer = setInterval(() => {
    modules.forEach(module => module.classList.toggle('active', Number(module.dataset.stage) === stages[index]));
    index = (index + 1) % stages.length;
  }, interval);
  addEventListener('pagehide', () => clearInterval(timer), { once: true });
}

function buildLineage(model, models) {
  const byId = new Map(models.map(item => [item.id, item]));
  const chain = [model];
  const seen = new Set([model.id]);
  let cursor = model;
  while (isKnown(cursor.lineage_parent) && byId.has(cursor.lineage_parent) && !seen.has(cursor.lineage_parent)) {
    cursor = byId.get(cursor.lineage_parent); chain.unshift(cursor); seen.add(cursor.id);
  }
  let child = models.find(item => item.lineage_parent === chain[chain.length - 1].id && item.category === model.category && !seen.has(item.id));
  while (child) { chain.push(child); seen.add(child.id); child = models.find(item => item.lineage_parent === child.id && item.category === model.category && !seen.has(item.id)); }
  return chain;
}

function setupCitation(model) {
  const button = document.getElementById('citation-button');
  if (!button) return;
  button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = '查询中…';
    const arxivId = arxivIdFromURL(model.paper_url);
    const url = arxivId
      ? `https://api.semanticscholar.org/graph/v1/paper/ARXIV:${encodeURIComponent(arxivId)}?fields=title,citationCount,url,year,externalIds`
      : `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(model.name)}&limit=8&fields=title,citationCount,url,year,externalIds`;
    try {
      const { data, cached, fetchedAt } = await cachedFetchJSON(url, { key: `s2:${model.id}`, ttl: 24 * 60 * 60 * 1000, timeout: 7000 });
      const match = arxivId ? data : (data.data || []).find(item => normalized(item.title) === normalized(model.name) && (!Number.isFinite(Number(model.year)) || Number(item.year) === Number(model.year)));
      if (!match || !Number.isFinite(match.citationCount)) throw new Error('无匹配论文');
      button.textContent = `引用 ${formatCompact(match.citationCount)} 次${liveDataSuffix(cached, fetchedAt)}`;
      button.disabled = false;
    } catch {
      button.hidden = true;
    }
  });
}

function arxivIdFromURL(url) {
  if (!isKnown(url)) return '';
  const match = String(url).match(/arxiv\.org\/(?:abs|pdf)\/([^?#/]+)/i);
  return match ? match[1].replace(/\.pdf$/i, '') : '';
}

async function setupRepoHeat(model) {
  const repo = repoFromURL(model.github_url);
  const element = document.getElementById('repo-heat');
  if (!repo || !element) return;
  try {
    const { data, cached, fetchedAt } = await cachedFetchJSON(`https://api.github.com/repos/${repo}`, { key: `github:${repo}`, ttl: 24 * 60 * 60 * 1000, timeout: 6500 });
    if (!Number.isFinite(data.stargazers_count)) return;
    element.querySelector('dd').textContent = `${formatCompact(data.stargazers_count)} stars · 仓库更新 ${formatDate(data.updated_at)}${liveDataSuffix(cached, fetchedAt)}`;
    element.hidden = false;
  } catch { /* GitHub 未认证限流时静默隐藏 */ }
}

function liveDataSuffix(cached, fetchedAt) {
  if (!cached) return ' · 实时获取';
  const stamp = Number.isFinite(fetchedAt)
    ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(fetchedAt))
    : '时间 unknown';
  return ` · 24小时缓存（抓取于 ${stamp}）`;
}

function normalized(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
