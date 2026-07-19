import { CATEGORIES, loadJSON, escapeHTML, formatDate, formatCompact, initReveals, setQuery, categoryMeta } from '../core.js?v=20260719.9';

const PAGE_SIZE = 30;
const CACHE_TTL = 60 * 60 * 1000;
const STALE_CACHE_TTL = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT = 15_000;

const SOURCES = {
  'arxiv-local': { label: 'arXiv 本地库', short: 'arXiv', live: false },
  openalex: { label: 'OpenAlex', short: 'OpenAlex', live: true },
  'semantic-scholar': { label: 'Semantic Scholar', short: 'S2', live: true },
  'hf-papers': { label: 'Hugging Face Papers', short: 'HF Papers', live: true }
};

const TOPIC_QUERIES = {
  all: 'embodied artificial intelligence computer vision',
  vla: '"vision language action" robotics',
  world: '"world model" video generation',
  detection: '"object detection" computer vision',
  representation: '"visual representation" self supervised vision',
  segmentation: '"image segmentation" computer vision',
  multimodal: '"vision language model" multimodal'
};

const TOPIC_PATTERNS = {
  vla: /vision[\s-]+language[\s-]+action|\bvla\b|robot(?:ic)? manipulation|robot policy|embodied agent/i,
  world: /world model|video generation|video diffusion|physical consistency|environment simulator/i,
  detection: /object detection|object detector|\byolo\b|\bdetr\b|grounded detection/i,
  representation: /visual representation|representation learning|self[\s-]+supervised|image retrieval|vision encoder|contrastive vision/i,
  segmentation: /image segmentation|semantic segmentation|instance segmentation|segment anything|\bsam\b/i,
  multimodal: /vision[\s-]+language model|large vision[\s-]+language|multimodal.*language|\bmllm\b|\bvlm\b/i
};

const LIVE_SOURCE_LOADERS = {
  openalex: fetchOpenAlex,
  'semantic-scholar': fetchSemanticScholar,
  'hf-papers': fetchHuggingFacePapers
};

