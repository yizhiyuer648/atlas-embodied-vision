import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/pdf.js';

const endpoint = 'https://atlas-embodied-vision.pages.dev/api/pdf';
const arxivPDF = 'https://arxiv.org/pdf/2103.00020';
const originalFetch = globalThis.fetch;

function requestFor(source, range = '') {
  const url = new URL(endpoint);
  url.searchParams.set('url', source);
  const headers = range ? { Range: range } : {};
  return new Request(url, { headers });
}

async function invoke(source, { range = '', fetchImpl } = {}) {
  globalThis.fetch = fetchImpl || (async () => { throw new Error('unexpected upstream fetch'); });
  return onRequestGet({ request: requestFor(source, range) });
}

try {
  assert.equal((await invoke('https://example.com/paper.pdf')).status, 403);
  assert.equal((await invoke('https://arxiv.org/pdf/2103.00020?next=https://example.com')).status, 403);
  assert.equal((await invoke(arxivPDF, { range: 'bytes=0-1,4-5' })).status, 416);
  assert.equal((await invoke(arxivPDF, { range: 'bytes=0-20000000' })).status, 416);

  const ranged = await invoke(arxivPDF, {
    range: 'bytes=0-1023',
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.get('Range'), 'bytes=0-1023');
      return new Response(new Uint8Array(1024), {
        status: 206,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': '1024',
          'Content-Range': 'bytes 0-1023/4096',
          'Accept-Ranges': 'bytes'
        }
      });
    }
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('Content-Range'), 'bytes 0-1023/4096');
  assert.equal(ranged.headers.get('X-Content-Type-Options'), 'nosniff');

  const redirectEscape = await invoke(arxivPDF, {
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'https://example.com/paper.pdf' } })
  });
  assert.equal(redirectEscape.status, 502);

  const wrongType = await invoke(arxivPDF, {
    fetchImpl: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } })
  });
  assert.equal(wrongType.status, 502);

  const tooLarge = await invoke(arxivPDF, {
    fetchImpl: async () => new Response(null, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(129 * 1024 * 1024) } })
  });
  assert.equal(tooLarge.status, 413);

  const openReview = await invoke('https://openreview.net/pdf?id=abc_DEF-123', {
    fetchImpl: async () => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Type': 'application/pdf' } })
  });
  assert.equal(openReview.status, 200);

  console.log('Cloudflare PDF Function policy tests: PASS');
} finally {
  globalThis.fetch = originalFetch;
}
