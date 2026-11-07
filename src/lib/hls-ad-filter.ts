const AD_KEYWORDS = [
  'sponsor',
  '/ad/',
  '/ads/',
  'advert',
  'advertisement',
  '/adjump',
  'redtraffic',
];

const CUE_OUT = /^#EXT-X-CUE-OUT(?::|$)/;
const CUE_IN = /^#EXT-X-CUE-IN(?::|$)/;
const SEGMENT_TAG = /^#EXT(?:INF:|-X-(?:BYTERANGE:|PROGRAM-DATE-TIME:|GAP$))/;

function matchesAdUrl(value: string) {
  try {
    const url = new URL(value, 'https://hls.invalid/');
    const path = (url.hostname + url.pathname).toLowerCase();
    return AD_KEYWORDS.some((word) => path.includes(word));
  } catch {
    return false;
  }
}

export function compileCustomAdFilter(
  code: string
): (type: string, content: string) => unknown {
  const jsCode = code
    .replace(
      /(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*([,)])/g,
      '$1$3'
    )
    .replace(
      /\)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*\{/g,
      ') {'
    )
    .replace(
      /(const|let|var)\s+(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*=/g,
      '$1 $2 ='
    );
  return new Function(
    'type',
    'm3u8Content',
    jsCode + '\nreturn filterAdsFromM3U8(type, m3u8Content);'
  ) as (type: string, content: string) => unknown;
}

/** Shared by browser HLS loaders and the TVBox playlist proxy. */
export function filterAdsFromM3U8(
  type: string,
  m3u8Content: string,
  customCode?: string,
  excludedSegments?: ReadonlySet<number>
): string {
  if (customCode?.trim()) {
    try {
      const result = compileCustomAdFilter(customCode)(type, m3u8Content);
      if (typeof result === 'string') return result;
      throw new Error('去广告函数必须返回字符串');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('执行自定义去广告代码失败，使用默认规则:', error);
    }
  }

  if (!m3u8Content) return '';
  const lines = m3u8Content.split(/\r?\n/);
  const removed = new Set<number>();
  const nextCueIn: number[] = [];
  let cueIn = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (CUE_IN.test(lines[i].trim())) cueIn = i;
    nextCueIn[i] = cueIn;
  }

  let breakEnd = -1;
  let remaining = 0;
  let segmentStart = 0;
  let duration: number | null = null;
  let segmentCount = 0;
  let keptCount = 0;
  let key = '';
  const sequence = BigInt(
    m3u8Content.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/m)?.[1] || '0'
  );
  const explicitKeys = new Map<number, string>();
  const explicitRanges = new Map<number, string>();
  let byteRangeLine = -1;
  let previousRangeUrl = '';
  let rangeEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (CUE_OUT.test(line)) {
      breakEnd = nextCueIn[i];
      const value = line.slice(line.indexOf(':') + 1);
      remaining =
        Number(value.match(/(?:^|[,\s])DURATION=([\d.]+)/i)?.[1] || value) || 0;
    } else if (line.startsWith('#EXT-X-CUE-OUT-CONT:')) {
      // A sliding live playlist may start in the middle of an ad break.
      breakEnd = nextCueIn[i];
      const value = line.slice('#EXT-X-CUE-OUT-CONT:'.length);
      const progress = value.match(/^([\d.]+)\/([\d.]+)/);
      const elapsed = Number(
        value.match(/ElapsedTime=([\d.]+)/i)?.[1] || progress?.[1]
      );
      const total = Number(
        value.match(/Duration=([\d.]+)/i)?.[1] || progress?.[2]
      );
      remaining = Math.max(0, total - elapsed) || 0;
    } else if (CUE_IN.test(line)) {
      breakEnd = -1;
      remaining = 0;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      key = line;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      byteRangeLine = i;
    } else if (line.startsWith('#EXTINF:')) {
      duration = parseFloat(line.slice('#EXTINF:'.length)) || 0;
    } else if (line && !line.startsWith('#') && duration !== null) {
      const isAd =
        excludedSegments?.has(segmentCount) ||
        breakEnd > i ||
        remaining > 0.001 ||
        matchesAdUrl(line);
      const range = lines[byteRangeLine]
        ?.trim()
        .match(/^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?$/);
      if (range) {
        const offset = range[2] ? Number(range[2]) : rangeEnd;
        if (
          !isAd &&
          segmentCount !== keptCount &&
          !range[2] &&
          previousRangeUrl === line
        ) {
          explicitRanges.set(
            byteRangeLine,
            `#EXT-X-BYTERANGE:${range[1]}@${offset}`
          );
        }
        rangeEnd = offset + Number(range[1]);
        previousRangeUrl = line;
      } else {
        previousRangeUrl = '';
      }
      if (isAd) {
        removed.add(i);
        for (let j = segmentStart; j < i; j++) {
          if (SEGMENT_TAG.test(lines[j].trim())) removed.add(j);
        }
      } else {
        // AES-128 without an explicit IV uses the original media sequence.
        // Removing a segment changes that sequence at the player, so pin the IV.
        if (
          segmentCount !== keptCount &&
          /(?:[:,])METHOD=AES-128(?:,|$)/.test(key) &&
          !/(?:[:,])IV=/.test(key)
        ) {
          const iv = (sequence + BigInt(segmentCount))
            .toString(16)
            .padStart(32, '0');
          explicitKeys.set(i, `${key},IV=0x${iv}`);
        }
        keptCount++;
      }
      segmentCount++;
      remaining = Math.max(0, remaining - duration);
      duration = null;
      byteRangeLine = -1;
      segmentStart = i + 1;
    }
  }

  // Keep a playable playlist if a malformed marker/keyword matched everything.
  if (!removed.size || !keptCount) return m3u8Content;
  return lines
    .flatMap((line, i) => {
      if (
        removed.has(i) ||
        /^#EXT-X-CUE-(?:OUT(?:-CONT)?|IN)(?::|$)/.test(line.trim())
      )
        return [];
      const explicitKey = explicitKeys.get(i);
      const resolvedLine = explicitRanges.get(i) || line;
      return explicitKey ? [explicitKey, resolvedLine] : [resolvedLine];
    })
    .join('\n');
}