export async function init() {
  const tabs = document.getElementById('lib-tabs');
  const input = document.getElementById('lib-search');
  const rangeSelect = document.getElementById('lib-range');
  const sortSelect = document.getElementById('lib-sort');
  const sourceSelect = document.getElementById('lib-source');
  const status = document.getElementById('lib-status');
  const sourceStatuses = document.getElementById('source-statuses');
  const results = document.getElementById('lib-results');
  const empty = document.getElementById('lib-empty');
  const moreButton = document.getElementById('lib-more');
  const refreshButton = document.getElementById('live-refresh');
  pruneSourceCaches();

  let library = { generated_at: '', papers: [] };
  let analysisIndex = { papers: {} };
  let localLoadError = '';
  try {
    [library, analysisIndex] = await Promise.all([
      loadJSON('data/papers.json'),
      loadJSON('data/paper_analysis_index.json').catch(() => ({ papers: {} }))
    ]);
  } catch (error) {
    localLoadError = error instanceof Error ? error.message : '无法读取本地论文库';
  }

  const localRecords = (library.papers || []).map(normalizeLocalPaper);
  const liveRecords = new Map(Object.keys(LIVE_SOURCE_LOADERS).map(source => [source, []]));
  const sourceState = new Map([
    ['arxiv-local', { state: localLoadError ? 'error' : 'ready', count: localRecords.length, message: localLoadError }],
    ...Object.keys(LIVE_SOURCE_LOADERS).map(source => [source, { state: 'idle', count: 0, message: '' }])
  ]);

  const params = new URLSearchParams(location.search);
  const state = {
    category: CATEGORIES[params.get('category')] ? params.get('category') : 'all',
    range: ['30', '90', '180'].includes(params.get('range')) ? params.get('range') : 'all',
    sort: params.get('sort') === 'cites' ? 'cites' : 'date',
    source: SOURCES[params.get('source')] ? params.get('source') : 'all',
    query: params.get('q') || '',
    limit: PAGE_SIZE
  };
  input.value = state.query;
  rangeSelect.value = state.range;
  sortSelect.value = state.sort;
  sourceSelect.value = state.source;

  let requestVersion = 0;
  let activeContextKey = '';
  let lastLiveLabel = '尚未请求实时来源';
  let inputTimer = null;
  const analysisCache = new Map();

  function currentPapers() {
    return mergePapers([...localRecords, ...[...liveRecords.values()].flat()]);
  }

  function filtered(papers) {
    const query = state.query.trim().toLowerCase();
    const queryTerms = query.match(/[\p{L}\p{N}]+/gu) || [];
    const liveContext = makeLiveContext(state);
    const liveContextKey = `${liveContext.category}|${liveContext.windowDays}|${liveContext.query.toLowerCase()}`;
    const hasCurrentLiveResults = activeContextKey === liveContextKey;
    const minDate = state.range === 'all' ? null : new Date(Date.now() - Number(state.range) * 86400000);
    let list = papers.filter(paper => {
      if (state.category !== 'all' && paper.category !== state.category) return false;
      if (state.source !== 'all' && !paper.sources.includes(state.source)) return false;
      if (minDate) {
        const published = new Date(paper.published);
        if (Number.isNaN(published.getTime()) || published < minDate) return false;
      }
      if (query) {
        const sourceText = paper.sources.map(source => SOURCES[source]?.label || source).join(' ');
        const haystack = `${paper.title} ${paper.abstract} ${paper.intro_zh || ''} ${(paper.authors || []).join(' ')} ${sourceText}`.toLowerCase();
        const matchesLocalText = queryTerms.every(term => haystack.includes(term));
        const returnedByCurrentLiveQuery = hasCurrentLiveResults && paper.sources.some(source => SOURCES[source]?.live);
        if (!matchesLocalText && !returnedByCurrentLiveQuery) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => state.sort === 'cites'
      ? numericCitation(b) - numericCitation(a) || String(b.published || '').localeCompare(String(a.published || ''))
      : String(b.published || '').localeCompare(String(a.published || '')));
    return list;
  }

  function renderTabs(papers) {
    const sourceScoped = state.source === 'all' ? papers : papers.filter(paper => paper.sources.includes(state.source));
    const counts = { all: sourceScoped.length };
    Object.keys(CATEGORIES).forEach(key => { counts[key] = sourceScoped.filter(paper => paper.category === key).length; });
    tabs.innerHTML = [['all', `全部 ${counts.all}`], ...Object.entries(CATEGORIES).map(([key, meta]) => [key, `${meta.short} ${counts[key]}`])]
      .map(([key, label]) => `<button class="radar-tab" type="button" role="tab" data-tab="${key}" aria-selected="${key === state.category}">${label}</button>`).join('');
  }

  function paperCard(paper, index) {
    const meta = categoryMeta(paper.category);
    const authors = (paper.authors || []).slice(0, 6).join(', ') + ((paper.authors || []).length > 6 ? ' 等' : '');
    const cites = Number.isFinite(paper.citations)
      ? `<span class="paper-cite">被引 ${formatCompact(paper.citations)}${paper.citationSource ? ` · ${escapeHTML(SOURCES[paper.citationSource]?.short || paper.citationSource)}` : ''}</span>`
      : '';
    const intro = paper.intro_zh
      ? `<p class="paper-intro">${escapeHTML(paper.intro_zh)}</p>`
      : '<p class="paper-intro pending">实时元数据尚未进入人工中文导读库；下方仅展示来源提供的英文摘要，论文内容、作者与机构仍需人工核验。</p>';
    const badges = paper.sources.map(source => `<span class="paper-source-badge source-${escapeHTML(source)}">${escapeHTML(SOURCES[source]?.short || source)}</span>`).join('');
    const sourceRows = paper.sourceRecords.map(record => {
      const sourceUrl = safeExternalURL(record.sourceUrl || record.url);
      const link = sourceUrl ? `<a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">来源页 ↗</a>` : '<span>无公开来源页</span>';
      const recordedTitle = record.title && record.title !== paper.title ? `<small>该来源标题：${escapeHTML(record.title)}</small>` : '';
      return `<li><span>${escapeHTML(SOURCES[record.source]?.label || record.source)}</span><time datetime="${escapeHTML(record.published || '')}">${escapeHTML(record.published || '日期 unknown')}</time>${link}${recordedTitle}</li>`;
    }).join('');
    const conflicts = paper.conflicts.length
      ? `<p class="paper-conflict">⚠ ${escapeHTML(paper.conflicts.join('；'))}。各来源原始记录已保留，页面没有强行覆盖。</p>`
      : '';
    const paperUrl = safeExternalURL(paper.url);
    const readAction = paperUrl ? `<a class="button button-primary" href="${escapeHTML(paperUrl)}" target="_blank" rel="noopener noreferrer">打开论文 ↗</a>` : '';
    const analysisId = paper.externalIds?.arxiv || '';
    const analysisEntry = analysisIndex.papers?.[analysisId];
    const analysis = analysisEntry
      ? `<details class="paper-analysis" data-analysis-id="${escapeHTML(analysisId)}" data-analysis-path="${escapeHTML(analysisEntry.path)}">
          <summary>初学者解析与动态方法图 <span>${escapeHTML(analysisEntry.status === 'reviewed' ? '已核验' : '整理中')}</span></summary>
          <div class="paper-analysis-body" data-analysis-body><p class="paper-analysis-loading">展开后加载结构化解析…</p></div>
        </details>`
      : '';
    return `<article class="paper-card reveal-item" style="--delay:${(index % 6) * 70}ms">
      <div class="paper-meta">
        <span class="category-badge" style="--badge-color:${meta.color}">${escapeHTML(meta.short)}</span>
        <span>${cites}<time datetime="${escapeHTML(paper.published || '')}">${escapeHTML(paper.published ? formatDate(paper.published) : '日期 unknown')}</time></span>
      </div>
      <div class="paper-source-badges" aria-label="元数据来源">${badges}</div>
      <h2>${escapeHTML(paper.title)}</h2>
      ${intro}
      <p class="paper-authors" title="${escapeHTML((paper.authors || []).join(', '))}">${escapeHTML(authors || '作者元数据待确认')}</p>
      <details class="paper-abstract"><summary>英文摘要</summary><p>${escapeHTML(paper.abstract || '来源未提供摘要')}</p></details>
      <details class="paper-provenance"><summary>来源记录 ${paper.sourceRecords.length}${paper.conflicts.length ? ' · 有差异' : ''}</summary>${conflicts}<ul>${sourceRows}</ul></details>
      ${analysis}
      <div class="paper-actions">
        ${readAction}
        <a class="button button-ghost" href="https://github.com/search?q=${encodeURIComponent(paper.title)}&type=repositories" target="_blank" rel="noopener noreferrer">搜索实现</a>
      </div>
    </article>`;
  }

  function renderSourceStates() {
    sourceStatuses.innerHTML = Object.entries(SOURCES).map(([source, meta]) => {
      const item = sourceState.get(source) || { state: 'idle', count: 0, message: '' };
      const stateLabel = {
        idle: '待请求', loading: '检索中', ready: `${item.count} 条`, cached: `缓存 ${item.count} 条`, stale: `旧缓存 ${item.count} 条`, error: '暂不可用'
      }[item.state] || item.state;
      const accessible = `${meta.label}：${stateLabel}${item.message ? `，${item.message}` : ''}`;
      return `<span class="source-status state-${escapeHTML(item.state)}" title="${escapeHTML(item.message || '')}" aria-label="${escapeHTML(accessible)}"><i></i>${escapeHTML(meta.short)} · ${escapeHTML(stateLabel)}</span>`;
    }).join('');
    const loading = [...sourceState.values()].some(item => item.state === 'loading');
    refreshButton.disabled = loading;
    refreshButton.textContent = loading ? '实时检索中…' : '检索实时来源';
  }

  function render() {
    const papers = currentPapers();
    renderTabs(papers);
    const list = filtered(papers);
    const visible = list.slice(0, state.limit);
    results.innerHTML = visible.map(paperCard).join('');
    results.hidden = !visible.length;
    empty.hidden = visible.length > 0;
    empty.querySelector('h2').textContent = '没有匹配的论文';
    empty.querySelector('p').textContent = state.source !== 'all' && sourceState.get(state.source)?.state === 'error'
      ? '该实时来源当前不可用；可切换到“全部来源”继续使用本地库和其他来源。'
      : '试着放宽时间范围、换一个方向、减少关键词，或重新检索实时来源。';
    moreButton.hidden = list.length <= state.limit;
    const updated = library.generated_at ? formatDate(library.generated_at) : 'unknown';
    const withIntro = papers.filter(paper => paper.intro_zh).length;
    const liveMerged = papers.filter(paper => paper.sources.some(source => SOURCES[source]?.live)).length;
    const conflicts = papers.filter(paper => paper.conflicts.length).length;
    const sourceIssues = [...sourceState.entries()]
      .filter(([, item]) => ['error', 'stale'].includes(item.state))
      .map(([source, item]) => `${SOURCES[source]?.short || source}：${item.message}`);
    status.textContent = `筛选出 ${list.length} / ${papers.length} 篇 · ${withIntro} 篇有人工中文导读 · ${liveMerged} 篇含实时来源${conflicts ? ` · ${conflicts} 篇有来源差异` : ''} · 本地库更新于 ${updated} · ${lastLiveLabel}${sourceIssues.length ? ` · ${sourceIssues.join('；')}` : ''}`;
    renderSourceStates();
    initReveals(results);
  }

  function sync() {
    setQuery({
      category: state.category === 'all' ? null : state.category,
      range: state.range === 'all' ? null : state.range,
      sort: state.sort === 'date' ? null : state.sort,
      source: state.source === 'all' ? null : state.source,
      q: state.query || null
    });
    render();
  }

  async function refreshLive({ force = false } = {}) {
    const context = makeLiveContext(state);
    const contextKey = `${context.category}|${context.windowDays}|${context.query.toLowerCase()}`;
    const version = ++requestVersion;
    if (contextKey !== activeContextKey) {
      liveRecords.forEach((_, source) => { liveRecords.set(source, []); });
      activeContextKey = contextKey;
    }
    lastLiveLabel = `实时检索词：${context.query}`;

    Object.keys(LIVE_SOURCE_LOADERS).forEach(source => {
      sourceState.set(source, { state: 'loading', count: liveRecords.get(source)?.length || 0, message: '' });
    });
    render();

    await Promise.all(Object.entries(LIVE_SOURCE_LOADERS).map(async ([source, loader]) => {
      const key = cacheKey(source, context);
      const cached = !force ? readSourceCache(key, CACHE_TTL) : null;
      if (cached) {
        if (version !== requestVersion) return;
        liveRecords.set(source, cached.records);
        sourceState.set(source, { state: 'cached', count: cached.records.length, message: `缓存于 ${formatDate(cached.savedAt)}` });
        render();
        return;
      }
      try {
        const records = await loader(context);
        if (version !== requestVersion) return;
        liveRecords.set(source, records);
        sourceState.set(source, { state: 'ready', count: records.length, message: '' });
        writeSourceCache(key, records);
      } catch (error) {
        if (version !== requestVersion) return;
        const stale = readSourceCache(key, STALE_CACHE_TTL);
        const message = friendlySourceError(error);
        if (stale) {
          liveRecords.set(source, stale.records);
          sourceState.set(source, { state: 'stale', count: stale.records.length, message: `${message}；暂用 24 小时内旧缓存` });
        } else {
          liveRecords.set(source, []);
          sourceState.set(source, { state: 'error', count: 0, message });
        }
      }
      render();
    }));

    if (version === requestVersion) render();
  }

  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (!button || button.dataset.tab === state.category) return;
    state.category = button.dataset.tab;
    state.limit = PAGE_SIZE;
    sync();
    refreshLive();
  });

  input.addEventListener('input', () => {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      state.query = input.value;
      state.limit = PAGE_SIZE;
      sync();
    }, 250);
  });
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    clearTimeout(inputTimer);
    state.query = input.value;
    state.limit = PAGE_SIZE;
    sync();
    refreshLive({ force: true });
  });
  rangeSelect.addEventListener('change', () => {
    state.range = rangeSelect.value;
    state.limit = PAGE_SIZE;
    sync();
    refreshLive();
  });
  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; state.limit = PAGE_SIZE; sync(); });
  sourceSelect.addEventListener('change', () => { state.source = sourceSelect.value; state.limit = PAGE_SIZE; sync(); });
  moreButton.addEventListener('click', () => { state.limit += PAGE_SIZE; render(); });
  refreshButton.addEventListener('click', () => {
    clearTimeout(inputTimer);
    state.query = input.value;
    state.limit = PAGE_SIZE;
    sync();
    refreshLive({ force: true });
  });
  results.addEventListener('click', event => {
    const summary = event.target.closest('.paper-analysis > summary');
    if (!summary) return;
    const details = summary.parentElement;
    if (details.open || details.dataset.loaded === 'true') return;
    window.setTimeout(() => loadPaperAnalysis(details, analysisCache), 0);
  });

  render();
  refreshLive();
}

