import {
  CATEGORIES,
  categoryMeta,
  displayValue,
  escapeHTML,
  formatDate,
  initReveals,
  isKnown,
  loadJSON,
  loadModels,
  observeNumber,
  setupSearch
} from '../core.js?v=20260719.8';

const categoryDescriptions = {
  vla: '把视觉与语言指令，直接变成机器人动作。',
  world: '建模环境随时间和动作发生的变化。',
  detection: '识别图像中的对象，并给出它们的位置。',
  representation: '把图像映射成可比较、可检索的语义表示。',
  segmentation: '从框走向像素，刻画对象与场景边界。',
  multimodal: '统一处理文字、图像、视频与机器人任务。'
};

const categoryRepresentatives = {
  vla: ['rt-2', 'openvla', 'pi0'],
  world: ['dreamer-v3', 'sora', 'cosmos'],
  detection: ['yolo-v1', 'detr', 'grounding-dino'],
  representation: ['clip', 'dinov2', 'siglip-2'],
  segmentation: ['sam', 'sam-2', 'mask2former'],
  multimodal: ['gpt-4v', 'qwen2-5-vl', 'gemini-robotics']
};

const observationThreads = [
  {
    index: '01',
    title: '视觉语言如何接入动作',
    description: '并排观察动作表示、视觉语言预训练与开放实现如何汇入机器人策略。',
    ids: ['rt-1', 'rt-2', 'openvla'],
    focus: 'openvla'
  },
  {
    index: '02',
    title: '检测接口如何被重新定义',
    description: '从单阶段密集预测、集合预测到文本条件定位，比较任务输入与输出的变化。',
    ids: ['yolo-v1', 'detr', 'grounding-dino'],
    focus: 'grounding-dino'
  },
  {
    index: '03',
    title: '通用视觉接口走向可提示',
    description: '从图文语义对齐，到可提示分割，再到统一处理图片与视频中的对象。',
    ids: ['clip', 'sam', 'sam-2'],
    focus: 'sam-2'
  }
];

const glossaryShortlist = ['vla', 'world-model', 'token', 'action-chunking', 'grounding', 'zero-shot'];

function splitTitle() {
  const title = document.querySelector('[data-split-title]');
  if (!title || title.querySelector('.char')) return;
  const text = title.textContent;
  title.setAttribute('aria-label', text);
  title.innerHTML = [...text].map((char, i) => `<span class="char" aria-hidden="true" style="--i:${i}">${char === ' ' ? '&nbsp;' : char}</span>`).join('');
}

function initNetwork() {
  const canvas = document.getElementById('hero-network');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = { x: .5, y: .45, active: false };
  let width = 0, height = 0, dpr = 1, particles = [], frame;

  const resize = () => {
    const box = canvas.getBoundingClientRect();
    width = box.width;
    height = box.height;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(34, Math.min(88, Math.floor(width * height / 16000)));
    particles = Array.from({ length: count }, (_, index) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - .5) * .13,
      vy: (Math.random() - .5) * .13,
      r: index % 9 === 0 ? 1.7 : .8 + Math.random() * .6,
      depth: .3 + Math.random() * .7
    }));
  };

  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    const px = pointer.x * width, py = pointer.y * height;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!reduced) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
      }
      const shiftX = pointer.active ? (px - width / 2) * .012 * p.depth : 0;
      const shiftY = pointer.active ? (py - height / 2) * .012 * p.depth : 0;
      const x = p.x + shiftX, y = p.y + shiftY;
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const qx = q.x + shiftX * q.depth, qy = q.y + shiftY * q.depth;
        const distance = Math.hypot(x - qx, y - qy);
        if (distance < 118) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(qx, qy);
          ctx.strokeStyle = `rgba(166, 124, 92, ${(.16 * (1 - distance / 118)).toFixed(3)})`;
          ctx.lineWidth = .7;
          ctx.stroke();
        }
      }
      const pointerDistance = Math.hypot(x - px, y - py);
      const glow = pointer.active && pointerDistance < 150 ? 1 - pointerDistance / 150 : 0;
      ctx.beginPath();
      ctx.arc(x, y, p.r + glow * .9, 0, Math.PI * 2);
      ctx.fillStyle = glow > 0 ? `rgba(198,97,63,${.35 + glow * .5})` : 'rgba(150, 116, 88, .4)';
      ctx.fill();
    }
    if (!reduced) frame = requestAnimationFrame(draw);
  };

  const hero = canvas.parentElement;
  hero.addEventListener('pointermove', event => {
    const box = hero.getBoundingClientRect();
    pointer.x = (event.clientX - box.left) / box.width;
    pointer.y = (event.clientY - box.top) / box.height;
    pointer.active = true;
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointer.active = false; });
  new ResizeObserver(resize).observe(canvas);
  resize();
  draw();
  addEventListener('pagehide', () => cancelAnimationFrame(frame), { once: true });
}

