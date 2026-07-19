import { CATEGORIES, loadModels, modelCard, initCardInteractions, initReveals, getFavorites, setQuery, isOpenSource } from '../core.js?v=20260719.11';

const COUNTRY_LABELS = { CN: '中国', US: '美国', EU: '欧洲', UK: '英国', KR: '韩国', JP: '日本', CA: '加拿大', AU: '澳大利亚', unknown: '未标注' };

export async function init() {
  const models = await loadModels();
  const params = new URLSearchParams(location.search);
  const years = models.map(model => Number(model.year)).filter(Number.isFinite);
  const minYear = Math.min(...years, 2012), maxYear = Math.max(...years, 2026);

  const countryCounts = new Map();
  models.forEach(model => {
    const key = model.country && model.country !== 'unknown' ? model.country : 'unknown';
    countryCounts.set(key, (countryCounts.get(key) || 0) + 1);
  });
  const countryOptions = [...countryCounts.entries()].sort((a, b) => (a[0] === 'unknown') - (b[0] === 'unknown') || b[1] - a[1]);

  const state = {
    categories: new Set((params.get('category') || '').split(',').filter(key => CATEGORIES[key])),
    countries: new Set((params.get('country') || '').split(',').filter(key => countryCounts.has(key))),
    open: params.get('open') === '1',
    favorites: params.get('favorites') === '1',
    tierA: params.get('tier') === 'A',
    org: params.get('org') || '',
    from: Number(params.get('from')) || minYear,
    to: Number(params.get('to')) || maxYear,
    sort: params.get('sort') || 'featured'
  };
  if (params.get('cn') === '1') state.countries.add('CN');

  const filters = document.getElementById('filters');
  const grid = document.getElementById('model-grid');
  const empty = document.getElementById('empty-state');
  const summary = document.getElementById('result-summary');
  const sort = document.getElementById('sort-select');
  const favoriteSet = () => getFavorites();
  const orgCounts = new Map();
  models.forEach(model => { if (model.org !== 'unknown') orgCounts.set(model.org, (orgCounts.get(model.org) || 0) + 1); });
  const organizations = [...orgCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);

  function filterMarkup() {
    const categoryCounts = Object.fromEntries(Object.keys(CATEGORIES).map(key => [key, models.filter(model => model.category === key).length]));
    return `
      <div class="filter-group"><h3>类别</h3>${Object.entries(CATEGORIES).map(([key, meta]) => `<button type="button" class="check-row filter-choice" data-filter="category" data-value="${key}" aria-pressed="${state.categories.has(key)}"><span class="filter-choice-mark" aria-hidden="true"></span><span>${meta.short}</span><span>${categoryCounts[key]}</span></button>`).join('')}</div>
      <div class="filter-group"><h3>年份</h3><div class="year-range"><select id="year-from" aria-label="起始年份">${range(minYear, maxYear).map(year => `<option value="${year}" ${year === state.from ? 'selected' : ''}>${year}</option>`).join('')}</select><span>—</span><select id="year-to" aria-label="结束年份">${range(minYear, maxYear).map(year => `<option value="${year}" ${year === state.to ? 'selected' : ''}>${year}</option>`).join('')}</select></div></div>
      <div class="filter-group"><h3>国家 / 地区</h3>${countryOptions.map(([code, count]) => `<button type="button" class="check-row filter-choice" data-filter="country" data-value="${code}" aria-pressed="${state.countries.has(code)}"><span class="filter-choice-mark" aria-hidden="true"></span><span>${COUNTRY_LABELS[code] || code}</span><span>${count}</span></button>`).join('')}</div>
      <div class="filter-group"><h3>深度与状态</h3><button type="button" class="check-row filter-choice" data-filter="tier-a" aria-pressed="${state.tierA}"><span class="filter-choice-mark" aria-hidden="true"></span><span>只看 A 级（架构 + 代码）</span><span>${models.filter(model => model.tier === 'A').length}</span></button><button type="button" class="check-row filter-choice" data-filter="open" aria-pressed="${state.open}"><span class="filter-choice-mark" aria-hidden="true"></span><span>有公开仓库</span><span>${models.filter(isOpenSource).length}</span></button><button type="button" class="check-row filter-choice" data-filter="favorites" aria-pressed="${state.favorites}"><span class="filter-choice-mark" aria-hidden="true"></span><span>只看收藏</span><span id="favorites-filter-count">${favoriteSet().size}</span></button></div>
      <div class="filter-group"><h3>机构</h3><label class="check-row"><input type="radio" name="org" value="" ${!state.org ? 'checked' : ''}><span>全部机构</span></label>${organizations.map(([org, count]) => `<label class="check-row"><input type="radio" name="org" value="${escapeAttr(org)}" ${state.org === org ? 'checked' : ''}><span>${org}</span><span>${count}</span></label>`).join('')}</div>`;
  }

  function syncURL() {
    setQuery({
      category: [...state.categories], country: [...state.countries], cn: null,
      open: state.open ? '1' : null, favorites: state.favorites ? '1' : null,
      tier: state.tierA ? 'A' : null, org: state.org || null,
      from: state.from !== minYear ? state.from : null, to: state.to !== maxYear ? state.to : null,
      sort: state.sort !== 'featured' ? state.sort : null
    });
  }

  function selectedCount() {
    return state.categories.size + state.countries.size + Number(state.open) + Number(state.favorites) + Number(state.tierA) + Number(Boolean(state.org)) + Number(state.from !== minYear || state.to !== maxYear);
  }

  function render() {
    const favorites = favoriteSet();
    let list = models.filter(model => {
      const year = Number(model.year);
      const country = model.country && model.country !== 'unknown' ? model.country : 'unknown';
      return (!state.categories.size || state.categories.has(model.category)) &&
        (!state.countries.size || state.countries.has(country)) &&
        (!state.open || isOpenSource(model)) && (!state.tierA || model.tier === 'A') &&
        (!state.favorites || favorites.has(model.id)) && (!state.org || model.org === state.org) &&
        (!Number.isFinite(year) || (year >= state.from && year <= state.to));
    });
    list = [...list].sort((a, b) => {
      if (state.sort === 'year-desc') return (Number(b.year) || 0) - (Number(a.year) || 0) || a.name.localeCompare(b.name);
      if (state.sort === 'year-asc') return (Number(a.year) || 9999) - (Number(b.year) || 9999) || a.name.localeCompare(b.name);
      if (state.sort === 'cites') return (b.citations || 0) - (a.citations || 0) || a.name.localeCompare(b.name);
      if (state.sort === 'name') return a.name.localeCompare(b.name, 'en');
      return (a.tier === b.tier ? (Number(b.year) || 0) - (Number(a.year) || 0) : a.tier === 'A' ? -1 : 1);
    });
    grid.innerHTML = list.map((model, index) => modelCard(model, { delay: (index % 6) * 80, compact: true })).join('');
    summary.innerHTML = `找到 <strong>${list.length}</strong> / ${models.length} 个模型${state.favorites ? ' · 收藏视图' : ''}${state.sort === 'cites' ? ' · 按引用数排序' : ''}`;
    empty.hidden = list.length > 0; grid.hidden = !list.length;
    const count = selectedCount();
    document.getElementById('filter-count').textContent = count ? `· ${count}` : '';
    const favoriteCount = document.getElementById('favorites-filter-count');
    if (favoriteCount) favoriteCount.textContent = favorites.size;
    initCardInteractions(grid); initReveals(grid);
  }

  filters.innerHTML = filterMarkup();
  sort.value = state.sort;
  filters.addEventListener('click', event => {
    const target = event.target.closest('.filter-choice');
    if (!target) return;
    const filter = target.dataset.filter;
    if (filter === 'category') state.categories.has(target.dataset.value) ? state.categories.delete(target.dataset.value) : state.categories.add(target.dataset.value);
    else if (filter === 'country') state.countries.has(target.dataset.value) ? state.countries.delete(target.dataset.value) : state.countries.add(target.dataset.value);
    else if (filter === 'tier-a') state.tierA = !state.tierA;
    else if (filter === 'open') state.open = !state.open;
    else if (filter === 'favorites') state.favorites = !state.favorites;
    const active = filter === 'category' ? state.categories.has(target.dataset.value) :
      filter === 'country' ? state.countries.has(target.dataset.value) :
      filter === 'tier-a' ? state.tierA : filter === 'open' ? state.open : state.favorites;
    target.setAttribute('aria-pressed', String(active));
    syncURL(); render();
  });
  filters.addEventListener('change', event => {
    const target = event.target;
    if (target.name === 'org') state.org = target.value;
    else if (target.id === 'year-from') { state.from = Number(target.value); if (state.from > state.to) { state.to = state.from; document.getElementById('year-to').value = state.to; } }
    else if (target.id === 'year-to') { state.to = Number(target.value); if (state.to < state.from) { state.from = state.to; document.getElementById('year-from').value = state.from; } }
    syncURL(); render();
  });
  sort.addEventListener('change', () => { state.sort = sort.value; syncURL(); render(); });
  document.getElementById('reset-filters').addEventListener('click', () => {
    state.categories.clear(); state.countries.clear(); state.open = false; state.favorites = false; state.tierA = false; state.org = ''; state.from = minYear; state.to = maxYear; state.sort = 'featured';
    filters.innerHTML = filterMarkup(); sort.value = state.sort; syncURL(); render();
  });
  document.addEventListener('atlas:favorites', () => render());

  const panel = document.getElementById('filter-panel');
  const toggle = document.getElementById('filter-toggle');
  const closeButton = document.getElementById('filter-close');
  const mobileFilters = matchMedia('(max-width: 900px)');
  const syncPanelA11y = () => {
    const open = panel.classList.contains('open');
    if (mobileFilters.matches) {
      panel.inert = !open;
      panel.setAttribute('aria-hidden', String(!open));
    } else {
      panel.inert = false;
      panel.removeAttribute('aria-hidden');
    }
  };
  const closePanel = ({ restoreFocus = true } = {}) => {
    const wasOpen = panel.classList.contains('open');
    panel.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    if (wasOpen && restoreFocus) toggle.focus();
    syncPanelA11y();
  };
  const openPanel = () => {
    panel.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    syncPanelA11y();
    requestAnimationFrame(() => closeButton.focus());
  };
  toggle.addEventListener('click', () => { panel.classList.contains('open') ? closePanel() : openPanel(); });
  closeButton.addEventListener('click', () => closePanel());
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
  const syncPanelMode = () => {
    if (!mobileFilters.matches) closePanel({ restoreFocus: false });
    else syncPanelA11y();
  };
  mobileFilters.addEventListener?.('change', syncPanelMode);
  syncPanelMode();
  render();
}

function range(from, to) { return Array.from({ length: to - from + 1 }, (_, i) => from + i); }
function escapeAttr(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
