/** @jest-environment node */

import { ReadableStream } from 'stream/web';

import { downloadCatalogPoster, MAX_POSTER_BYTES } from './posters';

const originalFetch = global.fetch;
function imageResponse(
  body: string | Buffer,
  headers: Record<string, string> = {}
) {
  return {
    ok: true,
    headers: { get: (name: string) => headers[name] || null },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from(body));
        controller.close();
      },
    }),
  } as unknown as Response;
}
afterEach(() => {
  global.fetch = originalFetch;
});

test('downloads a raster image and stores its bytes with a verified content type', async () => {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
  );
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      imageResponse(bytes, { 'content-type': 'application/octet-stream' })
    );
  expect(await downloadCatalogPoster('https://img.invalid/1')).toEqual({
    contentType: 'image/png',
    data: bytes.toString('base64'),
  });
});

test('normalizes escaped query strings and sends the image host a suitable referer', async () => {
  global.fetch = jest
    .fn()
    .mockImplementation(async () => imageResponse('invalid'));
  await downloadCatalogPoster(
    'https://img9.doubanio.com/poster.webp?a=1&amp;amp;b=2'
  );
  expect(global.fetch).toHaveBeenCalledWith(
    'https://img9.doubanio.com/poster.webp?a=1&b=2',
    expect.objectContaining({
      headers: expect.objectContaining({
        Referer: 'https://movie.douban.com/',
      }),
    })
  );
  await downloadCatalogPoster('//images.example.org/poster.jpg');
  expect(global.fetch).toHaveBeenLastCalledWith(
    'https://images.example.org/poster.jpg',
    expect.objectContaining({
      headers: expect.objectContaining({
        Referer: 'https://images.example.org/',
      }),
    })
  );
});

test.each([
  '<html>Access denied</html>',
  '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
])(
  'rejects non-raster content even when the server labels it an image',
  async (body) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(imageResponse(body, { 'content-type': 'image/png' }));
    expect(await downloadCatalogPoster('https://img.invalid/1')).toBeNull();
  }
);

test('rejects oversized bodies with and without a content-length header', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(imageResponse(Buffer.alloc(MAX_POSTER_BYTES + 1)));
  expect(await downloadCatalogPoster('https://img.invalid/1')).toBeNull();
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      imageResponse('small', { 'content-length': String(MAX_POSTER_BYTES + 1) })
    );
  expect(await downloadCatalogPoster('https://img.invalid/1')).toBeNull();
});

test('rejects local paths and unsupported protocols without making a request', async () => {
  global.fetch = jest.fn();
  for (const url of [
    'file:///etc/passwd',
    '/etc/passwd',
    'data:image/png;base64,abc',
  ])
    expect(await downloadCatalogPoster(url)).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});
