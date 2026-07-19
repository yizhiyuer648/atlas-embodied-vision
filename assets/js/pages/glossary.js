import { loadModels, loadJSON, escapeHTML } from '../core.js?v=20260719.10';

const ALL = 'ALL';
const KIND_META = {
  formal: { label: '正式术语', short: '正式' },
  community: { label: '社区说法', short: '社区' },
  slang: { label: '圈内黑话', short: '黑话' },
  ambiguous: { label: '语义有歧义', short: '有歧义' }
};
const CATEGORY_LABELS = {
  general: '基础概念', basics: '基础概念', vision: '视觉基础',
  vla: 'VLA 与机器人', robotics: 'VLA 与机器人', embodied: '具身智能',
  world_model: '世界模型', 'world-model': '世界模型', detection: '目标检测',
  representation: '表征与检索', retrieval: '表征与检索', segmentation: '分割',
  multimodal: '多模态', training: '训练方法', evaluation: '评估指标', deployment: '推理与部署',
  community: '社区文化', uncategorized: '未分类'
};

export async function init() {
  const [models, rawTerms] = await Promise.all([loadModels(), loadJSON('data/glossary.json')]);
  const byId = new Map(models.map(model => [model.id, model]));
  const terms = (Array.isArray(rawTerms) ? rawTerms : []).map(normalizeTerm);
  const input = document.getElementById('glossary-search');
  const indexRoot = document.getElementById('glossary-index');
  const listRoot = document.getElementById('glossary-list');
  const empty = document.getElementById('glossary-empty');
  const statsRoot = document.getElementById('glossary-stats');
  const categoryRoot = document.getElementById('glossary-category-filters');
  const kindRoot = document.getElementById('glossary-kind-filters');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);
  const categories = [...new Set(terms.map(term => term.category))]
    .sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), 'zh-CN'));
  const letters = [ALL, ...new Set(terms.map(initialForTerm))]
    .sort((a, b) => a === ALL ? -1 : b === ALL ? 1 : a.localeCompare(b));
  let query = params.get('q') || '';
  let category = categories.includes(params.get('category')) ? params.get('category') : ALL;
  let kind = Object.hasOwn(KIND_META, params.get('kind')) ? params.get('kind') : ALL;
  let letter = letters.includes(params.get('letter')) ? params.get('letter') : ALL;
  let revealFrame = 0;

  input.value = query;
  categoryRoot.innerHTML = filterButtons(
    [{ value: ALL, label: '全部主题', count: terms.length }, ...categories.map(value => ({
      value, label: categoryLabel(value), count: terms.filter(term => term.category === value).length
    }))], 'category', category
  );
  kindRoot.innerHTML = filterButtons(
    [{ value: ALL, label: '全部类型', count: terms.length }, ...Object.entries(KIND_META).map(([value, meta]) => ({
      value, label: meta.label, count: terms.filter(term => term.kind === value).length
    }))], 'kind', kind
  );
  indexRoot.innerHTML = letters.map(value => `<button type="button" class="${value === letter ? 'active' : ''}" data-letter="${escapeHTML(value)}" aria-label="${value === ALL ? '全部术语' : value === '#' ? '非英文字母开头' : `${value} 开头`}" aria-pressed="${value === letter}">${value === ALL ? '全部' : value === '#' ? '其他' : escapeHTML(value)}</button>`).join('');

  function render() {
    query = input.value.trim();
    const foldedQuery = fold(query);
    const filtered = terms.filter(term =>
      (!foldedQuery || term.searchText.includes(foldedQuery)) &&
      (category === ALL || term.category === category) &&
      (kind === ALL || term.kind === kind) &&
      (letter === ALL || initialForTerm(term) === letter)
    );
    const visibleKinds = filtered.reduce((counts, term) => {
      counts[term.kind] = (counts[term.kind] || 0) + 1;
      return counts;
    }, {});
    statsRoot.innerHTML = `<span><strong>${filtered.length}</strong> 当前结果</span><span><strong>${terms.length}</strong> 术语总数</span><span><strong>${categories.length}</strong> 个主题</span>${Object.entries(visibleKinds).map(([value, count]) => `<span class="glossary-kind-stat" data-kind="${value}"><strong>${count}</strong> ${escapeHTML(KIND_META[value]?.short || value)}</span>`).join('')}`;
    listRoot.innerHTML = filtered.map((term, index) => termCard(term, byId, index)).join('');
    empty.hidden = filtered.length > 0;
    listRoot.hidden = !filtered.length;
    updateFilterButtons(categoryRoot, 'category', category);
    updateFilterButtons(kindRoot, 'kind', kind);
    updateLetterButtons();
    updateURL();
    cancelAnimationFrame(revealFrame);
    if (reducedMotion) {
      listRoot.querySelectorAll('.reveal-item').forEach(item => item.classList.add('visible'));
    } else {
      revealFrame = requestAnimationFrame(() => {
        listRoot.querySelectorAll('.reveal-item').forEach(item => item.classList.add('visible'));
      });
    }
  }

  function updateLetterButtons() {
    indexRoot.querySelectorAll('[data-letter]').forEach(button => {
      const active = button.dataset.letter === letter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function updateURL() {
    const url = new URL(location.href);
    setParam(url.searchParams, 'q', query);
    setParam(url.searchParams, 'category', category === ALL ? '' : category);
    setParam(url.searchParams, 'kind', kind === ALL ? '' : kind);
    setParam(url.searchParams, 'letter', letter === ALL ? '' : letter);
    try { history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`); }
    catch { /* file:// 等受限环境不影响术语筛选本身 */ }
  }

  input.addEventListener('input', () => {
    letter = ALL;
    render();
  });
  categoryRoot.addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    category = button.dataset.category;
    render();
  });
  kindRoot.addEventListener('click', event => {
    const button = event.target.closest('[data-kind-filter]');
    if (!button) return;
    kind = button.dataset.kindFilter;
    render();
  });
  indexRoot.addEventListener('click', event => {
    const button = event.target.closest('[data-letter]');
    if (!button) return;
    letter = button.dataset.letter;
    render();
    listRoot.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  });
  document.querySelectorAll('[data-glossary-reset]').forEach(button => button.addEventListener('click', () => {
    input.value = '';
    query = '';
    category = ALL;
    kind = ALL;
    letter = ALL;
    render();
    input.focus({ preventScroll: true });
  }));
  render();
}

function normalizeTerm(raw, index) {
  const term = text(raw?.term || raw?.term_zh || raw?.term_en || `术语 ${index + 1}`);
  const termEn = text(raw?.term_en);
  const aliases = stringList(raw?.aliases);
  const rawKind = text(raw?.kind).toLowerCase();
  const kind = Object.hasOwn(KIND_META, rawKind) ? rawKind : rawKind ? 'ambiguous' : 'formal';
  const category = text(raw?.category) || 'uncategorized';
  const definition = text(raw?.definition_zh || raw?.definition);
  const usage = text(raw?.usage_zh);
  const example = text(raw?.example_zh);
  const sources = normalizeSources(raw);
  const relatedIds = stringList(raw?.related_model_ids);
  const searchText = fold([
    term, termEn, ...aliases, definition, usage, example, categoryLabel(category), KIND_META[kind].label,
    ...sources.map(source => source.label)
  ].join(' '));
  return { ...raw, id: text(raw?.id) || `term-${index + 1}`, term, termEn, aliases, kind, category, definition, usage, example, sources, relatedIds, searchText };
}

function termCard(term, byId, index) {
  const latinPrimary = !/[\u3400-\u9fff\uf900-\ufaff]/u.test(term.term);
  const aliases = term.aliases.length
    ? `<div class="term-aliases"><span>也叫</span>${term.aliases.map(alias => `<em>${escapeHTML(alias)}</em>`).join('')}</div>`
    : '';
  const usage = term.usage
    ? `<div class="term-usage"><strong>使用语境</strong><p>${escapeHTML(term.usage)}</p></div>`
    : '';
  const example = term.example ? `<p class="term-example"><strong>例子</strong>${escapeHTML(term.example)}</p>` : '';
  const sources = term.sources.length
    ? `<div class="term-sources"><span>常见来源</span>${term.sources.map(source => source.url
      ? `<a class="term-source-badge" href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.label)} ↗</a>`
      : `<span class="term-source-badge">${escapeHTML(source.label)}</span>`).join('')}</div>`
    : '';
  const related = term.relatedIds.length
    ? `<div class="related-terms">${term.relatedIds.map(id => byId.has(id)
      ? `<a class="tag" href="model.html?id=${encodeURIComponent(id)}">${escapeHTML(byId.get(id).name)} ↗</a>`
      : `<span class="tag">${escapeHTML(id)}</span>`).join('')}</div>`
    : '';
  return `<article class="glossary-item reveal-item" id="term-${escapeHTML(term.id)}" style="--delay:${Math.min(index, 8) * 55}ms">
    <div class="term-badges"><span class="term-category-badge">${escapeHTML(categoryLabel(term.category))}</span><span class="term-kind-badge" data-kind="${term.kind}">${escapeHTML(KIND_META[term.kind].label)}</span></div>
    <div class="term-title"><h2${latinPrimary ? ' class="term-heading-latin" lang="en"' : ''}>${escapeHTML(term.term)}</h2>${term.termEn && term.termEn !== term.term ? `<span class="term-en" lang="en">${escapeHTML(term.termEn)}</span>` : ''}</div>
    ${aliases}<p class="term-definition">${escapeHTML(term.definition || '释义整理中。')}</p>${usage}${example}${sources}${related}
  </article>`;
}

function filterButtons(items, attribute, current) {
  return items.map(item => `<button type="button" class="glossary-filter-button ${item.value === current ? 'active' : ''}" data-${attribute === 'kind' ? 'kind-filter' : attribute}="${escapeHTML(item.value)}" aria-pressed="${item.value === current}"><span>${escapeHTML(item.label)}</span><small>${item.count}</small></button>`).join('');
}

function updateFilterButtons(root, type, value) {
  const attribute = type === 'kind' ? 'kindFilter' : type;
  root.querySelectorAll('button').forEach(button => {
    const active = button.dataset[attribute] === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function normalizeSources(raw) {
  const platforms = stringList(raw?.source_platforms);
  const sourceURLs = raw?.source_urls;
  if (sourceURLs && typeof sourceURLs === 'object' && !Array.isArray(sourceURLs)) {
    return Object.entries(sourceURLs).map(([label, url]) => ({ label: text(label), url: safeSourceURL(url) })).filter(source => source.label);
  }
  const urls = stringList(sourceURLs);
  return Array.from({ length: Math.max(platforms.length, urls.length) }, (_, index) => {
    const url = safeSourceURL(urls[index]);
    return { label: platforms[index] || sourceHost(url) || `来源 ${index + 1}`, url };
  }).filter(source => source.label);
}

function safeSourceURL(value) {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function sourceHost(value) {
  if (!value) return '';
  try { return new URL(value).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function initialForTerm(term) {
  const initial = (term.termEn || term.term || '#').charAt(0).toUpperCase();
  return /[A-Z]/.test(initial) ? initial : '#';
}

function categoryLabel(value) {
  const normalized = text(value);
  return CATEGORY_LABELS[normalized.toLowerCase()] || normalized.replace(/[-_]+/g, ' ') || CATEGORY_LABELS.uncategorized;
}

function stringList(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  return values.map(item => text(item)).filter(Boolean);
}

function text(value) { return String(value ?? '').trim(); }
function fold(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('zh-CN'); }
function setParam(params, key, value) { value ? params.set(key, value) : params.delete(key); }
