import { loadJSON, escapeHTML, formatDate, storage } from '../core.js?v=20260719.12';
import * as pdfjsLib from '../../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

export async function init() {
  const root = document.getElementById('paper-reader');
  const params = new URLSearchParams(location.search);
  const id = cleanArxivId(params.get('id'));
  const formalId = cleanFormalId(params.get('paper'));
  const [payload, models, analysisIndex, academicTracker] = await Promise.all([
    loadJSON('data/papers.json'), loadJSON('data/index.json'), loadJSON('data/paper_analysis_index.json'),
    loadJSON('data/academic_tracker.json').catch(() => ({ publication_events: [] }))
  ]);
  let paper = (payload.papers || []).find(item => cleanArxivId(item.id || item.url) === id);
  let formalEvent = null;
  if (!id && formalId) {
    formalEvent = (academicTracker.publication_events || []).find(event => String(event.paper_id || event.work_id || event.id) === formalId) || null;
    if (formalEvent?.fulltext?.access === 'open' && formalEvent.fulltext.pdf_url) {
      paper = {
        title: formalEvent.title,
        intro_zh: [formalEvent.fact_zh, formalEvent.atlas_observation_zh].filter(Boolean).join(' '),
        published: normalizePublished(formalEvent.event_date),
        authors: formalEvent.authors || [],
        url: formalEvent.source_url,
        publication_status: formalEvent.status,
        venue: { name: String(formalEvent.venue_id || '').toUpperCase() },
        rights: formalEvent.fulltext
      };
    }
  }
  if (!paper && id) {
    const model = (models || []).find(item => cleanArxivId(item.paper_url) === id);
    if (model) paper = { title: model.name, intro_zh: model.one_liner_zh, published: `${model.year}-01-01`, authors: [model.org], url: model.paper_url };
  }
  if ((!id && !formalId) || !paper) {
    root.innerHTML = `<div class="reader-error"><span>404 / PAPER NOT FOUND</span><h1>这篇论文没有可核验的公开全文。</h1><p>返回论文雷达重新选择；Atlas 不绕过付费墙、机构登录或版权限制。</p><a class="button button-primary" href="radar.html">返回论文雷达</a></div>`;
    return;
  }
  const paperKey = id ? `arxiv:${id}` : formalId;
  const remotePdfURL = id ? `https://arxiv.org/pdf/${encodeURIComponent(id)}` : formalEvent.fulltext.pdf_url;
  const sourceURL = id ? `https://arxiv.org/abs/${encodeURIComponent(id)}` : formalEvent.source_url;
  const sourceLabel = id ? 'arXiv' : formalEvent.fulltext.provider || formalEvent.source_label || '正式公开来源';
  const pdfCandidates = await buildPdfCandidates(paperKey, remotePdfURL, sourceLabel);
  document.title = `${paper.title} · Atlas 论文阅读器`;
  storage.set('atlas:last-paper', { id: paperKey, title: paper.title, read_at: new Date().toISOString() });
  const authors = (paper.authors || []).join(', ');
  const analysisEntry = analysisIndex.papers?.[id];
  const venueLabel = paper.venue?.name || (formalEvent?.venue_id ? String(formalEvent.venue_id).toUpperCase() : '预印本');
  const statusLabel = publicationStatusLabel(paper.publication_status);
  root.innerHTML = `<aside class="reader-sidebar glass-panel">
      <a class="reader-back" href="radar.html">← 返回论文雷达</a>
      <div class="reader-kicker"><span></span> ATLAS READER</div>
      <h1>${escapeHTML(paper.title)}</h1>
      <p class="reader-intro">${escapeHTML(paper.intro_zh || '中文导读仍在人工整理。')}</p>
      <dl class="reader-meta">
        <div><dt>公开日期</dt><dd>${escapeHTML(paper.published ? formatDate(paper.published) : '待确认')}</dd></div>
        <div><dt>作者</dt><dd title="${escapeHTML(authors)}">${escapeHTML(authors || '待确认')}</dd></div>
        <div><dt>收录版本</dt><dd>${escapeHTML(`${venueLabel}${statusLabel ? ` · ${statusLabel}` : ''}`)}</dd></div>
        <div><dt>全文来源</dt><dd>${escapeHTML(sourceLabel)} · 已核验公开源</dd></div>
      </dl>
      <div class="reader-notice"><strong>阅读边界</strong><p>PDF 由原始公开来源加载，Atlas 不修改论文正文。中文导读与结构化解析是编辑内容，应与原文对照阅读。</p></div>
      ${analysisEntry ? `<details class="reader-analysis" data-analysis-path="${escapeHTML(analysisEntry.path)}"><summary>打开初学者结构化解析 <span>＋</span></summary><div data-reader-analysis><p>正在加载解析…</p></div></details>` : '<div class="reader-analysis-pending">结构化解析尚未完成；可以先阅读原文。</div>'}
      <div class="reader-actions">
        <a class="button button-primary" href="${escapeHTML(remotePdfURL)}" target="_blank" rel="noopener noreferrer">新窗口打开 PDF ↗</a>
        <a class="button button-ghost" href="${escapeHTML(sourceURL)}" target="_blank" rel="noopener noreferrer">查看版本记录</a>
      </div>
    </aside>
    <section class="reader-document">
      <div class="reader-document-bar glass-panel">
        <span><i></i><b data-reader-status>正在获取公开全文</b></span>
        <div class="reader-zoom" aria-label="PDF 缩放控制"><button type="button" data-reader-zoom="out" aria-label="缩小 PDF">−</button><output data-reader-scale>适合宽度</output><button type="button" data-reader-zoom="in" aria-label="放大 PDF">＋</button></div>
        <small>${escapeHTML(paperKey)}</small>
      </div>
      <div class="reader-pages" data-reader-pages aria-label="${escapeHTML(paper.title)} PDF 全文"><div class="reader-pdf-loading"><span></span><p>正在从核验过的公开来源加载 PDF…</p></div></div>
      <div class="reader-pdf-fallback" hidden><p>站内渲染失败，请使用左侧“新窗口打开 PDF”。</p></div>
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
  await setupPdfReader(root, pdfCandidates);
}

async function setupPdfReader(root, pdfCandidates) {
  const container = root.querySelector('[data-reader-pages]');
  const status = root.querySelector('[data-reader-status]');
  const scaleOutput = root.querySelector('[data-reader-scale]');
  const fallback = root.querySelector('.reader-pdf-fallback');
  if (!container || !status) return;
  let documentProxy;
  let zoom = 1;
  const rendered = new Set();
  const rendering = new Map();
  try {
    let activeSource = null;
    let lastError = null;
    for (const candidate of pdfCandidates) {
      try {
        documentProxy = await pdfjsLib.getDocument({ url: candidate.url, cMapPacked: true }).promise;
        activeSource = candidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!documentProxy) throw lastError || new Error('没有可用的公开全文源');
    container.innerHTML = Array.from({ length: documentProxy.numPages }, (_, index) => `<figure class="reader-page-sheet" data-pdf-page="${index + 1}"><div class="reader-page-placeholder"><span>PAGE ${index + 1}</span></div><canvas aria-label="PDF 第 ${index + 1} 页"></canvas><figcaption>${index + 1} / ${documentProxy.numPages}</figcaption></figure>`).join('');
    status.textContent = `${activeSource.label} · ${documentProxy.numPages} 页`;
    const observer = new IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).forEach(entry => renderPage(Number(entry.target.dataset.pdfPage)));
    }, { root: container, rootMargin: '1200px 0px' });
    container.querySelectorAll('[data-pdf-page]').forEach(sheet => observer.observe(sheet));
    await renderPage(1);

    root.querySelector('.reader-zoom')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-reader-zoom]');
      if (!button) return;
      zoom = Math.max(.65, Math.min(2.25, zoom + (button.dataset.readerZoom === 'in' ? .15 : -.15)));
      scaleOutput.textContent = `${Math.round(zoom * 100)}%`;
      const pages = [...rendered];
      rendered.clear();
      await Promise.all(pages.map(renderPage));
    });
  } catch (error) {
    console.warn('Atlas PDF 站内渲染失败：', error);
    status.textContent = '站内渲染暂不可用';
    container.innerHTML = '<div class="reader-pdf-error"><strong>无法载入公开 PDF</strong><p>来源可能暂时限流或网络阻止跨域请求。请使用左侧的原始来源入口。</p></div>';
    fallback.hidden = false;
  }

  async function renderPage(pageNumber) {
    if (!documentProxy || rendered.has(pageNumber)) return;
    if (rendering.has(pageNumber)) return rendering.get(pageNumber);
    const job = (async () => {
      const page = await documentProxy.getPage(pageNumber);
      const sheet = container.querySelector(`[data-pdf-page="${pageNumber}"]`);
      const canvas = sheet?.querySelector('canvas');
      if (!sheet || !canvas) return;
      const unit = page.getViewport({ scale: 1 });
      const fitScale = Math.max(.45, (container.clientWidth - 54) / unit.width);
      const viewport = page.getViewport({ scale: fitScale * zoom });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport, transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0] }).promise;
      sheet.classList.add('is-rendered');
      rendered.add(pageNumber);
    })().finally(() => rendering.delete(pageNumber));
    rendering.set(pageNumber, job);
    return job;
  }
}

function renderReaderAnalysis(payload) {
  const beginner = payload.beginner || {};
  const method = payload.method || {};
  const contributions = (method.key_contributions || []).map(item => `<li>${escapeHTML(item)}</li>`).join('');
  const limitations = (method.limitations || []).map(item => `<li>${escapeHTML(item)}</li>`).join('');
  const evidence = (method.evidence || []).map(item => {
    const ratingClass = { '证据充分': 'strong', '证据部分': 'partial', '暂不可判': 'pending' }[item.rating] || 'pending';
    return `<article class="reader-evidence-item is-${ratingClass}"><header><span>${escapeHTML(item.dimension || '未命名维度')}</span><b>${escapeHTML(item.rating || '暂不可判')}</b></header><p>${escapeHTML(item.note || '')}</p></article>`;
  }).join('');
  return `<h2>${escapeHTML(beginner.one_sentence || '')}</h2>
    <section><strong>问题</strong><p>${escapeHTML(beginner.problem || '')}</p></section>
    <section><strong>直觉</strong><p>${escapeHTML(beginner.intuition || '')}</p></section>
    <ol>${(beginner.steps || []).map((step, index) => `<li><b>${index + 1}</b><span>${escapeHTML(step)}</span></li>`).join('')}</ol>
    ${renderReaderFlow(payload.flow || {})}
    ${contributions ? `<section><strong>真正的方法增量</strong><ul>${contributions}</ul></section>` : ''}
    ${limitations ? `<section><strong>阅读时别忽略</strong><ul>${limitations}</ul></section>` : ''}
    ${evidence ? `<section class="reader-evidence"><strong>五维证据判断</strong><div class="reader-evidence-list">${evidence}</div></section>` : ''}`;
}

function renderReaderFlow(flow) {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  if (nodes.length < 2 || !Array.isArray(flow.edges) || !flow.edges.length) return '';
  const edges = flow.edges.map(edge => {
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
    return `<path class="paper-flow-edge" d="${path}" marker-end="url(#reader-flow-arrow)"/><text class="paper-flow-label" x="${labelX}" y="${labelY}">${escapeHTML(edge.label || '')}</text>`;
  }).join('');
  const nodeMarkup = nodes.map(node => `<g class="paper-flow-node${node.accent ? ' is-accent' : ''}" transform="translate(${Number(node.x)},${Number(node.y)})">
      <title>${escapeHTML(node.note || node.label || '')}</title><rect width="150" height="64" rx="12"/><text x="75" y="29" text-anchor="middle">${escapeHTML(node.label || '')}</text><text class="paper-flow-hint" x="75" y="47" text-anchor="middle">方法节点</text>
    </g>`).join('');
  return `<figure class="paper-flow reader-paper-flow"><figcaption>${escapeHTML(flow.title || '论文方法流程')}</figcaption><div><svg viewBox="0 0 1050 350" role="img" aria-label="${escapeHTML(flow.title || '论文方法流程图')}"><defs><marker id="reader-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edges}${nodeMarkup}</svg></div></figure>`;
}

