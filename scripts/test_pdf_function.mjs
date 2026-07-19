import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onRequestGet } from '../functions/api/pdf.js';

const endpoint = 'https://atlas-embodied-vision.pages.dev/api/pdf';
const arxivPDF = 'https://arxiv.org/pdf/2103.00020';
const springerPDF = 'https://link.springer.com/content/pdf/10.1007/s11263-026-02918-9.pdf';
const pdfBytes = new TextEncoder().encode('%PDF-1.7\n');
const originalFetch = globalThis.fetch;

function requestFor(source, range = '', extraHeaders = {}) {
  const url = new URL(endpoint);
  url.searchParams.set('url', source);
  const headers = new Headers(extraHeaders);
  if (range) headers.set('Range', range);
  return new Request(url, { headers });
}

async function invoke(source, { range = '', headers = {}, fetchImpl } = {}) {
  globalThis.fetch = fetchImpl || (async () => { throw new Error('unexpected upstream fetch'); });
  return onRequestGet({ request: requestFor(source, range, headers) });
}

function pdfResponse({ status = 200, body = pdfBytes, headers = {} } = {}) {
  const responseHeaders = new Headers({ 'Content-Type': 'application/pdf', ...headers });
  if (!responseHeaders.has('Content-Length') && body !== null) responseHeaders.set('Content-Length', String(body.byteLength));
  return new Response(body, { status, headers: responseHeaders });
}

function redirectResponse(status, location, body = null) {
  return new Response(body, { status, headers: { Location: location } });
}

async function readBytes(response) {
  return new Uint8Array(await response.arrayBuffer());
}

async function expectRejectedSource(source) {
  const response = await invoke(source);
  assert.equal(response.status, 403, source);
}

async function expectInvalidRange(range) {
  const response = await invoke(arxivPDF, { range });
  assert.equal(response.status, 416, range);
}

