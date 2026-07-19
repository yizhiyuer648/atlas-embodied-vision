const SPRINGER_PDF_PATH = /^\/content\/pdf\/10\.1007\/s\d{5}-\d{3}-\d{5}-[0-9x]\.pdf$/i;
const SOURCE_RULES = [
  { host: 'arxiv.org', path: /^\/pdf\/[0-9]{4}\.[0-9]{4,5}(?:v\d+)?(?:\.pdf)?$/i },
  { host: 'openaccess.thecvf.com', path: /^\/content\/.+\.pdf$/i },
  { host: 'proceedings.mlr.press', path: /^\/v\d+\/.+\.pdf$/i },
  { host: 'openreview.net', path: /^\/pdf$/i },
  { host: 'link.springer.com', path: SPRINGER_PDF_PATH }
];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_SOURCE_URL_LENGTH = 2048;
const MAX_DECLARED_PDF_BYTES = 128 * 1024 * 1024;
const MAX_RANGE_BYTES = 16 * 1024 * 1024;
const MAX_REDIRECT_HOPS = 3;
const MAX_SPRINGER_RETRIES = 1;
const UPSTREAM_TOTAL_TIMEOUT_MS = 30_000;
const USER_AGENT = 'AtlasPaperReader/1.0 (+https://atlas-embodied-vision.pages.dev/)';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const range = requestedRange ? parseAllowedRange(requestedRange) : null;
  if (requestedRange && !range) return failure(416, '只支持不超过 16 MiB 的有界单段 PDF Range 请求');

  const headers = new Headers({ Accept: 'application/pdf', 'User-Agent': USER_AGENT });
  for (const name of ['Range', 'If-Range', 'If-None-Match', 'If-Modified-Since']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const deadline = createDeadline(UPSTREAM_TOTAL_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetchAllowed(source, headers, deadline.signal);
  } catch (error) {
    deadline.clear();
    const message = deadline.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      ? '公开全文源响应超时'
      : error instanceof Error ? error.message : '公开全文源暂不可用';
    return failure(502, message);
  }

  if (!upstream.ok && upstream.status !== 304) {
    return rejectUpstream(upstream, deadline, upstream.status, `公开全文源返回 ${upstream.status}`);
  }
  if (upstream.status === 304) {
    deadline.clear();
    return new Response(null, { status: 304, headers: responseHeaders(upstream, '') });
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf') {
    return rejectUpstream(upstream, deadline, 502, '公开来源返回的内容不是 PDF');
  }
  if (!upstream.body) return rejectUpstream(upstream, deadline, 502, '公开 PDF 没有可读取的正文');

  const declared = parseOptionalLength(upstream.headers.get('content-length'));
  if (!declared.valid) return rejectUpstream(upstream, deadline, 502, '公开 PDF 返回了无效的 Content-Length');

  let expectedBytes = declared.value;
  let bodyLimit = MAX_DECLARED_PDF_BYTES;
  if (upstream.status === 206) {
    if (!range) return rejectUpstream(upstream, deadline, 502, '公开来源在未请求 Range 时返回了局部正文');
    const contentRange = parseContentRange(upstream.headers.get('content-range'));
    if (!contentRange) return rejectUpstream(upstream, deadline, 502, '公开 PDF 的 Content-Range 缺失或无效');
    if (contentRange.total > MAX_DECLARED_PDF_BYTES) {
      return rejectUpstream(upstream, deadline, 413, '公开 PDF 超过 Atlas 全文大小上限');
    }
    if (!matchesRequestedRange(range, contentRange)) {
      return rejectUpstream(upstream, deadline, 502, '公开 PDF 返回的 Content-Range 与请求不匹配');
    }
    expectedBytes = contentRange.end - contentRange.start + 1;
    if (declared.value !== null && declared.value !== expectedBytes) {
      return rejectUpstream(upstream, deadline, 502, '公开 PDF 分段长度与 Content-Range 不一致');
    }
    bodyLimit = expectedBytes;
  } else if (requestedRange) {
    return rejectUpstream(upstream, deadline, 502, '公开全文源忽略了 PDF Range 请求');
  } else if (declared.value !== null && declared.value > MAX_DECLARED_PDF_BYTES) {
    return rejectUpstream(upstream, deadline, 413, '公开 PDF 超过 Atlas 全文大小上限');
  } else if (declared.value !== null) {
    bodyLimit = declared.value;
  }

  const body = createBoundedBody(upstream.body, {
    maxBytes: bodyLimit,
    expectedBytes,
    deadline
  });
  return new Response(body, {
    status: upstream.status,
    headers: responseHeaders(upstream, contentType)
  });
}

