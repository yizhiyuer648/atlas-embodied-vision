import { CATEGORIES, escapeHTML, initReveals, loadJSON } from '../core.js?v=20260719.11';

const DATA_URL = 'data/academic_tracker.json';
const VIEWS = {
  journals: { label: 'SCI 期刊', kicker: 'JOURNAL WATCH' },
  conferences: { label: '学术会议', kicker: 'CONFERENCE WATCH' },
  compare: { label: '会议 vs SCI', kicker: 'READING STRATEGY' }
};
let publicationStatusLabels = new Map();

function safeURL(value) {
  try {
    const url = new URL(value, location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}

function currentView() {
  const requested = new URLSearchParams(location.search).get('view');
  return Object.hasOwn(VIEWS, requested) ? requested : 'journals';
}

function areaLabel(key) {
  return CATEGORIES[key]?.short || key;
}

function externalLink(url, label, className = 'text-link') {
  const href = safeURL(url);
  if (href === '#') return '<span class="academic-link-disabled">链接待核验</span>';
  return `<a class="${className}" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(label)} <span aria-hidden="true">↗</span></a>`;
}

function renderTabs(active) {
  const root = document.getElementById('academic-view-tabs');
  root.innerHTML = Object.entries(VIEWS).map(([key, item]) => {
    const href = `venues.html?view=${key}`;
    return `<a href="${href}" class="academic-view-tab ${active === key ? 'active' : ''}" ${active === key ? 'aria-current="page"' : ''}><small>${escapeHTML(item.kicker)}</small><strong>${escapeHTML(item.label)}</strong></a>`;
  }).join('');
}

function renderOverview(data, view) {
  const root = document.getElementById('academic-overview');
  const summary = data.editorial_summaries?.[view] || data.editorial_summary;
  const publicationType = view === 'journals' ? 'journal' : view === 'conferences' ? 'conference' : '';
  const count = publicationType
    ? data.publication_events.filter(event => event.publication_type === publicationType).length
    : data.direction_comparisons.length;
  const noun = view === 'journals' ? '期刊发表事件' : view === 'conferences' ? '会议发表事件' : '技术方向';
  root.innerHTML = `
    <article class="academic-summary-card">
      <div class="academic-summary-index"><span>SNAPSHOT</span><strong>${escapeHTML(data.snapshot_date)}</strong></div>
      <div>
        <p class="eyebrow">${escapeHTML(summary.title)}</p>
        <h2>${escapeHTML(summary.interpretation)}</h2>
        <p>${escapeHTML(summary.fact)}</p>
      </div>
    </article>
    <div class="academic-mini-metrics" aria-label="当前视图概况">
      <article><strong>${count}</strong><span>${noun}</span></article>
      <article><strong>${data.platforms.length}</strong><span>来源平台</span></article>
      <article><strong>${data.evidence_levels.length}</strong><span>证据等级</span></article>
    </div>
    <p class="academic-status-note"><strong>核验边界：</strong>${escapeHTML(data.status_note)}</p>`;
}

function renderPublicationEvents(data, kind) {
  const publicationType = kind === 'journals' ? 'journal' : 'conference';
  const venueById = new Map([...data.journals, ...data.conferences].map(venue => [venue.id, venue]));
  const events = data.publication_events
    .filter(event => event.publication_type === publicationType)
    .sort((a, b) => String(b.event_date).localeCompare(String(a.event_date), 'zh-CN'));
  const label = publicationType === 'journal' ? '期刊' : '会议';
  const note = publicationType === 'journal'
    ? '这里的“发表事件”由出版方正式文章页确认；期刊是否处于当期 SCI/SCIE 索引仍单独保持待核验。'
    : '这里只记录官方论文集或正式会议页面已经确认的事件，不把 arXiv 投稿或社区自述当作录用。';
  return `
    <section class="publication-events" aria-labelledby="publication-events-title">
      <header class="academic-section-heading reveal-section">
        <div><p class="eyebrow">REVIEWED PUBLICATION EVENTS</p><h2 id="publication-events-title">最近核验的${label}发表事件</h2></div>
        <p>${note} 卡片不复制摘要，只保留状态、方法信号和规范身份。</p>
      </header>
      <div class="publication-event-grid">
        ${events.map((event, index) => {
          const venue = venueById.get(event.venue_id);
          const meta = CATEGORIES[event.category] || { short: event.category, color: '#c6613f' };
          const status = publicationStatusLabels.get(event.status) || event.status || '状态未知';
          return `<article class="publication-event-card reveal-item" style="--event-color:${meta.color};--delay:${(index % 3) * 80}ms">
            <div class="publication-event-top">
              <span class="publication-event-date">${escapeHTML(event.event_date)}</span>
              <span class="publication-status" data-status="${escapeHTML(event.status)}">${escapeHTML(status)}</span>
            </div>
            <p class="publication-event-venue">${escapeHTML(venue?.acronym || event.venue_id)} · ${escapeHTML(meta.short)}</p>
            <h3>${escapeHTML(event.title)}</h3>
            <div class="method-tags">${event.methods.map(method => `<span>${escapeHTML(method)}</span>`).join('')}</div>
            <div class="evidence-block fact-block"><span>${escapeHTML(dataPolicy.factLabel)}</span><p>${escapeHTML(event.fact_zh)}</p></div>
            <div class="evidence-block observation-block"><span>${escapeHTML(dataPolicy.observationLabel)}</span><p>${escapeHTML(event.atlas_observation_zh)}</p></div>
            <p class="publication-identity"><strong>规范 ID</strong>${escapeHTML(event.paper_id)} <span>${escapeHTML(event.evidence_level)} · 核验于 ${escapeHTML(event.last_verified)}</span></p>
            <div class="venue-actions">
              ${externalLink(event.source_url, '正式来源', 'button button-ghost')}
              <a class="button button-ghost" href="radar.html?q=${encodeURIComponent(event.title)}">在论文雷达检索</a>
            </div>
          </article>`;
        }).join('')}
      </div>
    </section>`;
}

function renderVenueCards(items, kind, data) {
  const isJournal = kind === 'journals';
  const title = isJournal ? 'SCI 期刊观察清单' : '学术会议观察清单';
  const intro = isJournal
    ? '“SCI”在这里是检索视角，不是静态认证。每本期刊的当期索引状态都保留为“待核验”，不展示分区或影响因子。'
    : '会议卡片只记录稳定入口与研究观察，不缓存易过期的日期、截稿时间或录用率；当届信息请打开官网核对。';
  return `${renderPublicationEvents(data, kind)}
    <header class="academic-section-heading reveal-section">
      <div><p class="eyebrow">${isJournal ? 'JOURNAL DIRECTORY' : 'CONFERENCE DIRECTORY'}</p><h2>${title}</h2></div>
      <p>${intro}</p>
    </header>
    <div class="venue-grid">
      ${items.map((item, index) => `<article class="venue-card reveal-item" style="--delay:${(index % 3) * 80}ms">
        <div class="venue-card-top">
          <span class="venue-acronym">${escapeHTML(item.acronym)}</span>
          <span class="tracking-priority">${escapeHTML(item.tracking_priority)}</span>
        </div>
        <h2>${escapeHTML(item.name)}</h2>
        <p class="venue-owner">${escapeHTML(isJournal ? item.publisher : item.organizer)}</p>
        <div class="venue-tags">${item.areas.map(area => `<span>${escapeHTML(areaLabel(area))}</span>`).join('')}</div>
        ${isJournal ? `<dl class="venue-index-status"><dt>当期索引状态</dt><dd>${escapeHTML(item.index_status)}</dd></dl>` : ''}
        <div class="evidence-block fact-block">
          <span>${escapeHTML(dataPolicy.factLabel)}</span>
          <p>${escapeHTML(item.fact)}</p>
        </div>
        <div class="evidence-block observation-block">
          <span>${escapeHTML(dataPolicy.observationLabel)}</span>
          <p>${escapeHTML(item.atlas_observation)}</p>
        </div>
        <div class="venue-actions">
          ${externalLink(item.official_url, '官方网站', 'button button-ghost')}
          ${externalLink(item.library_url, '论文入口', 'button button-ghost')}
          <span class="evidence-grade" title="证据等级">${escapeHTML(item.evidence_level)} 级证据</span>
        </div>
      </article>`).join('')}
    </div>`;
}

function renderCompare(data) {
  return `
    <header class="academic-section-heading reveal-section">
      <div><p class="eyebrow">SIDE BY SIDE</p><h2>会议与 SCI 期刊，不是谁替代谁</h2></div>
      <p>事实与判断分栏呈现。任何结论都不使用分区、影响因子或录用率作捷径。</p>
    </header>
    <div class="publication-compare reveal-section" role="region" aria-label="会议与期刊对比" tabindex="0">
      <div class="publication-compare-row publication-compare-head" aria-hidden="true"><span>比较维度</span><strong>SCI 期刊</strong><strong>学术会议</strong><strong>Atlas 理解</strong></div>
      ${data.comparison_dimensions.map(item => `<article class="publication-compare-row">
        <h3>${escapeHTML(item.dimension)}</h3>
        <p data-column="SCI 期刊">${escapeHTML(item.journal_fact)}</p>
        <p data-column="学术会议">${escapeHTML(item.conference_fact)}</p>
        <p class="compare-observation" data-column="Atlas 理解">${escapeHTML(item.atlas_observation)}</p>
      </article>`).join('')}
    </div>
    <section class="direction-watch-section">
      <header class="academic-section-heading reveal-section">
        <div><p class="eyebrow">SIX DIRECTIONS</p><h2>六类方向怎么选观察窗口</h2></div>
        <p>这些是编辑阅读建议，不是 venue 排名；每篇论文仍需独立核验方法和实验。</p>
      </header>
      <div class="direction-watch-grid">
        ${data.direction_comparisons.map((item, index) => {
          const color = CATEGORIES[item.category]?.color || '#c6613f';
          return `<article class="direction-watch-card reveal-item" style="--direction-color:${color};--delay:${(index % 2) * 80}ms">
            <div class="direction-watch-head"><span>${escapeHTML(CATEGORIES[item.category]?.code || '--')}</span><h3>${escapeHTML(item.label)}</h3></div>
            <dl>
              <div><dt>会议观察</dt><dd>${escapeHTML(item.conference_watch)}</dd></div>
              <div><dt>期刊观察</dt><dd>${escapeHTML(item.journal_watch)}</dd></div>
            </dl>
            <div class="method-tags">${item.methods.map(method => `<span>${escapeHTML(method)}</span>`).join('')}</div>
            <div class="direction-observation"><strong>${escapeHTML(dataPolicy.observationLabel)}</strong><p>${escapeHTML(item.atlas_observation)}</p></div>
          </article>`;
        }).join('')}
      </div>
    </section>`;
}

function renderMethod(data) {
  const root = document.getElementById('academic-method');
  root.innerHTML = `
    <header class="academic-section-heading">
      <div><p class="eyebrow">ONE PAPER, ONE IDENTITY</p><h2>与论文雷达如何去重</h2></div>
      <p>${escapeHTML(data.deduplication.radar_boundary)}</p>
    </header>
    <div class="dedupe-panel">
      <ol>${data.deduplication.canonical_key_order.map((rule, index) => `<li><span>0${index + 1}</span><p>${escapeHTML(rule)}</p></li>`).join('')}</ol>
      <div>
        <p><strong>版本规则</strong>${escapeHTML(data.deduplication.version_rule)}</p>
        <p><strong>冲突处理</strong>${escapeHTML(data.deduplication.conflict_rule)}</p>
      </div>
    </div>`;
}

function renderSources(data, view) {
  const root = document.getElementById('academic-sources');
  const quality = data.paper_quality_framework;
  root.innerHTML = `
    <section class="paper-quality-framework" aria-labelledby="paper-quality-title">
      <header class="academic-section-heading">
        <div><p class="eyebrow">QUALITY, NOT PRESTIGE</p><h2 id="paper-quality-title">${escapeHTML(quality.title)}</h2></div>
        <p>${escapeHTML(quality.boundary)}</p>
      </header>
      <div class="paper-quality-grid">
        ${quality.dimensions.map((dimension, index) => `<article>
          <span class="paper-quality-index" aria-hidden="true">0${index + 1}</span>
          <h3>${escapeHTML(dimension.label)}</h3>
          <p>${escapeHTML(dimension.question)}</p>
          <ul>${dimension.signals.map(signal => `<li>${escapeHTML(signal)}</li>`).join('')}</ul>
          <small>${escapeHTML(dimension.caution)}</small>
        </article>`).join('')}
      </div>
      <div class="paper-quality-policy">
        <div>${quality.result_labels.map(label => `<span>${escapeHTML(label)}</span>`).join('')}</div>
        <p>${escapeHTML(quality.scoring_policy)}</p>
      </div>
    </section>
    <header class="academic-section-heading">
      <div><p class="eyebrow">SOURCE LEDGER</p><h2>多平台覆盖，但证据不混用</h2></div>
      <p>平台越多只提高“发现”覆盖，不能自动提高结论可信度。正式状态优先回到第一方页面。</p>
    </header>
    <div class="evidence-levels">${data.evidence_levels.map(level => `<article><strong>${escapeHTML(level.label)}</strong><p>${escapeHTML(level.definition)}</p></article>`).join('')}</div>
    <details class="platform-ledger">
      <summary>查看 ${data.platforms.length} 个来源平台与使用边界</summary>
      <div class="platform-grid">
        ${data.platforms.map(platform => `<article>
          <div><span>${escapeHTML(platform.evidence_level)}</span><h3>${escapeHTML(platform.name)}</h3></div>
          <p>${escapeHTML(platform.role)}</p>
          <small>${escapeHTML(platform.caveat)}</small>
          ${externalLink(platform.url, '打开来源')}
        </article>`).join('')}
      </div>
    </details>
    <article class="academic-watchlist">
      <div><p class="eyebrow">NEXT WATCH</p><h2>下一轮观察问题</h2></div>
      <ol>${(data.editorial_summaries?.[view] || data.editorial_summary).next_watch.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ol>
    </article>
    <p class="academic-policy-note">${escapeHTML(data.editorial_policy.priority_note)} ${escapeHTML(data.editorial_policy.metric_policy)}</p>`;
}

const dataPolicy = { factLabel: '可核验事实', observationLabel: 'Atlas 观察' };

export async function init() {
  const data = await loadJSON(DATA_URL);
  dataPolicy.factLabel = data.editorial_policy.fact_label;
  dataPolicy.observationLabel = data.editorial_policy.observation_label;
  publicationStatusLabels = new Map(data.publication_statuses.map(status => [status.id, status.label]));
  const view = currentView();
  renderTabs(view);
  renderOverview(data, view);
  const content = document.getElementById('academic-content');
  content.innerHTML = view === 'compare' ? renderCompare(data) : renderVenueCards(data[view], view, data);
  renderMethod(data);
  renderSources(data, view);
  initReveals();
}
