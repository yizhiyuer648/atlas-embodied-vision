import { CATEGORIES, loadModels, loadModelDetail, categoryMeta, displayValue, isKnown, isOpenSource, escapeHTML, setQuery } from '../core.js?v=20260719.7';

export async function init() {
  const models = await loadModels();
  const byId = new Map(models.map(model => [model.id, model]));
  const raw = (new URLSearchParams(location.search).get('ids') || '').split(',').filter(id => byId.has(id)).slice(0, 3);
  const defaults = ['rt-2', 'openvla', 'pi0'].filter(id => byId.has(id));
  const state = { ids: raw.length ? raw : defaults.length >= 2 ? defaults : models.filter(model => model.tier === 'A').slice(0, 3).map(model => model.id) };
  const selectors = document.getElementById('compare-selectors');
  const content = document.getElementById('compare-content');

  const options = `<option value="">选择模型…</option>${Object.entries(CATEGORIES).map(([category, meta]) => `<optgroup label="${meta.label}">${models.filter(model => model.category === category).sort((a,b) => a.name.localeCompare(b.name)).map(model => `<option value="${escapeHTML(model.id)}">${escapeHTML(model.name)} · ${escapeHTML(displayValue(model.org))}</option>`).join('')}</optgroup>`).join('')}`;
  selectors.innerHTML = [0,1,2].map(index => `<div class="compare-slot"><label for="compare-${index}">模型 ${index + 1}${index === 2 ? '（可选）' : ''}</label><select id="compare-${index}" data-index="${index}">${options}</select></div>`).join('');
  [...selectors.querySelectorAll('select')].forEach((select, index) => { select.value = state.ids[index] || ''; });

  const sync = () => {
    state.ids = [...selectors.querySelectorAll('select')].map(select => select.value).filter((id, index, all) => id && all.indexOf(id) === index).slice(0, 3);
    setQuery({ ids: state.ids }); render();
  };
  selectors.addEventListener('change', sync);
  document.getElementById('clear-compare').addEventListener('click', () => { selectors.querySelectorAll('select').forEach(select => { select.value = ''; }); sync(); });

  async function render() {
    const picked = state.ids.map(id => byId.get(id)).filter(Boolean);
    if (picked.length < 2) {
      content.innerHTML = `<div class="compare-empty"><div class="empty-orbit"></div><h2>再选择 ${2 - picked.length} 个模型</h2><p>至少需要两个模型，第三个位置可选。</p></div>`;
      return;
    }
    // key_idea_zh 等深度字段在 details 文件中，按需加载；失败时退回索引数据
    const selected = await Promise.all(picked.map(model => loadModelDetail(model.id).catch(() => model)));
    if (selected.map(model => model.id).join() !== state.ids.join()) return;
    const rows = [
      ['一句话定位', model => escapeHTML(model.one_liner_zh)],
      ['核心思想', model => escapeHTML(model.key_idea_zh)],
      ['类别', model => escapeHTML(categoryMeta(model.category).label)],
      ['机构', model => escapeHTML(displayValue(model.org))],
      ['国家 / 地区', model => escapeHTML(displayValue(model.country))],
      ['公开年份', model => escapeHTML(displayValue(model.year))],
      ['公开仓库', model => isOpenSource(model) ? '<span class="yes">● 有</span>' : '<span class="unknown">● unknown / 未公开</span>'],
      ['论文 / 项目页', model => isKnown(model.paper_url) ? `<a class="text-link" href="${escapeHTML(model.paper_url)}" target="_blank" rel="noopener">查看来源 <span>↗</span></a>` : '<span class="unknown">unknown</span>'],
      ['详解内容', model => model.tier === 'A' ? '<span class="yes">深度解读 + 架构动画 + 核心代码</span>' : '深度解读'],
      ['子类别', model => escapeHTML(displayValue(model.sub_category))],
      ['标签', model => `<div class="tag-list">${(model.tags || []).slice(0,5).map(tag => `<span class="tag">${escapeHTML(tag)}</span>`).join('')}</div>`],
      ['谱系上游', model => isKnown(model.lineage_parent) && byId.has(model.lineage_parent) ? `<a class="text-link" href="model.html?id=${encodeURIComponent(model.lineage_parent)}">${escapeHTML(byId.get(model.lineage_parent).name)} <span>↗</span></a>` : '<span class="no">—</span>']
    ];
    content.innerHTML = `<div class="compare-visual" style="--compare-count:${selected.length}">
      <div class="compare-row compare-head"><div class="compare-cell label">MODEL</div>${selected.map(model => { const meta = categoryMeta(model.category); return `<div class="compare-cell"><span class="category-badge" style="--badge-color:${meta.color}">${escapeHTML(meta.short)}</span><h3><a href="model.html?id=${encodeURIComponent(model.id)}">${escapeHTML(model.name)}</a></h3><p>${escapeHTML(displayValue(model.org))} · ${escapeHTML(displayValue(model.year))}</p></div>`; }).join('')}</div>
      ${rows.map(([label, value]) => `<div class="compare-row"><div class="compare-cell label">${label}</div>${selected.map(model => `<div class="compare-cell">${value(model)}</div>`).join('')}</div>`).join('')}
    </div>`;
  }
  setQuery({ ids: state.ids }); render();
}
