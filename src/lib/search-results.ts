import type { SearchResult } from '@/lib/types';

// 同源影片原位更新，新源/新影片追加，保留先返回结果的位置。
export function mergeSearchResults(
  current: SearchResult[],
  incoming: SearchResult[]
): SearchResult[] {
  const results = new Map<string, SearchResult>();
  for (const item of [...current, ...incoming]) {
    results.set(JSON.stringify([item.source, item.id]), item);
  }
  return Array.from(results.values());
}