try {
  await expectRejectedSource('https://example.com/paper.pdf');
  await expectRejectedSource('http://arxiv.org/pdf/2103.00020');
  await expectRejectedSource('https://user@arxiv.org/pdf/2103.00020');
  await expectRejectedSource('https://arxiv.org:444/pdf/2103.00020');
  await expectRejectedSource('https://arxiv.org.evil.example/pdf/2103.00020');
  await expectRejectedSource('https://arxiv.org/pdf/2103.00020?next=https://example.com');
  await expectRejectedSource('https://link.springer.com/content/pdf/10.1007/978-3-031-00000-0.pdf');
  await expectRejectedSource(`${springerPDF}?error=cookies_not_supported&code=00000000-0000-4000-8000-000000000000`);
  await expectRejectedSource('https://idp.springer.com/authorize?response_type=cookie');

  for (const range of [
    'bytes=0-', 'bytes=1-', 'bytes=-0', 'bytes=0-1,4-5',
    'bytes=0-16777216', 'bytes=-16777217', 'bytes=5-4'
  ]) await expectInvalidRange(range);

  for (const [range, contentRange] of [
    ['bytes=0-16777215', 'bytes 0-0/1'],
    ['bytes=-16777216', 'bytes 0-0/1']
  ]) {
    const boundary = await invoke(arxivPDF, {
      range,
      fetchImpl: async () => pdfResponse({
        status: 206,
        body: new Uint8Array([37]),
        headers: { 'Content-Range': contentRange, 'Accept-Ranges': 'bytes' }
      })
    });
    assert.equal(boundary.status, 206, range);
    assert.equal((await readBytes(boundary)).byteLength, 1, range);
  }

  const ranged = await invoke(arxivPDF, {
    range: 'bytes=0-1023',
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.get('Range'), 'bytes=0-1023');
      return pdfResponse({
        status: 206,
        body: new Uint8Array(1024),
        headers: {
          'Content-Range': 'bytes 0-1023/4096',
          'Accept-Ranges': 'bytes'
        }
      });
    }
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('Content-Range'), 'bytes 0-1023/4096');
  assert.equal(ranged.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(ranged.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await readBytes(ranged)).byteLength, 1024);

  let escapedRedirectCanceled = false;
  const redirectEscape = await invoke(arxivPDF, {
    fetchImpl: async () => redirectResponse(302, 'https://169.254.169.254/latest/meta-data/', new ReadableStream({
      cancel() { escapedRedirectCanceled = true; }
    }))
  });
  assert.equal(redirectEscape.status, 502);
  assert.equal(escapedRedirectCanceled, true);

  const wrongType = await invoke(arxivPDF, {
    fetchImpl: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })
  });
  assert.equal(wrongType.status, 502);

  const tooLarge = await invoke(arxivPDF, {
    fetchImpl: async () => pdfResponse({
      body: new Uint8Array([37]),
      headers: { 'Content-Length': String(128 * 1024 * 1024 + 1) }
    })
  });
  assert.equal(tooLarge.status, 413);

  for (const [label, upstream] of [
    ['missing Content-Range', pdfResponse({ status: 206, body: new Uint8Array(1024) })],
    ['mismatched Content-Range', pdfResponse({
      status: 206,
      body: new Uint8Array(1024),
      headers: { 'Content-Range': 'bytes 1-1024/4096' }
    })],
    ['oversized total', pdfResponse({
      status: 206,
      body: new Uint8Array(1024),
      headers: { 'Content-Range': `bytes 0-1023/${128 * 1024 * 1024 + 1}` }
    })]
  ]) {
    const response = await invoke(arxivPDF, {
      range: 'bytes=0-1023',
      fetchImpl: async () => upstream
    });
    assert.equal(response.status, label === 'oversized total' ? 413 : 502, label);
  }

  const ignoredRange = await invoke(arxivPDF, {
    range: 'bytes=0-1023',
    fetchImpl: async () => pdfResponse({ body: new Uint8Array(1024) })
  });
  assert.equal(ignoredRange.status, 502);

  const overlongBody = await invoke(arxivPDF, {
    range: 'bytes=0-3',
    fetchImpl: async () => pdfResponse({
      status: 206,
      body: new Uint8Array(5),
      headers: { 'Content-Range': 'bytes 0-3/10', 'Content-Length': '4' }
    })
  });
  assert.equal(overlongBody.status, 206);
  await assert.rejects(() => overlongBody.arrayBuffer(), /Atlas 流式读取上限/);

  const uuid = '20dc58e4-26b7-4e33-ab50-c93928f34a6e';
  const authorizeURL = new URL('https://idp.springer.com/authorize');
  authorizeURL.searchParams.set('response_type', 'cookie');
  authorizeURL.searchParams.set('client_id', 'springerlink');
  authorizeURL.searchParams.set('redirect_uri', springerPDF);
  const transitURL = new URL('https://idp.springer.com/transit');
  transitURL.searchParams.set('redirect_uri', springerPDF);
  transitURL.searchParams.set('code', uuid);
  const callbackURL = new URL(springerPDF);
  callbackURL.searchParams.set('error', 'cookies_not_supported');
  callbackURL.searchParams.set('code', uuid);
  const challengeCalls = [];
  const springer = await invoke(springerPDF, {
    range: 'bytes=0-1023',
    headers: { 'If-None-Match': 'atlas-test-etag' },
    fetchImpl: async (input, options) => {
      const url = String(input);
      challengeCalls.push(url);
      assert.equal(options.redirect, 'manual');
      if (challengeCalls.length === 1) {
        assert.equal(url, springerPDF);
        assert.equal(options.headers.get('Range'), 'bytes=0-1023');
        assert.equal(options.headers.get('If-None-Match'), 'atlas-test-etag');
        return redirectResponse(303, authorizeURL.href);
      }
      if (challengeCalls.length === 2) {
        assert.equal(url, authorizeURL.href);
        assert.equal(options.headers.get('Range'), null);
        assert.equal(options.headers.get('If-None-Match'), null);
        return redirectResponse(302, transitURL.href);
      }
      assert.equal(challengeCalls.length, 3);
      assert.equal(url, callbackURL.href);
      assert.equal(options.headers.get('Range'), 'bytes=0-1023');
      assert.equal(options.headers.get('If-None-Match'), 'atlas-test-etag');
      return pdfResponse({
        status: 206,
        body: new Uint8Array(1024),
        headers: { 'Content-Range': 'bytes 0-1023/3762441', 'Accept-Ranges': 'bytes' }
      });
    }
  });
  assert.equal(springer.status, 206);
  assert.equal((await readBytes(springer)).byteLength, 1024);
  assert.deepEqual(challengeCalls, [springerPDF, authorizeURL.href, callbackURL.href]);

  const retryUUID = 'a3d69fb4-2838-4e35-8eb9-1b01fa5bd0dd';
  const retryTransitURL = new URL('https://idp.springer.com/transit');
  retryTransitURL.searchParams.set('redirect_uri', springerPDF);
  retryTransitURL.searchParams.set('code', retryUUID);
  const retryCallbackURL = new URL(springerPDF);
  retryCallbackURL.searchParams.set('error', 'cookies_not_supported');
  retryCallbackURL.searchParams.set('code', retryUUID);
  const retryExpectedURLs = [
    springerPDF, authorizeURL.href, callbackURL.href,
    springerPDF, authorizeURL.href, retryCallbackURL.href
  ];
  let retryCalls = 0;
  const springerTransientRetry = await invoke(springerPDF, {
    range: 'bytes=0-1023',
    fetchImpl: async input => {
      assert.equal(String(input), retryExpectedURLs[retryCalls]);
      retryCalls += 1;
      if (retryCalls === 1 || retryCalls === 4) return redirectResponse(303, authorizeURL.href);
      if (retryCalls === 2) return redirectResponse(302, transitURL.href);
      if (retryCalls === 3) return new Response('<html>transient challenge</html>', { headers: { 'Content-Type': 'text/html' } });
      if (retryCalls === 5) return redirectResponse(302, retryTransitURL.href);
      return pdfResponse({
        status: 206,
        body: new Uint8Array(1024),
        headers: { 'Content-Range': 'bytes 0-1023/3762441' }
      });
    }
  });
  assert.equal(springerTransientRetry.status, 206);
  assert.equal((await readBytes(springerTransientRetry)).byteLength, 1024);
  assert.equal(retryCalls, 6);

  let entryRetryCalls = 0;
  const springerEntryRetry = await invoke(springerPDF, {
    range: 'bytes=0-1023',
    fetchImpl: async input => {
      entryRetryCalls += 1;
      if (entryRetryCalls === 1) {
        assert.equal(String(input), springerPDF);
        return new Response('<html>temporary entry challenge</html>', { headers: { 'Content-Type': 'text/html' } });
      }
      if (entryRetryCalls === 2) return redirectResponse(303, authorizeURL.href);
      if (entryRetryCalls === 3) return redirectResponse(302, transitURL.href);
      assert.equal(String(input), callbackURL.href);
      return pdfResponse({
        status: 206,
        body: new Uint8Array(1024),
        headers: { 'Content-Range': 'bytes 0-1023/3762441' }
      });
    }
  });
  assert.equal(springerEntryRetry.status, 206);
  assert.equal((await readBytes(springerEntryRetry)).byteLength, 1024);
  assert.equal(entryRetryCalls, 4);

  let networkRetryCalls = 0;
  const springerNetworkRetry = await invoke(springerPDF, {
    range: 'bytes=0-1023',
    fetchImpl: async () => {
      networkRetryCalls += 1;
      if (networkRetryCalls === 1) throw new TypeError('fetch failed');
      if (networkRetryCalls === 2) return redirectResponse(303, authorizeURL.href);
      if (networkRetryCalls === 3) return redirectResponse(302, transitURL.href);
      return pdfResponse({
        status: 206,
        body: new Uint8Array(1024),
        headers: { 'Content-Range': 'bytes 0-1023/3762441' }
      });
    }
  });
  assert.equal(springerNetworkRetry.status, 206);
  assert.equal((await readBytes(springerNetworkRetry)).byteLength, 1024);
  assert.equal(networkRetryCalls, 4);

  let badAuthorizeCalls = 0;
  const badAuthorize = new URL(authorizeURL);
  badAuthorize.searchParams.append('client_id', 'attacker');
  const rejectedAuthorize = await invoke(springerPDF, {
    fetchImpl: async () => {
      badAuthorizeCalls += 1;
      return redirectResponse(303, badAuthorize.href);
    }
  });
  assert.equal(rejectedAuthorize.status, 502);
  assert.equal(badAuthorizeCalls, 1);

  let badTransitCalls = 0;
  const badTransit = new URL(transitURL);
  badTransit.searchParams.set('code', 'not-a-uuid');
  const rejectedTransit = await invoke(springerPDF, {
    fetchImpl: async () => {
      badTransitCalls += 1;
      return badTransitCalls === 1
        ? redirectResponse(303, authorizeURL.href)
        : redirectResponse(302, badTransit.href);
    }
  });
  assert.equal(rejectedTransit.status, 502);
  assert.equal(badTransitCalls, 2);

  let escapedTransitCalls = 0;
  const escapedTransit = new URL(transitURL);
  escapedTransit.searchParams.set('redirect_uri', 'https://169.254.169.254/latest/meta-data/');
  const rejectedTransitEscape = await invoke(springerPDF, {
    fetchImpl: async () => {
      escapedTransitCalls += 1;
      return escapedTransitCalls === 1
        ? redirectResponse(303, authorizeURL.href)
        : redirectResponse(302, escapedTransit.href);
    }
  });
  assert.equal(rejectedTransitEscape.status, 502);
  assert.equal(escapedTransitCalls, 2);

  let escapedCallbackCalls = 0;
  const rejectedCallbackEscape = await invoke(springerPDF, {
    fetchImpl: async () => {
      escapedCallbackCalls += 1;
      if (escapedCallbackCalls === 1) return redirectResponse(303, authorizeURL.href);
      if (escapedCallbackCalls === 2) return redirectResponse(302, transitURL.href);
      return redirectResponse(302, `https://example.com/paper.pdf?error=cookies_not_supported&code=${uuid}`);
    }
  });
  assert.equal(rejectedCallbackEscape.status, 502);
  assert.equal(escapedCallbackCalls, 3);

  const openReview = await invoke('https://openreview.net/pdf?id=abc_DEF-123', {
    fetchImpl: async () => pdfResponse()
  });
  assert.equal(openReview.status, 200);
  assert.deepEqual(await readBytes(openReview), pdfBytes);

  const tracker = JSON.parse(await readFile(new URL('../data/academic_tracker.json', import.meta.url), 'utf8'));
  const trackedOpenURLs = tracker.publication_events
    .filter(event => event.fulltext?.access === 'open' && event.fulltext?.reader_mode === 'source_stream')
    .map(event => event.fulltext.pdf_url);
  assert.ok(trackedOpenURLs.length > 0, 'academic tracker must contain open/source_stream records');
  for (const source of trackedOpenURLs) {
    let calls = 0;
    const response = await invoke(source, {
      fetchImpl: async () => {
        calls += 1;
        return pdfResponse();
      }
    });
    assert.equal(response.status, 200, `tracker URL rejected by Function policy: ${source}`);
    assert.deepEqual(await readBytes(response), pdfBytes, source);
    assert.equal(calls, 1, source);
  }

  console.log(`Cloudflare PDF Function policy tests: PASS (${trackedOpenURLs.length} tracked open PDFs)`);
} finally {
  globalThis.fetch = originalFetch;
}