async function loadPaperAnalysis(details, cache) {
  const body = details.querySelector('[data-analysis-body]');
  const path = details.dataset.analysisPath;
  if (!body || !path) return;
  try {
    let payload = cache.get(path);
    if (!payload) {
      payload = await loadJSON(path);
      cache.set(path, payload);
    }
    body.innerHTML = renderPaperAnalysis(payload);
    details.dataset.loaded = 'true';
  } catch (error) {
    body.innerHTML = `<p class="paper-analysis-error">解析暂时无法加载：${escapeHTML(error instanceof Error ? error.message : 'unknown')}</p>`;
  }
}

function renderPaperAnalysis(payload) {
  const beginner = payload.beginner || {};
  const method = payload.method || {};
  const steps = (beginner.steps || []).map((step, index) => `<li><b>${String(index + 1).padStart(2, '0')}</b><span>${escapeHTML(step)}</span></li>`).join('');
  const contributions = (method.key_contributions || []).map(item => `<li>${escapeHTML(item)}</li>`).join('');
  const limitations = (method.limitations || []).map(item => `<li>${escapeHTML(item)}</li>`).join('');
  const evidence = (method.evidence || []).map(item => `<article><span>${escapeHTML(item.dimension)}</span><b>${escapeHTML(item.rating)}</b><p>${escapeHTML(item.note)}</p></article>`).join('');
  return `<div class="paper-analysis-lead">
      <span>BEGINNER'S MAP</span>
      <h3>${escapeHTML(beginner.one_sentence || payload.title || '')}</h3>
      <p>${escapeHTML(payload.evidence_scope || '')}</p>
    </div>
    <div class="paper-analysis-columns">
      <section><h4>它解决什么问题</h4><p>${escapeHTML(beginner.problem || '')}</p></section>
      <section><h4>直觉类比</h4><p>${escapeHTML(beginner.intuition || '')}</p></section>
    </div>
    <ol class="paper-method-steps">${steps}</ol>
    ${renderPaperFlow(payload.flow || {})}
    <div class="paper-analysis-columns paper-analysis-lists">
      <section><h4>真正的增量</h4><ul>${contributions}</ul></section>
      <section><h4>阅读时别忽略</h4><ul>${limitations}</ul></section>
    </div>
    <div class="paper-evidence-grid">${evidence}</div>`;
}

