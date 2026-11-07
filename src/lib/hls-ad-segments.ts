export interface HlsMediaGroup {
  segments: string[];
  duration: number;
  firstSegment: number;
}

export interface HlsSegmentIdentity {
  pts: number;
  codec: string;
}

const MAX_MEDIA_GROUPS = 128;

/** Analyze complete, self-contained TS playlists; other HLS formats retain text rules. */
export function hlsMediaGroups(content: string): HlsMediaGroup[] {
  if (
    !/^#EXTM3U/m.test(content) ||
    !/^#EXT-X-ENDLIST\s*$/m.test(content) ||
    /^#EXT-X-(?:STREAM-INF|MEDIA|MAP|BYTERANGE|PART|SKIP):/m.test(content) ||
    /^#EXT-X-KEY:.*METHOD=(?!NONE(?:,|\s*$))/m.test(content)
  )
    return [];
  const groups: HlsMediaGroup[] = [];
  let group: HlsMediaGroup | undefined;
  let duration: number | undefined;
  let segment = 0;
  for (const original of content.split(/\r?\n/)) {
    const line = original.trim();
    if (line === '#EXT-X-DISCONTINUITY') {
      if (group) groups.push(group);
      group = undefined;
    } else if (line.startsWith('#EXTINF:')) {
      const value = Number(line.slice(8).split(',')[0]);
      if (!Number.isFinite(value) || value <= 0) return [];
      duration = value;
    } else if (line && !line.startsWith('#') && duration !== undefined) {
      if (!group)
        group = {
          segments: [],
          duration: 0,
          firstSegment: segment,
        };
      group.duration += duration;
      group.segments.push(line);
      segment++;
      duration = undefined;
    }
  }
  if (group) groups.push(group);
  return groups.length >= 3 && groups.length <= MAX_MEDIA_GROUPS ? groups : [];
}

function ptsValue(bytes: Uint8Array, offset: number) {
  if (
    !(bytes[offset] & 1) ||
    !(bytes[offset + 2] & 1) ||
    !(bytes[offset + 4] & 1)
  )
    return null;
  return (
    ((bytes[offset] & 14) * 536870912 +
      bytes[offset + 1] * 4194304 +
      (bytes[offset + 2] & 254) * 16384 +
      bytes[offset + 3] * 128 +
      (bytes[offset + 4] >> 1)) /
    90000
  );
}

/** Read video PES timestamps and an entire SPS from an MPEG-TS prefix. */
export function hlsSegmentIdentity(
  bytes: Uint8Array
): HlsSegmentIdentity | null {
  let pid: number | undefined;
  let pts: number | null = null;
  const payload: number[] = [];
  for (let packet = 0; packet + 188 <= bytes.length; packet++) {
    if (
      bytes[packet] !== 0x47 ||
      (packet + 188 < bytes.length && bytes[packet + 188] !== 0x47)
    )
      continue;
    const packetPid = ((bytes[packet + 1] & 31) << 8) | bytes[packet + 2];
    const adaptation = (bytes[packet + 3] >> 4) & 3;
    if (
      !(adaptation & 1) ||
      bytes[packet + 1] & 0x80 ||
      bytes[packet + 3] & 0xc0
    ) {
      packet += 187;
      continue;
    }
    let offset = packet + 4 + (adaptation & 2 ? bytes[packet + 4] + 1 : 0);
    const end = packet + 188;
    if (bytes[packet + 1] & 0x40) {
      if (
        offset + 14 > end ||
        bytes[offset] !== 0 ||
        bytes[offset + 1] !== 0 ||
        bytes[offset + 2] !== 1 ||
        bytes[offset + 3] < 0xe0 ||
        bytes[offset + 3] > 0xef ||
        !(bytes[offset + 7] & 0x80)
      ) {
        packet += 187;
        continue;
      }
      if (pid === undefined) {
        pid = packetPid;
        pts = ptsValue(bytes, offset + 9);
      }
      offset += 9 + bytes[offset + 8];
    }
    if (packetPid === pid && offset < end)
      for (let i = offset; i < end; i++) payload.push(bytes[i]);
    packet += 187;
  }
  if (pts === null) return null;
  for (let i = 0; i + 6 < payload.length; i++) {
    if (payload[i] !== 0 || payload[i + 1] !== 0 || payload[i + 2] !== 1)
      continue;
    const start = i + 3;
    const h264 = (payload[start] & 31) === 7;
    const hevc = ((payload[start] >> 1) & 63) === 33;
    if (!h264 && !hevc) continue;
    for (let end = start + 1; end + 2 < payload.length; end++) {
      if (
        payload[end] !== 0 ||
        payload[end + 1] !== 0 ||
        payload[end + 2] !== 1
      )
        continue;
      const sps = payload.slice(start, end);
      while (sps[sps.length - 1] === 0) sps.pop();
      if (sps.length < 5 || sps.length > 512) return null;
      return {
        pts,
        codec:
          (h264 ? 'avc:' : 'hevc:') +
          sps.map((value) => value.toString(16).padStart(2, '0')).join(''),
      };
    }
  }
  return null;
}

