/** @jest-environment node */

import { filterAdsFromM3U8 } from './hls-ad-filter';

const playlist = (...lines: string[]) =>
  ['#EXTM3U', '#EXT-X-TARGETDURATION:10', ...lines, '#EXT-X-ENDLIST'].join(
    '\n'
  );
const segment = (url: string, duration = 6) => `#EXTINF:${duration},\n${url}`;
const urls = (content: string) =>
  content.split('\n').filter((line) => line && !line.startsWith('#'));

test('removes the numeric CUE-marked ad segments seen in the iqiyi source', () => {
  const input = playlist(
    segment('index37BcfDBFd885Aa97.png'),
    '#EXT-X-DISCONTINUITY',
    '#EXT-X-CUE-OUT:DURATION=17.578',
    segment('/stream/6ac896453dacd7dfa9a23d3d/index0.ts', 5.859),
    segment('/stream/6ac896453dacd7dfa9a23d3d/index1.ts', 5.859),
    segment('/stream/6ac896453dacd7dfa9a23d3d/index2.ts', 5.86),
    '#EXT-X-CUE-IN',
    '#EXT-X-DISCONTINUITY',
    segment('indexA892E0cC65c0Aa57.png')
  );
  const result = filterAdsFromM3U8('iqiyizyapi.com', input);
  expect(urls(result)).toEqual([
    'index37BcfDBFd885Aa97.png',
    'indexA892E0cC65c0Aa57.png',
  ]);
  expect(result.match(/#EXTINF:/g)).toHaveLength(2);
  expect(result).not.toContain('#EXT-X-CUE-');
  expect(result).toContain('#EXT-X-DISCONTINUITY');
  expect(result).toContain('#EXT-X-ENDLIST');
});

test.each([
  '#EXT-X-CUE-OUT',
  '#EXT-X-CUE-OUT:12',
  '#EXT-X-CUE-OUT:DURATION=12',
])('handles a bounded %s range', (marker) => {
  const result = filterAdsFromM3U8(
    '',
    playlist(
      segment('main0.ts'),
      marker,
      segment('0001.ts'),
      segment('0002.ts'),
      '#EXT-X-CUE-IN',
      segment('main1.ts')
    )
  );
  expect(urls(result)).toEqual(['main0.ts', 'main1.ts']);
});

test.each([
  '#EXT-X-CUE-OUT:6',
  '#EXT-X-CUE-OUT-CONT:ElapsedTime=6,Duration=12',
  '#EXT-X-CUE-OUT-CONT:6/12',
])(
  'uses the remaining duration when a live playlist has no CUE-IN: %s',
  (marker) => {
    expect(
      urls(
        filterAdsFromM3U8(
          '',
          playlist(marker, segment('0001.ts'), segment('main.ts'))
        )
      )
    ).toEqual(['main.ts']);
  }
);

test('keeps unbounded malformed cues and ordinary discontinuities including their sequence', () => {
  const input = playlist(
    '#EXT-X-DISCONTINUITY-SEQUENCE:4',
    '#EXT-X-CUE-OUT',
    segment('main0.ts'),
    '#EXT-X-DISCONTINUITY',
    segment('main1.ts')
  );
  expect(filterAdsFromM3U8('', input)).toBe(input);
});

test('finds ad URLs after intervening segment tags and removes their metadata', () => {
  const input = playlist(
    segment('main0.ts'),
    '#EXT-X-PROGRAM-DATE-TIME:2026-11-06T00:00:00Z',
    '#EXTINF:6,',
    '#EXT-X-BYTERANGE:10@0',
    '',
    'ads/0001.ts',
    segment('main1.ts')
  );
  const result = filterAdsFromM3U8('', input.replace(/\n/g, '\r\n'));
  expect(urls(result)).toEqual(['main0.ts', 'main1.ts']);
  expect(result).not.toContain('#EXT-X-BYTERANGE');
  expect(result).not.toContain('#EXT-X-PROGRAM-DATE-TIME');
});

test('pins the original implicit AES-128 IV after a segment is removed', () => {
  const input = playlist(
    '#EXT-X-MEDIA-SEQUENCE:100',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    segment('main0.ts'),
    segment('/ads/0.ts'),
    segment('main1.ts'),
    segment('main2.ts')
  );
  const result = filterAdsFromM3U8('', input);
  expect(result).toContain('IV=0x00000000000000000000000000000066\nmain1.ts');
  expect(result).toContain('IV=0x00000000000000000000000000000067\nmain2.ts');
});

test('preserves implicit byte offsets when a removed ad uses the same media file', () => {
  const input = playlist(
    '#EXTINF:6,',
    '#EXT-X-BYTERANGE:100@0',
    'all.ts',
    '#EXT-X-CUE-OUT:6',
    '#EXTINF:6,',
    '#EXT-X-BYTERANGE:50',
    'all.ts',
    '#EXT-X-CUE-IN',
    '#EXTINF:6,',
    '#EXT-X-BYTERANGE:100',
    'all.ts'
  );
  const result = filterAdsFromM3U8('', input);
  expect(result).toContain('#EXT-X-BYTERANGE:100@150\nall.ts');
  expect(result).not.toContain('#EXT-X-BYTERANGE:50');
});

test('keeps master playlists and playlists that would become empty', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlevel.m3u8';
  expect(filterAdsFromM3U8('', master)).toBe(master);
  const input = playlist(segment('/ads/only.ts'));
  expect(filterAdsFromM3U8('', input)).toBe(input);
});

test('signature/query values containing ad words do not remove ordinary media', () => {
  const input = playlist(
    segment('main0.ts?signature=advertisement'),
    segment('main1.ts?path=/ads/id')
  );
  expect(filterAdsFromM3U8('', input)).toBe(input);
});

test('passes the source to custom rules and falls back when their result is invalid', () => {
  const input = playlist(segment('main.ts'));
  expect(
    filterAdsFromM3U8(
      'cms-key',
      input,
      'function filterAdsFromM3U8(type: string, m3u8Content: string): string { return type + m3u8Content; }'
    )
  ).toBe('cms-key' + input);
  const error = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);
  try {
    expect(
      filterAdsFromM3U8('', input, 'function filterAdsFromM3U8() {}')
    ).toBe(input);
  } finally {
    error.mockRestore();
  }
});
