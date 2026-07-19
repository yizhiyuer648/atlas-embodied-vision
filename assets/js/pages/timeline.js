import { CATEGORIES, loadModels, categoryMeta, displayValue, escapeHTML, initReveals, setQuery } from '../core.js?v=20260719.7';

const START_YEAR = 2012;
const END_YEAR = 2026;
const MOBILE_CARD_LIMIT = 6;

function getTimelineYear(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= START_YEAR && year <= END_YEAR ? year : null;
}

function sortYearModels(a, b) {
  const tierDifference = (a.tier === 'A' ? 0 : 1) - (b.tier === 'A' ? 0 : 1);
  return tierDifference || String(a.name).localeCompare(String(b.name), 'zh-CN');
}

export async function init() {
  const models = await loadModels();
  const params = new URLSearchParams(location.search);
  let category = CATEGORIES[params.get('category')] ? params.get('category') : 'all';
  const controls = document.getElementById('timeline-categories');
  const root = document.getElementById('timeline');
  const summary = document.getElementById('timeline-summary');
  const mobileViewport = matchMedia('(max-width: 640px)');
  const expandedGroups = new Set();

  controls.innerHTML = `<button class="chip ${category === 'all' ? 'active' : ''}" data-category="all">全部</button>${Object.entries(CATEGORIES).map(([key, meta]) => `<button class="chip ${category === key ? 'active' : ''}" data-category="${key}">${meta.short}</button>`).join('')}`;

  function cardMarkup(model, index, isOverflow, isExpanded) {
    const meta = categoryMeta(model.category);
    const hidden = mobileViewport.matches && isOverflow && !isExpanded ? ' hidden' : '';
    const overflowAttribute = isOverflow ? ' data-timeline-overflow' : '';
    return `<a class="timeline-card reveal-item" style="--delay:${Math.min(index, 8) * 80}ms;--badge-color:${meta.color}" href="model.html?id=${encodeURIComponent(model.id)}"${overflowAttribute}${hidden}><span class="category-badge">${escapeHTML(meta.short)}</span><h3>${escapeHTML(model.name)}</h3><p>${escapeHTML(displayValue(model.org))} · ${model.country === 'CN' ? '国产' : escapeHTML(displayValue(model.country))}</p></a>`;
  }

  function groupMarkup(key, label, yearModels, emptyMessage) {
    const sortedModels = [...yearModels].sort(sortYearModels);
    const isExpanded = expandedGroups.has(key);
    const overflowCount = Math.max(0, sortedModels.length - MOBILE_CARD_LIMIT);
    const cards = sortedModels.map((model, index) => cardMarkup(model, index, index >= MOBILE_CARD_LIMIT, isExpanded)).join('');
    const toggle = mobileViewport.matches && overflowCount
      ? `<button type="button" class="button button-ghost button-block timeline-year-toggle" data-year-key="${key}" data-overflow-count="${overflowCount}" aria-expanded="${isExpanded}" aria-controls="timeline-models-${key}">${isExpanded ? '收起' : `展开另外 ${overflowCount} 个`}</button>`
      : '';
    return `<section class="timeline-year reveal-section" data-timeline-year="${key}"><h2 class="year-label"${key === 'unknown' ? ' aria-label="年份待确认"' : ''}>${label}</h2><div id="timeline-models-${key}" class="year-models">${sortedModels.length ? cards + toggle : `<div class="timeline-gap">${emptyMessage}</div>`}</div></section>`;
  }

  function render() {
    const filteredModels = models.filter(model => category === 'all' || model.category === category);
    const grouped = new Map();
    const unknownYearModels = [];

    filteredModels.forEach(model => {
      const year = getTimelineYear(model.year);
      if (year === null) {
        unknownYearModels.push(model);
        return;
      }
      if (!grouped.has(year)) grouped.set(year, []);
      grouped.get(year).push(model);
    });

    const yearSections = Array.from({ length: END_YEAR - START_YEAR + 1 }, (_, index) => START_YEAR + index)
      .map(year => groupMarkup(String(year), String(year), grouped.get(year) || [], '当前图鉴暂无这一年的代表条目'));
    yearSections.push(groupMarkup('unknown', '年份<br>待确认', unknownYearModels, '当前筛选下没有年份待确认的条目'));
    root.innerHTML = yearSections.join('');

    summary.textContent = `${START_YEAR}—${END_YEAR} · ${filteredModels.length} 个模型${unknownYearModels.length ? ` · ${unknownYearModels.length} 个年份待确认` : ''}`;
    initReveals(root);
  }

  controls.addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    category = button.dataset.category;
    expandedGroups.clear();
    controls.querySelectorAll('.chip').forEach(item => item.classList.toggle('active', item === button));
    setQuery({ category: category === 'all' ? null : category });
    render();
  });

  root.addEventListener('click', event => {
    const button = event.target.closest('.timeline-year-toggle');
    if (!button) return;
    const section = button.closest('.timeline-year');
    const key = button.dataset.yearKey;
    const shouldExpand = button.getAttribute('aria-expanded') !== 'true';
    section.querySelectorAll('[data-timeline-overflow]').forEach(card => { card.hidden = !shouldExpand; });
    button.setAttribute('aria-expanded', String(shouldExpand));
    button.textContent = shouldExpand ? '收起' : `展开另外 ${button.dataset.overflowCount} 个`;
    shouldExpand ? expandedGroups.add(key) : expandedGroups.delete(key);
  });

  const handleViewportChange = () => render();
  if (mobileViewport.addEventListener) mobileViewport.addEventListener('change', handleViewportChange);
  else mobileViewport.addListener(handleViewportChange);

  render();
}
