import { loadJSON, escapeHTML, formatDate, storage } from '../core.js?v=20260719.11';

export async function init() {
  const root = document.getElementById('paper-reader');
  const id = cleanArxivId(new URLSearchParams(location.search).get('id'));
  const [payload, models, analysisIndex] = await Promise.all([
    loadJSON('data/papers.json'), loadJSON('data/index.json'), loadJSON('data/paper_analysis_index.json')
  ]);
  let paper = (payload.papers || []).find(item => cleanArxivId(item.id || item.url) === id);
  if (!paper) {
    const model = (models || []).find(item => cleanArxivId(item.paper_url) === id);
    if (model) paper = { title: model.name, intro_zh: model.one_liner_zh, published: `${model.year}-01-01`, authors: [model.org], url: model.paper_url };
  }
  if (!id || !paper) {
    root.innerHTML = `<div class="reader-error"><span>404 / PAPER NOT FOUND</span><h1>这篇论文不在当前图鉴中。</h1><p>返回论文雷达重新选择，或检查链接中的 arXiv ID。</p><a class="button button-primary" href="radar.html">返回论文雷达</a></div>`;
    return;
  }
  const pdfURL = `https://arxiv.org/pdf/${encodeURIComponent(id)}`;
  const sourceURL = `https://arxiv.org/abs/${encodeURIComponent(id)}`;
  document.title = `${paper.title} · Atlas 论文阅读器`;
  storage.set('atlas:last-paper', { id, title: paper.title, read_at: new Date().toISOString() });
  const authors = (paper.authors || []).join(', ');
  const analysisEntry = analysisIndex.papers?.[id];
  root.innerHTML = `<aside class="reader-sidebar glass-panel">
      <a class="reader-back" href="radar.html">← 返回论文雷达</a>
      <div class="reader-kicker"><span></span> ATLAS READER</div>
      <h1>${escapeHTML(paper.title)}</h1>
      <p class="reader-intro">${escapeHTML(paper.intro_zh || '中文导读仍在人工整理。')}</p>
      <dl class="reader-meta">
        <div><dt>公开日期</dt><dd>${escapeHTML(paper.published ? formatDate(paper.published) : '待确认')}</dd></div>
        <div><dt>作者</dt><dd title="${escapeHTML(authors)}">${escapeHTML(authors || '待确认')}</dd></div>
        <div><dt>全文来源</dt><dd>arXiv · 合法公开源</dd></div>
      </dl>
      <div class="reader-notice"><strong>阅读边界</strong><p>PDF 由原始公开来源加载，Atlas 不修改论文正文。中文导读与结构化解析是编辑内容，应与原文对照阅读。</p></div>
      ${analysisEntry ? `<details class="reader-analysis" data-analysis-path="${escapeHTML(analysisEntry.path)}"><summary>打开初学者结构化解析 <span>＋</span></summary><div data-reader-analysis><p>正在加载解析…</p></div></details>` : '<div class="reader-analysis-pending">结构化解析尚未完成；可以先阅读原文。</div>'}
      <div class="reader-actions">
        <a class="button button-primary" href="${escapeHTML(pdfURL)}" target="_blank" rel="noopener noreferrer">新窗口打开 PDF ↗</a>
        <a class="button button-ghost" href="${escapeHTML(sourceURL)}" target="_blank" rel="noopener noreferrer">查看版本记录</a>
      </div>
    </aside>
    <section class="reader-document">
      <div class="reader-document-bar glass-panel"><span><i></i> 正在阅读公开全文</span><small>${escapeHTML(id)}</small></div>
      <iframe src="${escapeHTML(pdfURL)}#view=FitH" title="${escapeHTML(paper.title)} PDF 全文" loading="eager"></iframe>
      <div class="reader-pdf-fallback"><p>如果浏览器阻止内嵌 PDF，请使用上方“新窗口打开 PDF”。</p></div>
    </section>`;
  const details = root.querySelector('.reader-analysis');
  details?.addEventListener('toggle', async () => {
    if (!details.open || details.dataset.loaded) return;
    const target = details.querySelector('[data-reader-analysis]');
    try {
      const analysis = await loadJSON(details.dataset.analysisPath);
      target.innerHTML = renderReaderAnalysis(analysis);
      details.dataset.loaded = 'true';
    } catch { target.innerHTML = '<p>解析暂时无法加载，请稍后重试。</p>'; }
  });
}

function renderReaderAnalysis(payload) {
  const beginner = payload.beginner || {};
  const method = payload.method || {};
  return `<h2>${escapeHTML(beginner.one_sentence || '')}</h2>
    <section><strong>问题</strong><p>${escapeHTML(beginner.problem || '')}</p></section>
    <section><strong>直觉</strong><p>${escapeHTML(beginner.intuition || '')}</p></section>
    <ol>${(beginner.steps || []).map((step, index) => `<li><b>${index + 1}</b><span>${escapeHTML(step)}</span></li>`).join('')}</ol>
    <section><strong>阅读时别忽略</strong><ul>${(method.limitations || []).map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul></section>`;
}

function cleanArxivId(value) {
  const match = String(value || '').match(/(?:arxiv:|abs\/|pdf\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return match ? match[1] : '';
}