function renderStats(models, papers, terms) {
  const stats = [
    { value: models.length, label: '图鉴模型' },
    { value: papers.length, label: '本地论文快照' },
    { value: terms.length, label: '中英术语条目' },
    { value: Object.keys(CATEGORIES).length, label: '技术类别' }
  ];
  const root = document.getElementById('home-stats');
  root.innerHTML = stats.map((stat, index) => `<article class="home-metric reveal-item" style="--delay:${index * 65}ms"><strong data-value="${stat.value}">0</strong><span>${stat.label}</span></article>`).join('');
  root.querySelectorAll('strong').forEach((element, index) => observeNumber(element, stats[index].value, { duration: 900 + index * 100 }));
}

function renderRecentModels(models) {
  const recent = models
    .filter(model => Number.isFinite(Number(model.year)) && (isKnown(model.paper_url) || isKnown(model.github_url)))
    .sort((a, b) => Number(b.year) - Number(a.year) || a.name.localeCompare(b.name, 'en'))
    .slice(0, 6);
  const root = document.getElementById('recent-models');
  root.innerHTML = recent.map((model, index) => {
    const meta = categoryMeta(model.category);
    const sources = [isKnown(model.paper_url) ? '论文' : '', isKnown(model.github_url) ? '仓库' : ''].filter(Boolean);
    return `<article class="release-card reveal-item" style="--card-color:${meta.color};--delay:${(index % 3) * 70}ms">
      <a href="model.html?id=${encodeURIComponent(model.id)}" aria-label="查看 ${escapeHTML(model.name)} 详情">
        <div class="release-card-top"><span class="release-year">${escapeHTML(model.year)}</span><span class="release-category">${escapeHTML(meta.short)}</span></div>
        <h3>${escapeHTML(model.name)}</h3>
        <p class="release-org">${escapeHTML(displayValue(model.org))}</p>
        <p class="release-summary">${escapeHTML(model.one_liner_zh || '公开资料仍在整理中。')}</p>
        <div class="release-footer"><span>${sources.map(source => `<i>${source}</i>`).join('')}</span><b aria-hidden="true">↗</b></div>
      </a>
    </article>`;
  }).join('');
}

function representativeModels(models, category) {
  const byId = new Map(models.map(model => [model.id, model]));
  const preferred = (categoryRepresentatives[category] || []).map(id => byId.get(id)).filter(Boolean);
  if (preferred.length >= 3) return preferred.slice(0, 3);
  const fallback = models
    .filter(model => model.category === category && !preferred.some(item => item.id === model.id))
    .sort((a, b) => (b.tier === 'A') - (a.tier === 'A') || Number(b.year || 0) - Number(a.year || 0));
  return [...preferred, ...fallback].slice(0, 3);
}

function renderCategories(models) {
  const root = document.getElementById('category-portals');
  root.innerHTML = Object.entries(CATEGORIES).map(([key, meta], index) => {
    const categoryModels = models.filter(model => model.category === key);
    const representatives = representativeModels(models, key);
    return `<a class="category-portal reveal-item" style="--portal-color:${meta.color};--delay:${(index % 3) * 70}ms" href="explore.html?category=${key}">
      <span class="portal-index">${meta.code} / ${key.toUpperCase()}</span>
      <h3>${escapeHTML(meta.label)}</h3>
      <p>${categoryDescriptions[key]}</p>
      <span class="portal-examples" aria-label="代表条目">${representatives.map(model => escapeHTML(model.name)).join(' · ')}</span>
      <span class="portal-count">${categoryModels.length} 个模型 <b aria-hidden="true">↗</b></span>
    </a>`;
  }).join('');
}