function renderPaperFlow(flow) {
  const nodes = flow.nodes || [];
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const edges = (flow.edges || []).map(edge => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return '';
    const x1 = Number(from.x) + 150;
    const y1 = Number(from.y) + 32;
    const x2 = Number(to.x);
    const y2 = Number(to.y) + 32;
    const path = edge.curve
      ? `M ${x1} ${y1} C ${x1 + 80} 330, ${x2 - 80} 330, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1 + 45} ${y1}, ${x2 - 45} ${y2}, ${x2} ${y2}`;
    const labelX = (x1 + x2) / 2;
    const labelY = edge.curve ? 310 : (y1 + y2) / 2 - 8;
    return `<path class="paper-flow-edge" d="${path}" marker-end="url(#paper-flow-arrow)"/><text class="paper-flow-label" x="${labelX}" y="${labelY}">${escapeHTML(edge.label || '')}</text>`;
  }).join('');
  const nodeMarkup = nodes.map(node => `<g class="paper-flow-node${node.accent ? ' is-accent' : ''}" transform="translate(${Number(node.x)},${Number(node.y)})">
      <title>${escapeHTML(node.note || node.label || '')}</title><rect width="150" height="64" rx="12"/><text x="75" y="29" text-anchor="middle">${escapeHTML(node.label || '')}</text><text class="paper-flow-hint" x="75" y="47" text-anchor="middle">悬停查看</text>
    </g>`).join('');
  return `<figure class="paper-flow"><figcaption>${escapeHTML(flow.title || '方法流程')}</figcaption><div><svg viewBox="0 0 1050 350" role="img" aria-label="${escapeHTML(flow.title || '论文方法流程图')}"><defs><marker id="paper-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edges}${nodeMarkup}</svg></div></figure>`;
}

