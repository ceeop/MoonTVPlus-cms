export function buildTVBoxSubscribeUrl(
  origin: string,
  token: string,
  options: {
    adFilter?: boolean;
    yellowFilter?: boolean;
    cloudFilter?: boolean;
  } = {}
) {
  const url = new URL('/api/tvbox/subscribe', origin);
  url.searchParams.set('token', token);
  url.searchParams.set('cloudFilter', String(options.cloudFilter !== false));
  if (options.adFilter) url.searchParams.set('adFilter', 'true');
  if (options.yellowFilter) url.searchParams.set('yellowFilter', 'true');
  return url.toString();
}