async function fetchAllowed(initialURL, headers, signal) {
  let current = initialURL;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    let response;
    try {
      response = await fetch(current, { headers, redirect: 'manual', signal });
    } catch (error) {
      if (hop === 0 && isSpringerSource(initialURL) && !signal.aborted) {
        return retrySpringerSource(initialURL, headers, signal, MAX_SPRINGER_RETRIES);
      }
      throw error;
    }
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (hop === 0 && isSpringerSource(initialURL) && isHTMLResponse(response)) {
        await cancelBody(response);
        return retrySpringerSource(initialURL, headers, signal, MAX_SPRINGER_RETRIES);
      }
      return response;
    }

    const next = await parseRedirect(response, current);
    if (hop === 0 && response.status === 303 && isSpringerSource(initialURL)) {
      if (!isSpringerAuthorize(next, initialURL)) {
        await cancelBody(response);
        throw new Error('Springer 匿名验证地址不符合安全约束');
      }
      await cancelBody(response);
      return fetchSpringerChallenge(initialURL, next, headers, signal, 0);
    }

    if (hop === MAX_REDIRECT_HOPS) {
      await cancelBody(response);
      throw new Error('公开全文源重定向次数过多');
    }
    if (!isAllowedSource(next)) {
      await cancelBody(response);
      throw new Error('公开全文源重定向离开白名单');
    }
    await cancelBody(response);
    current = next;
  }
  throw new Error('公开全文源重定向次数过多');
}

async function fetchSpringerChallenge(originalURL, authorizeURL, pdfHeaders, signal, retryCount) {
  const challengeHeaders = new Headers({
    Accept: 'text/html,application/xhtml+xml',
    'User-Agent': USER_AGENT
  });
  const authorize = await fetch(authorizeURL, { headers: challengeHeaders, redirect: 'manual', signal });
  if (authorize.status !== 302) {
    await cancelBody(authorize);
    throw new Error('Springer /authorize 未返回预期的匿名转接');
  }
  const transitURL = await parseRedirect(authorize, authorizeURL);
  if (!isSpringerTransit(transitURL, originalURL)) {
    await cancelBody(authorize);
    throw new Error('Springer /transit 参数不符合安全约束');
  }
  const code = transitURL.searchParams.get('code');
  await cancelBody(authorize);

  const callbackURL = new URL(originalURL.href);
  callbackURL.searchParams.set('error', 'cookies_not_supported');
  callbackURL.searchParams.set('code', code);

  // /transit 会向无 JS/Cookie 的 Worker 返回 Client Challenge HTML。Atlas 只校验
  // 其 URL 中的原始 redirect_uri 与 UUID，不请求、不解析、不执行该页面。
  const finalResponse = await fetch(callbackURL, { headers: pdfHeaders, redirect: 'manual', signal });
  const finalType = (finalResponse.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (retryCount < MAX_SPRINGER_RETRIES
      && ((finalResponse.status === 200 && finalType === 'text/html') || finalResponse.status === 303)) {
    await cancelBody(finalResponse);
    return retrySpringerSource(originalURL, pdfHeaders, signal, retryCount + 1);
  }
  if (REDIRECT_STATUSES.has(finalResponse.status)) {
    await cancelBody(finalResponse);
    throw new Error('Springer 一次性匿名回调未能返回 PDF');
  }
  return finalResponse;
}

async function retrySpringerSource(originalURL, pdfHeaders, signal, retryCount) {
  const response = await fetch(originalURL, { headers: pdfHeaders, redirect: 'manual', signal });
  if (!REDIRECT_STATUSES.has(response.status)) return response;
  if (response.status !== 303) {
    await cancelBody(response);
    throw new Error('Springer 匿名验证重试返回了非预期重定向');
  }
  const authorizeURL = await parseRedirect(response, originalURL);
  if (!isSpringerAuthorize(authorizeURL, originalURL)) {
    await cancelBody(response);
    throw new Error('Springer 匿名验证重试地址不符合安全约束');
  }
  await cancelBody(response);
  return fetchSpringerChallenge(originalURL, authorizeURL, pdfHeaders, signal, retryCount);
}

async function parseRedirect(response, baseURL) {
  const location = response.headers.get('location');
  if (!location) {
    await cancelBody(response);
    throw new Error('公开全文源重定向缺少目标地址');
  }
  try {
    return new URL(location, baseURL);
  } catch {
    await cancelBody(response);
    throw new Error('公开全文源重定向地址无效');
  }
}

function isAllowedSource(url) {
  if (!isSecureURL(url) || !isAllowedQuery(url)) return false;
  return SOURCE_RULES.some(rule => url.hostname === rule.host && rule.path.test(url.pathname));
}

function isSecureURL(url) {
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash;
}

function isHTMLResponse(response) {
  const type = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  return response.status === 200 && type === 'text/html';
}

function isAllowedQuery(url) {
  if (url.hostname !== 'openreview.net') return url.search === '';
  return hasExactQuery(url, [['id', value => /^[A-Za-z0-9_-]{1,160}$/.test(value)]]);
}

function isSpringerSource(url) {
  return isSecureURL(url) && url.hostname === 'link.springer.com' && url.search === '' && SPRINGER_PDF_PATH.test(url.pathname);
}

function isSpringerAuthorize(url, originalURL) {
  return isSecureURL(url)
    && url.hostname === 'idp.springer.com'
    && url.pathname === '/authorize'
    && hasExactQuery(url, [
      ['response_type', 'cookie'],
      ['client_id', 'springerlink'],
      ['redirect_uri', originalURL.href]
    ]);
}

function isSpringerTransit(url, originalURL) {
  return isSecureURL(url)
    && url.hostname === 'idp.springer.com'
    && url.pathname === '/transit'
    && hasExactQuery(url, [
      ['redirect_uri', originalURL.href],
      ['code', value => UUID_V4.test(value)]
    ]);
}

function hasExactQuery(url, expected) {
  const entries = [...url.searchParams.entries()];
  if (entries.length !== expected.length) return false;
  return expected.every(([key, matcher]) => {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) return false;
    return typeof matcher === 'function' ? matcher(values[0]) : values[0] === matcher;
  });
}