function normalizeLocalPaper(paper) {
  const arxiv = extractArxivId(paper.id || paper.url);
  return {
    source: 'arxiv-local',
    sourceId: arxiv || String(paper.id || ''),
    sourceUrl: paper.url,
    category: paper.category,
    title: String(paper.title || '').trim(),
    abstract: String(paper.abstract || '').trim(),
    published: normalizeDate(paper.published),
    authors: cleanAuthors(paper.authors),
    url: paper.url,
    citations: Number.isFinite(paper.citations) ? paper.citations : null,
    intro_zh: paper.intro_zh || '',
    externalIds: { arxiv, doi: canonicalDoi(paper.doi) }
  };
}

async function fetchOpenAlex(context) {
  const params = new URLSearchParams({
    search: context.query,
    filter: `from_publication_date:${context.fromDate},to_publication_date:${context.toDate},is_retracted:false`,
    'per-page': '40',
    select: 'id,doi,title,display_name,publication_date,ids,primary_location,best_oa_location,authorships,abstract_inverted_index,cited_by_count,is_retracted,relevance_score'
  });
  const payload = await fetchJSON(`https://api.openalex.org/works?${params}`);
  return (payload.results || []).map(item => {
    const title = String(item.title || item.display_name || '').trim();
    const abstract = invertAbstract(item.abstract_inverted_index);
    const category = resolveLiveCategory(`${title} ${abstract}`, context);
    if (!title || !category || item.is_retracted) return null;
    const ids = item.ids || {};
    const arxiv = extractArxivId(ids.arxiv);
    const doi = canonicalDoi(item.doi || ids.doi);
    const sourceUrl = safeExternalURL(item.id);
    const landing = item.best_oa_location?.landing_page_url || item.primary_location?.landing_page_url;
    return {
      source: 'openalex',
      sourceId: String(item.id || ''),
      sourceUrl,
      category,
      title,
      abstract,
      published: normalizeDate(item.publication_date),
      authors: cleanAuthors((item.authorships || []).map(entry => entry.author?.display_name)),
      url: arxiv ? `https://arxiv.org/abs/${arxiv}` : doi ? `https://doi.org/${doi}` : landing || sourceUrl,
      citations: Number.isFinite(item.cited_by_count) ? item.cited_by_count : null,
      intro_zh: '',
      externalIds: { arxiv, doi, openalex: String(item.id || '').split('/').pop() || '' }
    };
  }).filter(Boolean).sort((a, b) => String(b.published).localeCompare(String(a.published)));
}

