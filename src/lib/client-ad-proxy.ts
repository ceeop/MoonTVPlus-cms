import { buildHlsAdProxyUrl, isHlsPlaybackUrl } from './hls-playback-url';

export function clientAdProxyEpisodes(
  episodes: string[] | undefined,
  options: {
    origin: string;
    source: string;
    userAgent: string;
    enabledSources?: string[];
    token?: string;
  }
) {
  if (!episodes?.length || !options.enabledSources?.includes(options.source))
    return episodes;
  if (!/moontvplus app|oriontv/i.test(options.userAgent)) return episodes;
  return episodes.map((episode) => {
    if (!/^https?:\/\//i.test(episode) || !isHlsPlaybackUrl(episode))
      return episode;
    return buildHlsAdProxyUrl(episode, { ...options, absolute: true });
  });
}
