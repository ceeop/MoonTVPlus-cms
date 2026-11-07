/** @jest-environment node */

import {
  filterM3u8SourceResult,
  filterM3u8SourceResults,
} from './m3u8-source-filter';
import type { SearchResult } from './types';

const result = {
  id: '1',
  title: '电影',
  source: 'cms',
  source_name: 'CMS',
  poster: '',
  year: '2026',
  episodes: ['https://video.test/a.mp4'],
  episodes_titles: ['文件'],
  catalog_play_lines: [
    { name: 'file', urls: ['https://video.test/a.mp4'], titles: ['文件'] },
    { name: 'web', urls: ['https://video.test/share'], titles: ['网页'] },
    {
      name: 'hls',
      urls: [
        'https://video.test/a.M3U8?sign=a%2Bb',
        'https://video.test/b.mp4',
      ],
      titles: ['第四集', '第五集'],
    },
  ],
};

test('global selection chooses the M3U8 alternative and preserves original cached data for disabling', () => {
  const before = JSON.stringify(result);
  const selected = filterM3u8SourceResult(result, true);
  expect(selected?.episodes).toEqual(['https://video.test/a.M3U8?sign=a%2Bb']);
  expect(selected?.episodes_titles).toEqual(['第四集']);
  expect(selected?.catalog_play_lines.map((line) => line.name)).toEqual([
    'hls',
  ]);
  expect(JSON.stringify(result)).toBe(before);
  expect(filterM3u8SourceResult(result, false)).toBe(result);
});

test('global search omits sources with no recognized M3U8 line', () => {
  const fileOnly = { ...result, id: '2', catalog_play_lines: [] };
  expect(filterM3u8SourceResult(fileOnly, true)).toBeNull();
  expect(
    filterM3u8SourceResults([result, fileOnly] as SearchResult[], true).map(
      (item) => item.id
    )
  ).toEqual(['1']);
});