async function fetchSemanticScholar(context) {
  const params = new URLSearchParams({
    query: context.query,
    limit: '30',
    fields: 'title,abstract,authors,publicationDate,url,externalIds,citationCount,openAccessPdf'
  });
  const payload = await fetchJSON(`https://api.semanticscholar.org/graph/v1/paper/search?${params}`);
  return (payload.data || []).map(item => {
    const title = String(item.title || '').trim();
    const abstract = String(item.abstract || '').trim();
    const category = resolveLiveCategory(`${title} ${abstract}`, context);
    const published = normalizeDate(item.publicationDate);
    if (!title || !category || !published || published < context.fromDate || published > context.toDate) return null;
    const arxiv = extractArxivId(item.externalIds?.ArXiv);
    const doi = canonicalDoi(item.externalIds?.DOI);
    const sourceUrl = safeExternalURL(item.url);
    return {
      source: 'semantic-scholar',
      sourceId: String(item.paperId || ''),
      sourceUrl,
      category,
      title,
      abstract,
      published,
      authors: cleanAuthors((item.authors || []).map(author => author.name)),
      url: arxiv ? `https://arxiv.org/abs/${arxiv}` : doi ? `https://doi.org/${doi}` : item.openAccessPdf?.url || sourceUrl,
      citations: Number.isFinite(item.citationCount) ? item.citationCount : null,
      intro_zh: '',
      externalIds: { arxiv, doi, s2: String(item.paperId || '') }
    };
  }).filter(Boolean).sort((a, b) => String(b.published).localeCompare(String(a.published)));
}

async function fetchHuggingFacePapers(context) {
  const payload = await fetchJSON('https://huggingface.co/api/daily_papers?limit=100');
  return (Array.isArray(payload) ? payload : []).map(item => {
    const paper = item.paper || item;
    const title = String(paper.title || item.title || '').trim();
    const abstract = String(paper.summary || item.summary || '').trim();
    const haystack = `${title} ${abstract}`;
    if (context.customQuery && !matchesLooseQuery(haystack, context.query)) return null;
    const category = resolveLiveCategory(haystack, context);
    const published = normalizeDate(paper.publishedAt || item.publishedAt);
    if (!title || !category || !published || published < context.fromDate || published > context.toDate) return null;
    const arxiv = extractArxivId(paper.id);
    const sourceUrl = arxiv ? `https://huggingface.co/papers/${arxiv}` : '';
    return {
      source: 'hf-papers',
      sourceId: arxiv || String(paper.id || ''),
      sourceUrl,
      category,
      title,
      abstract,
      published,
      authors: cleanAuthors((paper.authors || []).map(author => author.name || author.user?.fullname)),
      url: arxiv ? `https://arxiv.org/abs/${arxiv}` : paper.projectPage || sourceUrl,
      citations: null,
      intro_zh: '',
      externalIds: { arxiv, doi: '' }
    };
  }).filter(Boolean).sort((a, b) => String(b.published).localeCompare(String(a.published)));
}