function parseAllowedRange(value) {
  const normalized = value.trim();
  const explicit = /^bytes=(\d+)-(\d+)$/i.exec(normalized);
  if (explicit) {
    const start = Number(explicit[1]);
    const end = Number(explicit[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
    if (end - start + 1 > MAX_RANGE_BYTES) return null;
    return { kind: 'explicit', start, end };
  }
  const suffix = /^bytes=-(\d+)$/i.exec(normalized);
  if (!suffix) return null;
  const length = Number(suffix[1]);
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_RANGE_BYTES) return null;
  return { kind: 'suffix', length };
}

function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(String(value || '').trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || total < 1 || end < start || end >= total) return null;
  if (end - start + 1 > MAX_RANGE_BYTES) return null;
  return { start, end, total };
}

function matchesRequestedRange(requested, returned) {
  const span = returned.end - returned.start + 1;
  if (requested.kind === 'suffix') {
    return returned.end === returned.total - 1
      && returned.start === Math.max(0, returned.total - requested.length)
      && span === Math.min(requested.length, returned.total);
  }
  if (returned.start !== requested.start) return false;
  return returned.end === Math.min(requested.end, returned.total - 1);
}

function parseOptionalLength(value) {
  if (value === null) return { valid: true, value: null };
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return { valid: false, value: null };
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? { valid: true, value: parsed } : { valid: false, value: null };
}

function responseHeaders(upstream, contentType) {
  const headers = new Headers({
    'Content-Type': contentType || 'application/pdf',
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    Vary: 'Range'
  });
  for (const name of ['Accept-Ranges', 'Content-Range', 'Content-Length', 'ETag', 'Last-Modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function createDeadline(timeoutMs) {
  const controller = new AbortController();
  let timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() {
      if (timeoutId === null) return;
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}

function createBoundedBody(body, { maxBytes, expectedBytes, deadline }) {
  const reader = body.getReader();
  let seen = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    deadline.clear();
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          if (expectedBytes !== null && seen !== expectedBytes) {
            throw new Error('公开 PDF 正文长度与声明不一致');
          }
          finish();
          controller.close();
          return;
        }
        const chunkBytes = result.value?.byteLength;
        if (!Number.isSafeInteger(chunkBytes) || seen + chunkBytes > maxBytes) {
          throw new Error('公开 PDF 正文超过 Atlas 流式读取上限');
        }
        seen += chunkBytes;
        controller.enqueue(result.value);
      } catch (error) {
        try { await reader.cancel(error); } catch { /* 上游可能已因超时中断。 */ }
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } catch { /* 读取器可能已经关闭。 */ }
      finish();
    }
  });
}

async function rejectUpstream(upstream, deadline, status, message) {
  await cancelBody(upstream);
  deadline.clear();
  return failure(status, message);
}

async function cancelBody(response) {
  try { await response.body?.cancel(); } catch { /* 忽略已关闭或已中断的上游正文。 */ }
}

function failure(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