function renderThreads(models) {
  const byId = new Map(models.map(model => [model.id, model]));
  const root = document.getElementById('home-threads');
  root.innerHTML = observationThreads.map((thread, index) => {
    const nodes = thread.ids.map(id => byId.get(id)).filter(Boolean);
    return `<article class="thread-card reveal-item" style="--delay:${index * 80}ms">
      <span class="thread-index">THREAD ${thread.index}</span>
      <h3>${escapeHTML(thread.title)}</h3>
      <p>${escapeHTML(thread.description)}</p>
      <div class="thread-nodes">${nodes.map((model, nodeIndex) => `<a href="model.html?id=${encodeURIComponent(model.id)}"><span>${escapeHTML(model.name)}</span><small>${escapeHTML(displayValue(model.year))}</small>${nodeIndex < nodes.length - 1 ? '<i aria-hidden="true">→</i>' : ''}</a>`).join('')}</div>
      <a class="thread-link" href="lineage.html?focus=${encodeURIComponent(thread.focus)}">在谱系图中查看 <span aria-hidden="true">↗</span></a>
    </article>`;
  }).join('');
}

function renderPaperSnapshot(rawPapers) {
  const papers = rawPapers
    .filter(paper => paper?.title && paper?.url)
    .sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')) || String(a.title).localeCompare(String(b.title), 'en'))
    .slice(0, 4);
  const root = document.getElementById('paper-snapshot');
  root.innerHTML = papers.map((paper, index) => {
    const meta = categoryMeta(paper.category);
    return `<a class="paper-snapshot-item reveal-item" style="--paper-color:${meta.color};--delay:${index * 60}ms" href="${escapeHTML(paper.url)}" target="_blank" rel="noopener noreferrer">
      <div><span>${escapeHTML(meta.short)}</span><time datetime="${escapeHTML(paper.published || '')}">${escapeHTML(formatDate(paper.published))}</time></div>
      <h3 lang="en">${escapeHTML(paper.title)}</h3>
      ${paper.intro_zh ? `<p>${escapeHTML(paper.intro_zh)}</p>` : ''}
      <b aria-hidden="true">↗</b>
    </a>`;
  }).join('');
}

function renderGlossarySnapshot(terms) {
  const byId = new Map(terms.map(term => [term.id, term]));
  const shortlist = glossaryShortlist.map(id => byId.get(id)).filter(Boolean);
  const selected = shortlist.length >= 4 ? shortlist : terms.slice(0, 6);
  const root = document.getElementById('glossary-snapshot');
  root.innerHTML = selected.slice(0, 6).map((term, index) => `<a class="glossary-snapshot-item reveal-item" style="--delay:${index * 55}ms" href="glossary.html?q=${encodeURIComponent(term.term_en || term.term || '')}">
    <span class="glossary-snapshot-en" lang="en">${escapeHTML(term.term_en || term.term || 'unknown')}</span>
    <strong>${escapeHTML(term.term || term.term_en || '术语')}</strong>
    <p>${escapeHTML(term.definition_zh || '释义整理中。')}</p>
    <b aria-hidden="true">↗</b>
  </a>`).join('');
}

export async function init() {
  splitTitle();
  initNetwork();
  const [models, paperData, glossaryData] = await Promise.all([
    loadModels(),
    loadJSON('data/papers.json'),
    loadJSON('data/glossary.json')
  ]);
  const papers = Array.isArray(paperData?.papers) ? paperData.papers : [];
  const terms = Array.isArray(glossaryData) ? glossaryData : [];
  setupSearch(document.getElementById('hero-search'), document.getElementById('hero-search-results'), models, { max: 7 });
  renderStats(models, papers, terms);
  renderRecentModels(models);
  renderCategories(models);
  renderThreads(models);
  renderPaperSnapshot(papers);
  renderGlossarySnapshot(terms);
  initReveals();
}