async function fetchJSON(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'AbortError' || !error?.status || error.status === 429 || error.status >= 500;
      if (attempt >= 1 || !retryable) {
        try { error.retried = attempt > 0; } catch { /* non-extensible error */ }
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 650));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function makeLiveContext(state) {
  const custom = state.query.trim();
  const windowDays = state.range === 'all' ? 180 : Number(state.range);
  const to = new Date();
  const from = new Date(to.getTime() - windowDays * 86400000);
  return {
    category: state.category,
    query: custom.length >= 2 ? custom : TOPIC_QUERIES[state.category] || TOPIC_QUERIES.all,
    customQuery: custom.length >= 2,
    windowDays,
    fromDate: isoDay(from),
    toDate: isoDay(to)
  };
}

function resolveLiveCategory(text, context) {
  if (context.category !== 'all') {
    if (context.customQuery || TOPIC_PATTERNS[context.category]?.test(text)) return context.category;
    return null;
  }
  return classifyCategory(text) || (context.customQuery ? 'unknown' : null);
}

function classifyCategory(text) {
  return Object.keys(TOPIC_PATTERNS).find(category => TOPIC_PATTERNS[category].test(text)) || null;
}

function mergePapers(records) {
  const groups = [];
  const aliases = new Map();
  records.filter(record => record?.title).forEach(record => {
    const keys = recordKeys(record);
    const matches = [...new Set(keys.map(key => aliases.get(key)).filter(Boolean))];
    let group = matches[0];
    if (!group) {
      group = { records: [], keys: new Set() };
      groups.push(group);
    }
    if (matches.length > 1) {
      matches.slice(1).forEach(other => {
        other.records.forEach(item => group.records.push(item));
        other.keys.forEach(key => { group.keys.add(key); aliases.set(key, group); });
        const index = groups.indexOf(other);
        if (index >= 0) groups.splice(index, 1);
      });
    }
    group.records.push(record);
    keys.forEach(key => { group.keys.add(key); aliases.set(key, group); });
  });
  return groups.map(finalizeGroup);
}

function finalizeGroup(group) {
  const priority = ['arxiv-local', 'hf-papers', 'semantic-scholar', 'openalex'];
  const records = [...group.records].sort((a, b) => priority.indexOf(a.source) - priority.indexOf(b.source));
  const primary = records[0];
  const introRecord = records.find(record => record.intro_zh);
  const citationRecord = records.find(record => Number.isFinite(record.citations));
  const sources = [...new Set(records.map(record => record.source))];
  const conflicts = [];
  const titles = [...new Set(records.map(record => normalizeTitle(record.title)).filter(Boolean))];
  const dates = [...new Set(records.map(record => record.published).filter(Boolean))];
  const arxivIds = [...new Set(records.map(record => record.externalIds?.arxiv).filter(Boolean))];
  const dois = [...new Set(records.map(record => record.externalIds?.doi).filter(Boolean))];
  const categories = [...new Set(records.map(record => record.category).filter(Boolean))];
  const authorSets = [...new Set(records.filter(record => record.authors?.length).map(record => record.authors.map(normalizeTitle).filter(Boolean).sort().join('|')))];
  const abstracts = [...new Set(records.map(record => normalizeComparable(record.abstract)).filter(text => text.length >= 80))];
  const citations = [...new Set(records.map(record => record.citations).filter(Number.isFinite))];
  if (titles.length > 1) conflicts.push('来源标题记录不一致');
  if (dates.length > 1) conflicts.push('来源发布日期记录不一致');
  if (arxivIds.length > 1) conflicts.push('来源 arXiv 标识不一致');
  if (dois.length > 1) conflicts.push('来源 DOI 不一致');
  if (categories.length > 1) conflicts.push('来源类别判断不一致');
  if (authorSets.length > 1) conflicts.push('来源作者记录不一致');
  if (abstracts.length > 1) {
    const longest = [...abstracts].sort((a, b) => b.length - a.length)[0];
    if (abstracts.some(text => !longest.includes(text) && !text.includes(longest))) conflicts.push('来源摘要记录不一致');
  }
  if (citations.length > 1) conflicts.push('来源引用数快照不一致');
  return {
    id: primary.sourceId || normalizeTitle(primary.title),
    category: records.find(record => record.source === 'arxiv-local')?.category || primary.category,
    title: primary.title,
    abstract: records.find(record => record.abstract)?.abstract || '',
    published: primary.published,
    authors: records.find(record => record.authors?.length)?.authors || [],
    url: primary.url || records.find(record => record.url)?.url || '',
    citations: citationRecord?.citations ?? null,
    citationSource: citationRecord?.source || '',
    intro_zh: introRecord?.intro_zh || '',
    sources,
    sourceRecords: records,
    conflicts
  };
}