/** Verify a short insert against the main timeline before cutting it. */
export function unmarkedAdSegments(
  groups: HlsMediaGroup[],
  identities: Array<HlsSegmentIdentity | null>
): Set<number> {
  const removed = new Set<number>();
  if (groups.length !== identities.length) return removed;
  const signatures = groups.map(({ duration, segments }) =>
    duration <= 60 && segments.length > 1
      ? `${duration}\n${segments.join('\n')}`
      : ''
  );
  const occurrences = new Map<string, number>();
  for (const signature of signatures) {
    if (signature)
      occurrences.set(signature, (occurrences.get(signature) ?? 0) + 1);
  }
  const confirmedRepeats = new Set<string>();
  const removeGroup = ({ firstSegment, segments }: HlsMediaGroup) => {
    for (let i = 0; i < segments.length; i++) removed.add(firstSegment + i);
  };
  let previous = 0;
  let stableGroups = 1;
  let stableDuration = groups[0]?.duration || 0;
  let stableSegments = groups[0]?.segments.length || 0;
  const startTimelineAt = (index: number) => {
    previous = index;
    stableGroups = 1;
    stableDuration = groups[index].duration;
    stableSegments = groups[index].segments.length;
  };
  for (let i = 1; i < groups.length; i++) {
    const main = identities[previous];
    const stream = identities[i];
    if (!main || !stream) {
      startTimelineAt(i);
      continue;
    }
    const expected = main.pts + groups[previous].duration;
    const resumesMain = (stream?: HlsSegmentIdentity | null) =>
      stream?.codec === main.codec && Math.abs(stream.pts - expected) < 0.5;
    if (resumesMain(stream)) {
      previous = i;
      stableGroups++;
      stableDuration += groups[i].duration;
      stableSegments += groups[i].segments.length;
      continue;
    }
    let resume = -1;
    if (
      ((stableGroups >= 3 && stableDuration >= 30) ||
        (stableDuration >= 60 && stableSegments >= 3)) &&
      stream.pts < expected - 5
    ) {
      if (
        (occurrences.get(signatures[i]) ?? 0) > 1 &&
        resumesMain(identities[i + 1])
      ) {
        resume = i + 1;
        confirmedRepeats.add(signatures[i]);
      } else {
        let duration = 0;
        for (let j = i; j < Math.min(groups.length - 1, i + 4); j++) {
          const candidate = identities[j];
          duration += groups[j].duration;
          if (
            !candidate ||
            duration > 60 ||
            candidate.pts >= expected - 5 ||
            candidate.codec === main.codec
          )
            break;
          if (resumesMain(identities[j + 1])) {
            resume = j + 1;
            break;
          }
        }
      }
    }
    if (resume >= 0) {
      for (let j = i; j < resume; j++) removeGroup(groups[j]);
      previous = resume;
      i = resume;
      stableDuration += groups[resume].duration;
      stableSegments += groups[resume].segments.length;
    } else {
      startTimelineAt(i);
    }
  }
  // An exact copy of a verified insert can also appear before or after the main timeline.
  groups.forEach((group, index) => {
    if (confirmedRepeats.has(signatures[index])) removeGroup(group);
  });
  return removed;
}
