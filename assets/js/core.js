export const CATEGORIES = {
  vla: { label: 'VLA 视觉-语言-动作', short: 'VLA', color: '#c6613f', code: '01' },
  world: { label: '世界模型', short: '世界模型', color: '#7a5fc0', code: '02' },
  detection: { label: '目标检测', short: '目标检测', color: '#3e6fb5', code: '03' },
  representation: { label: '图像检索 / 表征', short: '表征', color: '#2e8c7a', code: '04' },
  segmentation: { label: '分割与基础视觉', short: '分割', color: '#b98317', code: '05' },
  multimodal: { label: '多模态大模型 · 机器人', short: '多模态', color: '#b65878', code: '06' }
};

export const PAGE_LABELS = {
  home: '首页', explore: '图鉴', model: '模型详情', compare: '对比', lineage: '谱系',
  timeline: '时间线', trends: '趋势', glossary: '术语表', radar: '论文雷达', venues: '学术追踪'
};

const MODEL_URL = 'data/index.json';
const memory = new Map();
let modelPromise;

export function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

export async function loadJSON(url) {
  if (memory.has(url)) return memory.get(url);
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`无法读取 ${url}（${response.status}）`);
  const data = await response.json();
  memory.set(url, data);
  return data;
}

export function loadModels() {
  if (!modelPromise) modelPromise = loadJSON(MODEL_URL);
  return modelPromise;
}

export function loadModelDetail(id) {
  return loadJSON(`data/details/${encodeURIComponent(id)}.json`);
}

export const storage = {
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage may be disabled */ } }
};

export function getFavorites() { return new Set(storage.get('atlas:favorites', [])); }
export function isFavorite(id) { return getFavorites().has(id); }
export function toggleFavorite(id) {
  const favorites = getFavorites();
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  storage.set('atlas:favorites', [...favorites]);
  document.dispatchEvent(new CustomEvent('atlas:favorites', { detail: { id, active: favorites.has(id), count: favorites.size } }));
  return favorites.has(id);
}

export function categoryMeta(category) {
  return CATEGORIES[category] || { label: category || 'unknown', short: category || 'unknown', color: '#8b8778', code: '--' };
}

export function isKnown(value) { return value !== undefined && value !== null && value !== '' && value !== 'unknown'; }
export function displayValue(value, fallback = '待公开') { return isKnown(value) ? value : fallback; }
export function isOpenSource(model) { return isKnown(model.github_url); }

export function modelSearchText(model) {
  const org = String(model.org || '').toLowerCase();
  const aliases = [
    ['tsinghua', '清华'], ['peking university', '北大 北京大学'], ['bytedance', '字节 字节跳动'],
    ['alibaba', '阿里 阿里巴巴'], ['baidu', '百度'], ['tencent', '腾讯'], ['baai', '智源 北京智源'],
    ['shanghai ai lab', '上海人工智能实验室 上海ai lab'], ['chinese academy', '中科院 中国科学院'],
    ['zhipu', '智谱'], ['huawei', '华为'], ['kuaishou', '快手'], ['nvidia', '英伟达'],
    ['google', '谷歌'], ['facebook', 'meta 脸书'], ['microsoft', '微软']
  ].filter(([needle]) => org.includes(needle)).map(([, alias]) => alias);
  return [model.name, model.org, model.country, model.category, model.sub_category, model.one_liner_zh, ...(model.tags || []), ...aliases].join(' ').toLowerCase();
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_.·/()]+/g, '')
    .replace(/([a-z])v(?=\d)/g, '$1');
}

