import { render, waitFor } from '@testing-library/react';

import {
  createAdFilteringHlsLoader,
  loadCustomAdFilterCode,
} from '@/lib/hls-ad-filter.client';

import TVNativeVideo from './TVNativeVideo';

jest.mock('@/lib/hls-ad-filter.client', () => ({
  createAdFilteringHlsLoader: jest.fn(() => class {}),
  loadCustomAdFilterCode: jest.fn(),
}));
jest.mock('hls.js', () => ({
  __esModule: true,
  default: class {
    static isSupported: () => boolean = () => true;
    loadSource = jest.fn();
    attachMedia = jest.fn();
    destroy = jest.fn();
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(HTMLMediaElement.prototype, 'load')
    .mockImplementation(() => undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  (loadCustomAdFilterCode as jest.Mock).mockResolvedValue('');
});
afterEach(() => jest.restoreAllMocks());

test('native HLS uses the filtered playlist when enabled and keeps the source', async () => {
  jest
    .spyOn(HTMLMediaElement.prototype, 'canPlayType')
    .mockReturnValue('maybe');
  const { container, rerender } = render(
    <TVNativeVideo
      url='https://video.test/a.m3u8'
      source='cms-key'
      adFilterEnabled
    />
  );
  const video = container.querySelector('video') as HTMLVideoElement;
  await waitFor(() => expect(video.src).toContain('/api/proxy-m3u8?'));
  expect(new URL(video.src).searchParams.get('source')).toBe('cms-key');
  expect(new URL(video.src).searchParams.get('url')).toBe(
    'https://video.test/a.m3u8'
  );
  rerender(
    <TVNativeVideo
      url='https://video.test/a.m3u8'
      source='cms-key'
      adFilterEnabled={false}
    />
  );
  await waitFor(() => expect(video.src).toBe('https://video.test/a.m3u8'));
});

test('HLS.js waits for custom rules before loading the first manifest', async () => {
  jest.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
  let resolveRules: (code: string) => void = () => undefined;
  const rules = new Promise<string>((resolve) => {
    resolveRules = resolve;
  });
  (loadCustomAdFilterCode as jest.Mock).mockReturnValue(rules);
  const { container } = render(
    <TVNativeVideo
      url='https://video.test/a.m3u8'
      source='cms-key'
      adFilterEnabled
    />
  );
  const video = container.querySelector('video') as HTMLVideoElement;
  await waitFor(() => expect(loadCustomAdFilterCode).toHaveBeenCalled());
  expect(video.hls).toBeFalsy();
  resolveRules('custom rules');
  await waitFor(() => expect(video.hls?.loadSource).toHaveBeenCalled());
  const playbackUrl = new URL(
    video.hls.loadSource.mock.calls[0][0],
    window.location.origin
  );
  expect(playbackUrl.pathname).toBe('/api/proxy-m3u8');
  expect(playbackUrl.searchParams.get('url')).toBe('https://video.test/a.m3u8');
  const [, getSource, getCode] = (createAdFilteringHlsLoader as jest.Mock).mock
    .calls[0];
  expect(getSource()).toBe('cms-key');
  expect(getCode()).toBe('custom rules');
});
