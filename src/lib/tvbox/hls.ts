export const TVBOX_HLS_PATH = '/api/proxy-m3u8/playlist.m3u8';

// Some TVBox parsers treat links containing `url=` or `=http` as web pages.
export function tvboxHlsUrl(origin: string, params: URLSearchParams) {
  const proxy = new URL(TVBOX_HLS_PATH, origin);
  proxy.searchParams.set(
    'id',
    Buffer.from(params.toString()).toString('base64url')
  );
  return proxy.toString();
}

export function tvboxHlsParams(id: string | null) {
  if (!id || id.length > 32768 || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return new URLSearchParams(Buffer.from(id, 'base64url').toString('utf8'));
}