export function modelCard(model, { delay = 0, compact = false } = {}) {
  const meta = categoryMeta(model.category);
  const tags = (model.tags || []).slice(0, compact ? 2 : 3);
  return `
    <article class="model-card reveal-item" data-model-id="${escapeHTML(model.id)}" style="--delay:${delay}ms;--badge-color:${meta.color}">
      <a class="model-card-inner" href="model.html?id=${encodeURIComponent(model.id)}" aria-label="查看 ${escapeHTML(model.name)} 详情">
        <div class="card-top">
          <span class="category-badge">${escapeHTML(meta.short)}</span>
        </div>
        <div class="card-title-row"><h3>${escapeHTML(model.name)}</h3>${model.tier === 'A' ? '<span class="tier-mark">A · DEEP</span>' : ''}</div>
        <p class="card-org">${escapeHTML(displayValue(model.org))}</p>
        <p class="card-copy">${escapeHTML(model.one_liner_zh || '公开资料仍在整理中。')}</p>
        <div class="card-meta">
          <span>${escapeHTML(displayValue(model.year))}</span>
          <span>${escapeHTML(displayValue(model.country))}</span>
          <span>${isOpenSource(model) ? '开源' : '未公开代码'}</span>
        </div>
        ${tags.length ? `<div class="tag-list">${tags.map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
        <span class="card-arrow" aria-hidden="true">↗</span>
      </a>
      <button class="favorite-button ${isFavorite(model.id) ? 'active' : ''}" type="button" data-favorite="${escapeHTML(model.id)}" aria-label="${isFavorite(model.id) ? '取消收藏' : '收藏'} ${escapeHTML(model.name)}" aria-pressed="${isFavorite(model.id)}">${isFavorite(model.id) ? '★' : '☆'}</button>
    </article>`;
}

function navMarkup(page) {
  const links = [
    ['explore', '图鉴', 'explore.html'], ['radar', '论文雷达', 'radar.html'], ['venues', '学术追踪', 'venues.html'], ['lineage', '谱系', 'lineage.html'],
    ['timeline', '时间线', 'timeline.html'], ['trends', '趋势', 'trends.html'], ['glossary', '术语表', 'glossary.html']
  ];
  const favoriteTotal = getFavorites().size;
  const linkHTML = links.map(([key, label, href]) => `<a href="${href}" class="${page === key ? 'active' : ''}">${label}</a>`).join('');
  return `
    <nav class="site-nav" aria-label="主导航">
      <div class="nav-inner container">
        <a class="brand" href="index.html" aria-label="Atlas 首页"><span class="brand-mark" aria-hidden="true"></span><span>Atlas<small>具身智能 · 视觉</small></span></a>
        <div class="nav-links">${linkHTML}</div>
        <div class="nav-search">
          <div class="search-field"><span class="search-icon" aria-hidden="true"></span><label class="sr-only" for="global-search">搜索图鉴</label><input id="global-search" type="search" placeholder="搜索模型、机构或标签" autocomplete="off"><button class="search-submit" type="button" data-search-submit>搜索</button></div>
          <div id="global-search-results" class="search-results" hidden></div>
        </div>
        <div class="nav-actions"><a class="favorite-count" data-favorites-link href="explore.html?favorites=1" title="查看收藏" aria-label="查看收藏${favoriteTotal ? `（${favoriteTotal}）` : ''}"><span class="favorite-label">收藏</span><span class="favorite-number" data-favorite-count ${favoriteTotal ? '' : 'hidden'}>${favoriteTotal || ''}</span></a><button id="mobile-menu-toggle" class="icon-button mobile-menu-toggle" aria-label="打开菜单" aria-expanded="false">☰</button></div>
      </div>
      <div id="mobile-menu" class="mobile-menu" hidden>
        <div class="search-field"><span class="search-icon" aria-hidden="true"></span><label class="sr-only" for="mobile-search">搜索图鉴</label><input id="mobile-search" type="search" placeholder="搜索模型、机构或标签" autocomplete="off"><button class="search-submit" type="button" data-search-submit>搜索</button></div>
        <div id="mobile-search-results" class="search-results" hidden></div>
        ${linkHTML}<a href="explore.html?favorites=1" class="mobile-favorites" data-favorites-link aria-label="查看收藏${favoriteTotal ? `（${favoriteTotal}）` : ''}"><span>收藏</span><span class="favorite-number" data-favorite-count ${favoriteTotal ? '' : 'hidden'}>${favoriteTotal || ''}</span></a><a href="compare.html">模型对比</a>
      </div>
    </nav>`;
}

function footerMarkup() {
  return `<div class="container">
    <div class="footer-inner">
      <div class="footer-brand"><a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true"></span><span>Atlas<small>EMBODIED & VISION</small></span></a><p>面向中文初学者的具身智能与视觉模型坐标系。公开资料优先，不确定信息明确标记。</p></div>
      <div class="footer-links">
        <div class="footer-col"><h3>探索</h3><a href="explore.html">模型图鉴</a><a href="radar.html">论文雷达</a><a href="venues.html">学术追踪</a></div>
        <div class="footer-col"><h3>脉络</h3><a href="lineage.html">演化谱系</a><a href="timeline.html">时间线</a><a href="trends.html">趋势观察</a></div>
        <div class="footer-col"><h3>参考</h3><a href="glossary.html">术语表</a><a href="compare.html">模型对比</a></div>
      </div>
    </div>
    <div class="footer-bottom"><span>Atlas · 本地静态知识图鉴</span><span>数据更新至 2026 · unknown 表示尚无可靠公开资料</span></div>
  </div>`;
}

export async function setupShell(page) {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  if (header) header.innerHTML = navMarkup(page);
  if (footer) footer.innerHTML = footerMarkup();

  const nav = document.querySelector('.site-nav');
  const updateNav = () => nav?.classList.toggle('scrolled', scrollY > 12);
  updateNav();
  addEventListener('scroll', updateNav, { passive: true });

  const toggle = document.getElementById('mobile-menu-toggle');
  const menu = document.getElementById('mobile-menu');
  toggle?.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    toggle.textContent = open ? '×' : '☰';
  });

  document.addEventListener('atlas:favorites', event => {
    document.querySelectorAll('[data-favorite-count]').forEach(count => {
      count.textContent = event.detail.count || '';
      count.hidden = event.detail.count === 0;
    });
    document.querySelectorAll('[data-favorites-link]').forEach(link => {
      link.setAttribute('aria-label', `查看收藏${event.detail.count ? `（${event.detail.count}）` : ''}`);
    });
    document.querySelectorAll(`[data-favorite="${CSS.escape(event.detail.id)}"]`).forEach(button => {
      button.classList.toggle('active', event.detail.active);
      button.setAttribute('aria-pressed', String(event.detail.active));
      button.textContent = event.detail.active ? '★' : '☆';
    });
  });

  try {
    const models = await loadModels();
    setupSearch(document.getElementById('global-search'), document.getElementById('global-search-results'), models);
    setupSearch(document.getElementById('mobile-search'), document.getElementById('mobile-search-results'), models);
  } catch (error) {
    console.error('Atlas 数据加载失败：', error);
  }

  setupBreadcrumbs(page);
}

export function setupBreadcrumbs(page, currentLabel = PAGE_LABELS[page]) {
  const el = document.getElementById('breadcrumbs');
  if (!el || page === 'home') return;
  el.innerHTML = `<a href="index.html">Atlas</a><i></i>${page === 'model' ? '<a href="explore.html">图鉴</a><i></i>' : ''}<span aria-current="page">${escapeHTML(currentLabel || '当前页')}</span>`;
}

export function setupSearch(input, results, models, { onSelect = null, max = 8 } = {}) {
  if (!input || !results) return;
  let activeIndex = -1;
  const field = input.closest('.search-field');
  const submitButton = field?.querySelector('[data-search-submit]');
  const submit = () => {
    const query = input.value.trim();
    if (!query) { input.focus(); return; }
    const items = [...results.querySelectorAll('.search-result-item')];
    const target = items[activeIndex] || items[0];
    if (target) target.click();
    else location.href = `explore.html?search=${encodeURIComponent(query)}`;
  };
  const render = () => {
    const query = normalizeSearchText(input.value.trim());
    activeIndex = -1;
    if (!query) { results.hidden = true; results.innerHTML = ''; return; }
    const matches = models.filter(model => normalizeSearchText(modelSearchText(model)).includes(query)).slice(0, max);
    results.innerHTML = matches.length ? matches.map((model, index) => {
      const meta = categoryMeta(model.category);
      return `<a class="search-result-item" data-index="${index}" href="model.html?id=${encodeURIComponent(model.id)}"><span class="result-glyph" style="color:${meta.color}">${escapeHTML(meta.code)}</span><span><strong>${escapeHTML(model.name)}</strong><small>${escapeHTML(displayValue(model.org))} · ${escapeHTML(meta.short)}</small></span><span>${escapeHTML(displayValue(model.year))}</span></a>`;
    }).join('') : `<div class="search-empty">没有匹配结果，试试模型简称或机构名。</div>`;
    results.hidden = false;
    if (onSelect) results.querySelectorAll('a').forEach((anchor, index) => anchor.addEventListener('click', event => { event.preventDefault(); onSelect(matches[index]); results.hidden = true; }));
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  submitButton?.addEventListener('click', submit);
  input.addEventListener('keydown', event => {
    const items = [...results.querySelectorAll('.search-result-item')];
    if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); activeIndex = (activeIndex + 1) % items.length; }
    else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); activeIndex = (activeIndex - 1 + items.length) % items.length; }
    else if (event.key === 'Enter') { event.preventDefault(); submit(); }
    else if (event.key === 'Escape') { results.hidden = true; input.blur(); }
    else return;
    items.forEach((item, index) => item.classList.toggle('active', index === activeIndex));
    items[activeIndex]?.scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('pointerdown', event => { if (!results.contains(event.target) && !field?.contains(event.target)) results.hidden = true; });
}

export function initReveals(root = document) {
  const items = root.querySelectorAll('.reveal-section, .reveal-item');
  if (!items.length) return;
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach(item => item.classList.add('visible'));
    return;
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
  }), { threshold: .08, rootMargin: '0px 0px -30px' });
  items.forEach(item => observer.observe(item));
}

export function initCardInteractions(root = document) {
  const coarsePointer = matchMedia('(pointer: coarse)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  root.querySelectorAll('[data-favorite]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      toggleFavorite(button.dataset.favorite);
      createRipple(button, event);
    });
  });
  root.querySelectorAll('.model-card').forEach(card => {
    card.addEventListener('pointermove', event => {
      if (coarsePointer.matches || reducedMotion.matches) {
        card.style.setProperty('--mx', '0px');
        card.style.setProperty('--my', '0px');
        return;
      }
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      card.style.setProperty('--mx', `${(x - .5) * 5}px`);
      card.style.setProperty('--my', `${(y - .5) * 5}px`);
      card.style.setProperty('--px', `${x * 100}%`);
      card.style.setProperty('--py', `${y * 100}%`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--mx', '0px'); card.style.setProperty('--my', '0px');
      card.style.setProperty('--px', '50%'); card.style.setProperty('--py', '50%');
    });
    card.addEventListener('pointerdown', event => createRipple(card, event));
  });
}

export function createRipple(target, event) {
  const box = target.getBoundingClientRect();
  const size = Math.max(box.width, box.height) * 2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - box.left}px`;
  ripple.style.top = `${event.clientY - box.top}px`;
  target.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

export function animateNumber(element, target, { suffix = '', duration = 1000, decimals = 0 } = {}) {
  if (!element) return;
  const start = performance.now();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const update = now => {
    const t = reduced ? 1 : Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = (target * eased).toFixed(decimals);
    element.innerHTML = `${value}<span class="suffix">${escapeHTML(suffix)}</span>`;
    if (t < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

export function observeNumber(element, target, options) {
  if (!('IntersectionObserver' in window)) return animateNumber(element, target, options);
  const observer = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) { animateNumber(element, target, options); observer.disconnect(); }
  }, { threshold: .4 });
  observer.observe(element);
}

export function setQuery(params, { replace = true } = {}) {
  const url = new URL(location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) url.searchParams.delete(key);
    else url.searchParams.set(key, Array.isArray(value) ? value.join(',') : value);
  });
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

export function formatDate(value, locale = 'zh-CN') {
  if (!value) return 'unknown';
  const text = String(value);
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

export function formatCompact(value) {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
}

export async function cachedFetchJSON(url, { key, ttl, timeout = 7000, headers = {} } = {}) {
  const cacheKey = `atlas:cache:${key || url}`;
  const cached = storage.get(cacheKey);
  if (cached && Date.now() - cached.time < ttl) return { data: cached.data, cached: true, fetchedAt: cached.time };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const fetchedAt = Date.now();
    storage.set(cacheKey, { time: fetchedAt, data });
    return { data, cached: false, fetchedAt };
  } finally { clearTimeout(timer); }
}

export function repoFromURL(url) {
  if (!isKnown(url)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1].replace(/\.git$/, '')}` : null;
  } catch { return null; }
}

export function toast(message) {
  let node = document.getElementById('atlas-toast');
  if (!node) {
    node = document.createElement('div'); node.id = 'atlas-toast';
    Object.assign(node.style, { position: 'fixed', zIndex: '220', left: '50%', bottom: '28px', padding: '10px 14px', border: '1px solid #d7d2c3', borderRadius: '10px', color: '#26251f', background: 'rgba(255,255,255,.97)', boxShadow: '0 16px 50px rgba(58,50,36,.18)', fontSize: '.76rem', transform: 'translate(-50%, 14px)', opacity: '0', transition: 'opacity .2s, transform .2s' });
    document.body.appendChild(node);
  }
  node.textContent = message;
  requestAnimationFrame(() => { node.style.opacity = '1'; node.style.transform = 'translate(-50%, 0)'; });
  clearTimeout(node._timer);
  node._timer = setTimeout(() => { node.style.opacity = '0'; node.style.transform = 'translate(-50%, 14px)'; }, 1800);
}