async function buildPdfCandidates(paperKey, remotePdfURL, sourceLabel) {
  const candidates = [];
  if (location.protocol === 'http:') {
    try {
      const manifest = await loadJSON('library/manifest.json');
      const local = manifest.records?.[paperKey];
      if (['downloaded', 'pdf_only'].includes(local?.status) && local.local_pdf) {
        candidates.push({ url: local.local_pdf, label: '本机全文缓存' });
      }
    } catch { /* 本机尚未建立个人研究库时继续使用公开源。 */ }
  }
  const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (location.protocol === 'https:' && !isLocalHost) {
    candidates.push({ url: `api/pdf?url=${encodeURIComponent(remotePdfURL)}`, label: `${sourceLabel} · 安全转发` });
  }
  candidates.push({ url: remotePdfURL, label: `${sourceLabel} · 原始公开源` });
  return candidates;
}

function normalizePublished(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{4}$/.test(text)) return `${text}-01-01`;
  return '';
}

function publicationStatusLabel(value) {
  return {
    formally_published: '正式发表',
    proceedings_published: '论文集已发布',
    published_online: '在线发表',
    issue_assigned: '卷期已分配'
  }[String(value || '')] || '';
}

function cleanFormalId(value) {
  const text = String(value || '').trim();
  return /^(?:doi:10\.\d{4,9}\/[a-z0-9._;()/:-]+|cvf:[a-z0-9._:-]+)$/i.test(text) ? text : '';
}

function cleanArxivId(value) {
  const match = String(value || '').match(/(?:arxiv:|abs\/|pdf\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return match ? match[1] : '';
}
