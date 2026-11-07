import type { SearchResult } from './types';

export function isM3u8SourceUrl(input: string): boolean {
  try {
    let url = new URL(input);
    for (let depth = 0; depth < 3; depth++) {
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      if (/\.m3u8$/i.test(url.pathname)) return true;
      if (!['/api/proxy-m3u8', '/api/proxy/vod/m3u8'].includes(url.pathname))
        return false;
      const original = url.searchParams.get('url');
      if (!original) return false;
      url = new URL(original);
    }
  } catch {
    return false;
  }
  return false;
}

type PlayLine = { name: string; urls: string[]; titles: string[] };

/** Project a response from full source data without changing the stored/cache copy. */
export function filterM3u8SourceResult<T extends SearchResult>(
  result: T,
  enabled: boolean
): T | null {
  if (!enabled) return result;
  const stored = (result as T & { catalog_play_lines?: PlayLine[] })
    .catalog_play_lines;
  const lines = (
    stored?.length
      ? stored
      : [
          {
            name: '默认',
            urls: result.episodes || [],
            titles: result.episodes_titles || [],
          },
        ]
  )
    .map((line) => {
      const indices = line.urls
        .map((_, index) => index)
        .filter((index) => isM3u8SourceUrl(line.urls[index]));
      return {
        ...line,
        urls: indices.map((index) => line.urls[index]),
        titles: indices.map(
          (index) => line.titles[index] || `第${index + 1}集`
        ),
      };
    })
    .filter((line) => line.urls.length);
  const preferred = [...lines].sort((a, b) => b.urls.length - a.urls.length)[0];
  if (!preferred) return null;
  return {
    ...result,
    episodes: preferred.urls,
    episodes_titles: preferred.titles,
    catalog_play_lines: lines,
  };
}

export function filterM3u8SourceResults<T extends SearchResult>(
  results: T[],
  enabled: boolean
): T[] {
  if (!enabled) return results;
  return results.flatMap((result) => {
    const selected = filterM3u8SourceResult(result, true);
    return selected ? [selected] : [];
  });
}
