import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = (process.env.ATLAS_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const outputDir = process.env.ATLAS_BROWSER_OUTPUT || '/tmp/atlas-browser-check';
const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile390', width: 390, height: 844 },
  { name: 'mobile320', width: 320, height: 720 }
];
const pages = [
  ['home', 'index.html'],
  ['explore', 'explore.html'],
  ['model', 'model.html?id=openvla'],
  ['compare', 'compare.html?ids=openvla,rt-2'],
  ['radar', 'radar.html'],
  ['reader', 'reader.html?id=2103.00020'],
  ['venues', 'venues.html?view=journals'],
  ['lineage', 'lineage.html?category=vla&focus=openvla'],
  ['timeline', 'timeline.html'],
  ['trends', 'trends.html'],
  ['glossary', 'glossary.html']
];
const extraViews = [
  ['venues-conferences', 'venues.html?view=conferences'],
  ['venues-compare', 'venues.html?view=compare'],
  ['radar-formal', 'radar.html?source=formal-tracker']
];

const requiredSelectors = {
  home: ['#hero-title', '.search-field-xl'],
  explore: ['#model-grid .model-card'],
  model: ['#model-detail .evidence-ledger', '#model-detail a[href^="reader.html?id="]'],
  compare: ['#compare-content .compare-visual'],
  radar: ['#lib-results .paper-card', '#lib-results a[href^="reader.html?id="]'],
  'radar-formal': ['#lib-results .paper-card', '#lib-results a[href^="reader.html?paper="]'],
  reader: ['.reader-sidebar', '.reader-page-sheet.is-rendered canvas'],
  venues: ['#academic-view-tabs', '#academic-content'],
  'venues-conferences': ['#academic-view-tabs', '#academic-content'],
  'venues-compare': ['#academic-view-tabs', '#academic-content'],
  lineage: ['#lineage-stage'],
  timeline: ['#timeline .timeline-year'],
  trends: ['#trend-metrics'],
  glossary: ['#glossary-list']
};

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
    for (const [name, relativeURL] of [...pages, ...extraViews]) {
      const page = await context.newPage();
      if (name === 'radar') {
        await page.addInitScript(() => {
          const nativeFetch = window.fetch.bind(window);
          window.__atlasRadarMockMode = 'success';
          window.fetch = (input, init) => {
            const url = String(typeof input === 'string' ? input : input?.url || '');
            const isOpenAlex = url.startsWith('https://api.openalex.org/');
            const isHuggingFace = url.startsWith('https://huggingface.co/api/daily_papers');
            if (!isOpenAlex && !isHuggingFace) return nativeFetch(input, init);
            if (window.__atlasRadarMockMode === 'failure') {
              return Promise.resolve(new Response('{"error":"rate limited by browser audit"}', {
                status: 429,
                headers: { 'Content-Type': 'application/json' }
              }));
            }
            const payload = isOpenAlex ? {
              results: [{
                id: 'https://openalex.org/W-ATLAS-BROWSER-AUDIT',
                doi: null,
                title: 'RoboTTT: Conflicting Metadata Snapshot',
                display_name: 'RoboTTT: Conflicting Metadata Snapshot',
                publication_date: '2026-07-18',
                ids: { arxiv: 'https://arxiv.org/abs/2607.15275' },
                primary_location: { landing_page_url: 'https://openalex.org/W-ATLAS-BROWSER-AUDIT' },
                best_oa_location: null,
                authorships: [{ author: { display_name: 'Audit Author' } }],
                abstract_inverted_index: { robot: [0], policy: [1], audit: [2] },
                cited_by_count: 0,
                is_retracted: false,
                relevance_score: 1
              }]
            } : [];
            return Promise.resolve(new Response(JSON.stringify(payload), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }));
          };
        });
      }
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const badResponses = [];
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} · ${request.failure()?.errorText || 'failed'}`));
      page.on('response', response => {
        const url = response.url();
        if (url.startsWith(baseURL) && response.status() >= 400) badResponses.push(`${response.status()} ${url}`);
      });
      const response = await page.goto(`${baseURL}/${relativeURL}`, { waitUntil: 'networkidle', timeout: 45_000 });
      if (name === 'reader') {
        await page.locator('.reader-page-sheet.is-rendered canvas').first().waitFor({ state: 'visible', timeout: 20_000 });
      }
      await page.waitForTimeout(name === 'home' ? 1_800 : 700);
      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };
        const selectors = ['.detail-skeleton', '.paper-skeleton', '.reader-loading', '.page-error'];
        const leftovers = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(visible).map(() => selector));
        const brokenImages = [...document.images].filter(element => visible(element) && element.complete && element.naturalWidth === 0)
          .map(element => element.currentSrc || element.src || element.alt || 'unknown image');
        const criticalTargets = [...document.querySelectorAll('button, select, input, .button, .icon-button, summary')]
          .filter(visible).filter(element => {
            if (!element.matches('input[type="checkbox"], input[type="radio"]')) return true;
            const wrapper = element.closest('label');
            return !wrapper || wrapper.getBoundingClientRect().height < 44;
          }).map(element => {
            const rect = element.getBoundingClientRect();
            return { tag: element.tagName, label: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 60), width: Math.round(rect.width), height: Math.round(rect.height) };
          }).filter(item => item.width < 44 || item.height < 44);
        return {
          title: document.title,
          documentWidth: doc.scrollWidth,
          viewportWidth: doc.clientWidth,
          bodyWidth: body.scrollWidth,
          overflowX: Math.max(doc.scrollWidth, body.scrollWidth) - doc.clientWidth,
          leftovers,
          brokenImages,
          criticalTargets
        };
      });
      const functionalChecks = [];
      if (!['home', 'reader'].includes(name)) {
        const count = await page.locator('#breadcrumbs').count();
        functionalChecks.push({ selector: '#breadcrumbs', count, passed: count > 0 });
      }
      if (name !== 'reader') {
        const count = await page.locator('#site-header nav').count();
        functionalChecks.push({ selector: '#site-header nav', count, passed: count > 0 });
      }
      for (const selector of requiredSelectors[name] || []) {
        const count = await page.locator(selector).count();
        functionalChecks.push({ selector, count, passed: count > 0 });
      }
      const screenshotPath = path.join(outputDir, `${viewport.name}-${name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const interactionChecks = await runInteractionChecks(page, name, viewport);
      results.push({ viewport, name, relativeURL, status: response?.status() || 0, ...metrics, functionalChecks, interactionChecks, consoleErrors, pageErrors, failedRequests, badResponses, screenshotPath });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const failures = results.filter(item => item.status >= 400 || item.status === 0 || item.overflowX > 2 || item.leftovers.length || item.brokenImages.length || item.functionalChecks.some(check => !check.passed) || item.interactionChecks.some(check => !check.passed) || item.consoleErrors.length || item.pageErrors.length || item.badResponses.length);
const mobileTargetIssues = results.filter(item => item.viewport.width <= 390 && item.criticalTargets.length);
const report = { generatedAt: new Date().toISOString(), baseURL, viewports, pages: results, failures: failures.length, mobileTargetIssuePages: mobileTargetIssues.length };
await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
for (const item of results) {
  const flags = [item.overflowX > 2 ? `overflow=${item.overflowX}` : '', item.leftovers.length ? `leftovers=${item.leftovers.join(',')}` : '', item.brokenImages.length ? `broken-images=${item.brokenImages.length}` : '', item.functionalChecks.some(check => !check.passed) ? `function=${item.functionalChecks.filter(check => !check.passed).map(check => check.selector).join(',')}` : '', item.interactionChecks.some(check => !check.passed) ? `interaction=${item.interactionChecks.filter(check => !check.passed).map(check => check.label).join(',')}` : '', item.consoleErrors.length ? `console=${item.consoleErrors.length}` : '', item.pageErrors.length ? `pageerror=${item.pageErrors.length}` : '', item.badResponses.length ? `http=${item.badResponses.length}` : '', item.viewport.width <= 390 && item.criticalTargets.length ? `touch=${item.criticalTargets.length}` : ''].filter(Boolean).join(' ');
  console.log(`${flags && 'WARN'} ${item.viewport.name.padEnd(9)} ${item.name.padEnd(19)} status=${item.status} ${flags}`.trim());
}
console.log(`\nBrowser audit: ${results.length} renders, ${failures.length} hard failures, ${mobileTargetIssues.length} mobile pages with undersized critical controls.`);
console.log(`Report: ${path.join(outputDir, 'report.json')}`);
if (failures.length) process.exitCode = 1;

async function runInteractionChecks(page, name, viewport) {
  const checks = [];
  const check = async (label, action) => {
    try {
      const result = await action();
      if (result === false) throw new Error('assertion returned false');
      checks.push({ label, passed: true });
    } catch (error) {
      checks.push({ label, passed: false, error: error instanceof Error ? error.message : String(error) });
    }
  };

  if (viewport.width <= 390) {
    await check('mobile-menu-toggle', async () => {
      const toggle = page.locator('#mobile-menu-toggle');
      await toggle.click();
      const opened = await toggle.getAttribute('aria-expanded') === 'true' && await page.locator('#mobile-menu').isVisible();
      await toggle.click();
      return opened && await toggle.getAttribute('aria-expanded') === 'false';
    });
  }

  if (name === 'home') {
    await check('hero-search-yolo13-fuzzy', async () => {
      await page.locator('#hero-search').fill('YOLO13');
      const result = page.locator('#hero-search-results .search-result-item').first();
      await result.waitFor({ state: 'visible', timeout: 3_000 });
      const matched = /yolov?13/i.test(await result.textContent() || '');
      await page.locator('#hero-search').fill('');
      return matched;
    });
  } else if (name === 'explore') {
    await check('explore-filter-reset', async () => {
      if (viewport.width <= 900) await page.locator('#filter-toggle').click();
      await page.locator('[data-filter="favorites"]').click();
      await page.locator('#empty-state').waitFor({ state: 'visible', timeout: 3_000 });
      const emptyFavoriteState = /收藏/.test(await page.locator('#result-summary').textContent() || '');
      await page.locator('#reset-filters').click();
      await page.locator('[data-filter="category"][data-value="vla"]').click();
      await page.waitForFunction(() => new URLSearchParams(location.search).get('category') === 'vla');
      const hasResults = await page.locator('#model-grid .model-card').count() > 0;
      await page.locator('#sort-select').selectOption('year-desc');
      await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'year-desc');
      await page.locator('#reset-filters').click();
      await page.waitForFunction(() => !new URLSearchParams(location.search).has('category'));
      return emptyFavoriteState && hasResults;
    });
  } else if (name === 'model') {
    await check('favorite-toggle-roundtrip', async () => {
      const favorite = page.locator('[data-detail-favorite]');
      const before = await favorite.getAttribute('aria-pressed');
      await favorite.click();
      const changed = await favorite.getAttribute('aria-pressed');
      await favorite.click();
      return changed !== before && await favorite.getAttribute('aria-pressed') === before;
    });
  } else if (name === 'compare') {
    await check('compare-third-model', async () => {
      await page.locator('#compare-2').selectOption('sam');
      await page.waitForFunction(() => (new URLSearchParams(location.search).get('ids') || '').split(',').includes('sam'));
      await page.waitForFunction(() => document.querySelectorAll('.compare-head .compare-cell').length === 4);
      return true;
    });
  } else if (name === 'radar') {
    await check('radar-presets-cache-failure-conflict', async () => {
      await page.locator('[data-tab="vla"]').click();
      await page.waitForFunction(() => new URLSearchParams(location.search).get('category') === 'vla');
      if (await page.locator('#lib-results .paper-card').count() === 0) return false;
      await page.locator('[data-tab="all"]').click();
      await page.locator('#live-refresh').click();
      await page.waitForFunction(() => document.querySelectorAll('#source-statuses .state-ready').length === 4);
      if (await page.locator('#lib-results .paper-conflict').count() === 0) return false;
      await page.evaluate(() => { window.__atlasRadarMockMode = 'failure'; });
      await page.locator('#live-refresh').click();
      await page.waitForFunction(() => document.querySelectorAll('#source-statuses .state-stale').length === 2, null, { timeout: 5_000 });
      await page.locator('#lib-search').fill('RoboTTT');
      await page.waitForTimeout(350);
      const card = page.locator('#lib-results .paper-card', { hasText: 'RoboTTT' }).first();
      await card.waitFor({ state: 'visible', timeout: 3_000 });
      await page.locator('#lib-search').press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('#source-statuses .state-error').length === 2, null, { timeout: 5_000 });
      return await card.isVisible();
    });
  } else if (name === 'radar-formal' && viewport.name === 'desktop') {
    await check('formal-reader-and-source-fallback', async () => {
      const internal = page.locator('#lib-results a[href^="reader.html?paper="]');
      const fallback = page.locator('#lib-results a.button-primary[target="_blank"]');
      if (await internal.count() === 0 || await fallback.count() === 0) return false;
      await internal.first().click();
      await page.locator('.reader-page-sheet.is-rendered canvas').first().waitFor({ state: 'visible', timeout: 20_000 });
      return true;
    });
  } else if (name === 'reader' && viewport.name === 'desktop') {
    await check('reader-zoom-and-analysis', async () => {
      const scale = page.locator('[data-reader-scale]');
      const before = await scale.textContent();
      await page.locator('[data-reader-zoom="in"]').click();
      await page.waitForFunction(value => document.querySelector('[data-reader-scale]')?.textContent !== value, before);
      const summary = page.locator('.reader-analysis > summary');
      if (await summary.count()) {
        await summary.click();
        await page.locator('[data-reader-analysis] .reader-paper-flow').waitFor({ state: 'visible', timeout: 5_000 });
      }
      return true;
    });
  } else if (name === 'lineage' && viewport.name === 'desktop') {
    await check('lineage-zoom-drag-category', async () => {
      const viewportRoot = page.locator('#lineage-viewport');
      const before = await viewportRoot.getAttribute('transform');
      await page.locator('#zoom-in').click();
      const zoomed = await viewportRoot.getAttribute('transform');
      if (zoomed === before) return false;
      const box = await page.locator('#lineage-stage').boundingBox();
      if (!box) return false;
      await page.mouse.move(box.x + 12, box.y + 12);
      await page.mouse.down();
      await page.mouse.move(box.x + 42, box.y + 32, { steps: 3 });
      await page.mouse.up();
      const dragged = await viewportRoot.getAttribute('transform');
      if (dragged === zoomed) return false;
      for (const category of ['vla', 'world', 'detection', 'representation', 'segmentation', 'multimodal']) {
        await page.locator('#lineage-category').selectOption(category);
        await page.waitForFunction(value => new URLSearchParams(location.search).get('category') === value, category);
        if (await page.locator('#lineage-nodes [data-id]').count() === 0) return false;
      }
      await page.goto(`${baseURL}/lineage.html?category=vla&focus=openvla`, { waitUntil: 'networkidle' });
      return await page.locator('#lineage-nodes [data-id="openvla"]').count() === 1;
    });
  } else if (name === 'timeline') {
    await check('timeline-category-filter', async () => {
      await page.locator('#timeline-categories [data-category="vla"]').click();
      await page.waitForFunction(() => new URLSearchParams(location.search).get('category') === 'vla');
      return await page.locator('#timeline .timeline-card').count() > 0;
    });
  } else if (name === 'glossary') {
    await check('glossary-alias-search', async () => {
      await page.locator('#glossary-search').fill('YOLO');
      await page.waitForFunction(() => new URLSearchParams(location.search).get('q') === 'YOLO');
      return await page.locator('#glossary-list .glossary-item').count() > 0;
    });
  } else if (name === 'trends') {
    await check('trends-neutral-sample-boundary', async () => {
      const note = await page.locator('.data-note').textContent() || '';
      return note.includes('只统计当前图鉴样本') && note.includes('不代表行业全量论文');
    });
  }

  return checks;
}
