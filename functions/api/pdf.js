const SOURCE_RULES = [
  { host: 'arxiv.org', path: /^\/pdf\/[0-9]{4}\.[0-9]{4,5}(?:v\d+)?(?:\.pdf)?$/i },
  { host: 'openaccess.thecvf.com', path: /^\/content\/.+\.pdf$/i },
  { host: 'proceedings.mlr.press', path: /^\/v\d+\/.+\.pdf$/i },
  { host: 'openreview.net', path: /^\/pdf$/i },
  { host: 'link.springer.com', path: /^\/content\/pdf\/10\.1007\/(?:s10514-026-10257-4|s10514-026-10253-8)\.pdf$/i }
];
const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_DECLARED_PDF_BYTES = 128 * 1024 * 1024;
const MAX_RANGE_BYTES = 16 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;

export async function onRequestGet({ request }) {
  const requestURL = new URL(request.url);
  const rawSource = requestURL.searchParams.get('url') || '';
  if (!rawSource || rawSource.length > MAX_SOURCE_URL_LENGTH) return failure(400, '公开论文 PDF 地址无效或过长');
  let source;
  try {
    source = new URL(rawSource);
  } catch {
    return failure(400, '缺少有效的公开论文 PDF 地址');
  }
  if (!isAllowedSource(source)) return failure(403, '该全文来源不在 Atlas 公开源白名单中');

  const requestedRange = request.headers.get('Range');
  if (requestedRange && !isAllowedRange(requestedRange)) return failure(416, '只支持不超过 16 MiB 的单段 PDF Range 请求');

  const headers = new Headers({
    Accept: 'application/pdf',
    'User-Agent': 'AtlasPaperReader/1.0 (+https://atlas-embodied-vision.pages.dev/)'
  });
  for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream;
  try {
    upstream = await fetchAllowed(source, headers);
  } catch (error) {
    return failure(502, error instanceof Error ? error.message : '公开全文源暂不可用');
  }
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
    return failure(upstream.status, `公开全文源返回 ${upstream.status}`);
  }
  const contentType = upstream.headers.get('content-type') || '';
  if (upstream.status !== 304 && contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf') {
    return failure(502, '公开来源返回的内容不是 PDF');
  }
  const declaredLength = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DECLARED_PDF_BYTES) {
    return failure(413, '公开 PDF 超过 Atlas 单次流式读取上限');
  }

  const responseHeaders = new Headers({
    'Content-Type': contentType || 'application/pdf',
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Access-Control-Allow-Origin': '*',
    'Vary': 'Range'
  });
  for (const name of ['Accept-Ranges', 'Content-Range', 'Content-Length', 'ETag', 'Last-Modified']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.status === 304 ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}

async function fetchAllowed(initialURL, headers) {
  let current = initialURL;
  for (let hop = 0; hop < 4; hop += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, { headers, redirect: 'manual', signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('公开全文源响应超时');
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('公开全文源重定向缺少目标地址');
    current = new URL(location, current);
    if (!isAllowedSource(current)) throw new Error('公开全文源重定向离开白名单');
  }
  throw new Error('公开全文源重定向次数过多');
}

function isAllowedSource(url) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
  if (!isAllowedQuery(url)) return false;
  return SOURCE_RULES.some(rule => url.hostname === rule.host && rule.path.test(url.pathname));
}

function isAllowedQuery(url) {
  if (url.hostname !== 'openreview.net') return url.search === '';
  const keys = [...url.searchParams.keys()];
  return keys.length === 1 && keys[0] === 'id' && /^[A-Za-z0-9_-]{1,160}$/.test(url.searchParams.get('id') || '');
}

function isAllowedRange(value) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if ((start !== null && !Number.isSafeInteger(start)) || (end !== null && !Number.isSafeInteger(end))) return false;
  if (start !== null && end !== null && (end < start || end - start + 1 > MAX_RANGE_BYTES)) return false;
  if (start === null && end !== null && end > MAX_RANGE_BYTES) return false;
  return true;
}

function failure(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