function recordKeys(record) {
  const keys = [];
  const arxiv = record.externalIds?.arxiv || extractArxivId(record.url);
  const doi = record.externalIds?.doi || canonicalDoi(record.url);
  const title = normalizeTitle(record.title);
  if (arxiv) keys.push(`arxiv:${arxiv.toLowerCase()}`);
  if (doi) keys.push(`doi:${doi.toLowerCase()}`);
  if (title) keys.push(`title:${title}`);
  if (!keys.length) keys.push(`${record.source}:${record.sourceId}`);
  return keys;
}

function cacheKey(source, context) {
  return `atlas:radar:multi:v1:${source}:${hashText(`${context.category}|${context.windowDays}|${context.query.toLowerCase()}`)}`;
}

function readSourceCache(key, maxAge) {
  try {
    const payload = JSON.parse(localStorage.getItem(key) || 'null');
    if (!payload || !Array.isArray(payload.records) || !Number.isFinite(payload.savedAt)) {
      localStorage.removeItem(key);
      return null;
    }
    const age = Date.now() - payload.savedAt;
    if (age > STALE_CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    if (age > maxAge) return null;
    return payload;
  } catch {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
    return null;
  }
}

function pruneSourceCaches() {
  try {
    const prefix = 'atlas:radar:multi:v1:';
    const expired = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const payload = JSON.parse(localStorage.getItem(key) || 'null');
        if (!payload || !Array.isArray(payload.records) || !Number.isFinite(payload.savedAt) || Date.now() - payload.savedAt > STALE_CACHE_TTL) expired.push(key);
      } catch { expired.push(key); }
    }
    expired.forEach(key => localStorage.removeItem(key));
  } catch {
    // Private browsing or disabled storage must not break the local library.
  }
}

function writeSourceCache(key, records) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), records }));
  } catch {
    // Private browsing or a full storage quota must not break the live radar.
  }
}

function friendlySourceError(error) {
  const retried = error?.retried ? '，已自动重试 1 次' : '';
  if (error?.name === 'AbortError') return `请求超时${retried}；本地库和其他来源仍可用`;
  if (error?.status === 429) return `公开接口暂时限流${retried}；可用“检索实时来源”稍后再试`;
  if (error?.status) return `公开接口返回 HTTP ${error.status}${retried}`;
  return `断网、跨域策略或公开接口暂时不可用${retried}`;
}

function invertAbstract(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  Object.entries(index).forEach(([word, positions]) => {
    (positions || []).forEach(position => { words[Number(position)] = word; });
  });
  return words.filter(Boolean).join(' ');
}

function extractArxivId(value) {
  const text = String(value || '').trim();
  const match = text.match(/(?:arxiv\.org\/(?:abs|pdf)\/|^)(\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?(?:\.pdf)?$/i);
  return match ? match[1] : '';
}

function canonicalDoi(value) {
  const text = String(value || '').trim();
  const match = text.match(/(?:doi\.org\/|doi:)?(10\.\d{4,9}\/\S+)/i);
  return match ? match[1].replace(/[).,;]+$/, '').toLowerCase() : '';
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeComparable(value) {
  return String(value || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]+/gu, '').trim();
}

function cleanAuthors(authors) {
  return [...new Set((authors || []).map(author => String(author || '').trim()).filter(Boolean))];
}

function matchesLooseQuery(text, query) {
  const haystack = String(text || '').toLowerCase();
  const needle = String(query || '').toLowerCase().replace(/[“”"']/g, '').trim();
  if (!needle) return true;
  if (haystack.includes(needle)) return true;
  const tokens = needle.split(/\s+/).filter(token => token.length > 1);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token));
}

function safeExternalURL(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function numericCitation(paper) {
  return Number.isFinite(paper.citations) ? paper.citations : -1;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
