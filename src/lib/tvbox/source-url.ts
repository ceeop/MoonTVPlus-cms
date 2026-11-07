export const BUILTIN_TVBOX_SOURCES = 'builtin';

export function tvboxSourceUrl(
  origin: string,
  token: string,
  subscription: string,
  key: string,
  filters: { adFilter: boolean; yellowFilter: boolean; cloudFilter?: boolean }
) {
  const path = [token, subscription, key].map(encodeURIComponent).join('/');
  const url = new URL(`/api/tvbox/source/${path}`, origin);
  url.searchParams.set('adFilter', String(filters.adFilter));
  url.searchParams.set('yellowFilter', String(filters.yellowFilter));
  if (filters.cloudFilter !== undefined) {
    url.searchParams.set('cloudFilter', String(filters.cloudFilter));
  }
  return url.toString();
}
