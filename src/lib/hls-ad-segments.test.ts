/** @jest-environment node */

import {
  hlsMediaGroups,
  hlsSegmentIdentity,
  unmarkedAdSegments,
} from './hls-ad-segments';

const counts = [5, 5, 5, 5, 5, 5, 5, 5, 10, 5, 5, 5, 9, 2, 3, 3];
const durations = [
  21.934, 18.734, 20.2, 19.333, 20.967, 19.3, 19.934, 20.5, 39.368, 21.167,
  20.366, 18.633, 36.798, 8.5, 10.566, 10.634,
];
const starts = [
  1.466667, 23.4, 42.133333, 62.333333, 81.666667, 102.633333, 121.933333,
  141.866667, 162.366667, 201.733333, 222.9, 243.266667, 261.9, 1.466667,
  9.966667, 298.7,
];
const manifest = (host = '') =>
  [
    '#EXTM3U',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    ...counts.flatMap((count, group) => [
      '#EXT-X-DISCONTINUITY',
      ...Array.from(
        { length: count },
        (_, segment) =>
          `#EXTINF:${
            durations[group] / count
          },\n${host}segment-${group}-${segment}.png?sig=keep`
      ),
    ]),
    '#EXT-X-ENDLIST',
  ].join('\n');
const streams = starts.map((pts, group) => ({
  pts,
  codec: group === 13 || group === 14 ? 'avc:alternate-sps' : 'avc:main-sps',
}));

test.each([
  '',
  'https://media.example/movie/',
  'https://different.example/opaque/',
])(
  'identifies only a bounded five-segment insert independently of source and filename: %s',
  (host) => {
    const groups = hlsMediaGroups(manifest(host));
    expect(groups).toHaveLength(16);
    expect(Array.from(unmarkedAdSegments(groups, streams))).toEqual([
      74, 75, 76, 77, 78,
    ]);
  }
);

test('keeps legitimate discontinuities, codec changes, incomplete evidence and unmatched resets', () => {
  const groups = hlsMediaGroups(manifest());
  expect(
    unmarkedAdSegments(
      groups,
      streams.map((stream) => ({ ...stream, codec: 'avc:same-sps' }))
    )
  ).toHaveProperty('size', 0);
  expect(
    unmarkedAdSegments(
      groups,
      streams.map((stream, i) => (i === 14 ? null : stream))
    )
  ).toHaveProperty('size', 0);
  expect(
    unmarkedAdSegments(
      groups,
      streams.map((stream, i) => (i === 15 ? { ...stream, pts: 500 } : stream))
    )
  ).toHaveProperty('size', 0);
  expect(
    unmarkedAdSegments(
      groups,
      streams.map((stream, i) => ({ ...stream, pts: i * 20 }))
    )
  ).toHaveProperty('size', 0);
});

test('supports a three-block insert after an established long main segment group', () => {
  const content = [
    '#EXTM3U',
    '#EXTINF:20,',
    'main0.ts',
    '#EXTINF:20,',
    'main1.ts',
    '#EXTINF:20,',
    'main2.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:5,',
    'insert0.ts',
    '#EXTINF:5,',
    'insert1.ts',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:10,',
    'main3.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
  const groups = hlsMediaGroups(content);
  expect(
    Array.from(
      unmarkedAdSegments(groups, [
        { pts: 1.4, codec: 'main' },
        { pts: 1.4, codec: 'insert' },
        { pts: 61.4, codec: 'main' },
      ])
    )
  ).toEqual([3, 4]);
});

test.each([
  (text: string) => text.replace('#EXT-X-ENDLIST', ''),
  (text: string) =>
    text.replace('#EXTM3U', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"'),
  (text: string) =>
    text.replace('#EXTM3U', '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"'),
  (text: string) => text.replace('#EXTM3U', '#EXTM3U\n#EXT-X-BYTERANGE:100@0'),
])(
  'does not inspect live, encrypted, fMP4 or byte-range media',
  (transform) => {
    expect(hlsMediaGroups(transform(manifest()))).toEqual([]);
  }
);

function tsPrefix(pts: number, level = 40, adapted = false) {
  const packet = new Uint8Array(adapted ? 376 : 188).fill(255);
  const offset = adapted ? 156 : 4;
  packet.set([0x47, 0x41, 0, adapted ? 0x30 : 0x10]);
  if (adapted) {
    packet[4] = 151;
    packet.fill(0, 5, offset);
    packet.set([0x47, 1, 0, 0x10], 188);
  }
  const ticks = Math.round(pts * 90000);
  const payload = [
    0,
    0,
    1,
    0xe0,
    0,
    0,
    0x80,
    0x80,
    5,
    0x21 | ((Math.floor(ticks / 1073741824) & 7) << 1),
    Math.floor(ticks / 4194304) & 255,
    ((Math.floor(ticks / 32768) & 127) << 1) | 1,
    Math.floor(ticks / 128) & 255,
    ((ticks & 127) << 1) | 1,
    0,
    0,
    0,
    1,
    0x67,
    100,
    0,
    level,
    0xaa,
    0xbb,
    0xcc,
    0xdd,
    0xee,
    0xff,
    0x80,
    0,
    0,
    0,
    1,
    0x68,
    0xff,
    0x80,
  ];
  const first = payload.slice(0, 188 - offset);
  packet.set(first, offset);
  if (adapted) packet.set(payload.slice(first.length), 192);
  return packet;
}

test('reads the full video SPS and 33-bit PTS across transport-packet boundaries', () => {
  const ordinary = hlsSegmentIdentity(tsPrefix(298.7));
  expect(ordinary?.pts).toBeCloseTo(298.7, 4);
  expect(hlsSegmentIdentity(tsPrefix(298.7, 40, true))).toEqual(ordinary);
  expect(hlsSegmentIdentity(tsPrefix(90000))?.pts).toBeCloseTo(90000, 4);
  expect(hlsSegmentIdentity(tsPrefix(1.4, 50))?.codec).not.toBe(
    ordinary?.codec
  );
  expect(hlsSegmentIdentity(new Uint8Array(188))).toBeNull();
  expect(hlsSegmentIdentity(tsPrefix(1.4).subarray(0, 30))).toBeNull();
});
