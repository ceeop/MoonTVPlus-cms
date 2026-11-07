import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import PlayPage from './page';

const episodes = [1, 2, 3, 4].map((n) => `https://media.example/${n}.mp4`);
const detail = {
  id: 'series',
  source: 'cms',
  source_name: 'CMS',
  title: '选集测试',
  year: '2026',
  type_name: '电视剧',
  episodes,
  episodes_titles: episodes.map((_, i) => `第${i + 1}集`),
};
let mockSearchParams: URLSearchParams;
const mockRouter = { prefetch: jest.fn(), push: jest.fn(), back: jest.fn() };
let mockPlayer: MockArtplayer;

class MockArtplayer {
  video = document.createElement('video');
  controls = { add: jest.fn() };
  layers = { add: jest.fn() };
  notice = { show: '' };
  setting = { add: jest.fn(), remove: jest.fn() };
  subtitle = { show: false };
  pause = jest.fn();
  paused = true;
  private events = new Map<string, Array<() => void>>();

  constructor(public option: { url: string }) {
    this.video.src = option.url;
  }

  set switch(url: string) {
    this.option.url = url;
  }

  on(event: string, callback: () => void) {
    this.events.set(event, [...(this.events.get(event) || []), callback]);
  }

  off(event: string) {
    this.events.delete(event);
  }

  emit(event: string) {
    this.events.get(event)?.forEach((callback) => callback());
  }

  destroy() {
    this.emit('destroy');
  }
}

jest.mock('artplayer', () => ({
  __esModule: true,
  default: jest.fn((option: { url: string }) => {
    mockPlayer = new MockArtplayer(option);
    return mockPlayer;
  }),
}));
jest.mock('artplayer-plugin-danmuku', () => () => ({}));
jest.mock('@/lib/artplayer-plugin-auto-thumbnail', () => () => ({}));
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => mockRouter,
}));
jest.mock('@/contexts/DownloadContext', () => ({ useDownload: () => ({}) }));
jest.mock('@/lib/db.client', () => ({
  generateStorageKey: () => 'cms+series',
  getAllPlayRecords: async () => ({
    'cms+series': { index: 4, play_time: 30 },
  }),
  getDanmakuFilterConfig: async () => undefined,
  getEpisodeFilterConfig: async () => undefined,
  getSkipConfig: async () => undefined,
  isFavorited: async () => false,
  subscribeToDataUpdates: () => () => undefined,
}));
jest.mock('@/lib/indexeddb-video-cache', () => ({
  getIndexedDBVideoPlaybackUrl: async () => ({ hasLocal: false }),
}));
jest.mock('@/lib/utils', () => ({
  ...jest.requireActual('@/lib/utils'),
  getVideoResolutionFromM3u8: async () => null,
}));
jest.mock('@/lib/danmaku/api', () => ({
  getDanmakuFromCache: async () => null,
  initDanmakuModule: jest.fn(),
  loadDanmakuDisplayState: () => false,
  loadDanmakuSettings: () => ({}),
  searchAnime: async () => [],
}));
jest.mock('@/lib/danmaku/traditional-to-simplified', () => ({}));
jest.mock('@/components/AIChatPanel', () => () => null);
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/EpisodeSelector', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (i: number) => void;
  }) => (
    <div>
      {episodes.map((_, i) => (
        <button
          key={i}
          aria-pressed={value === i + 1}
          onClick={() => onChange(i)}
        >
          第{i + 1}集
        </button>
      ))}
    </div>
  ),
}));
jest.mock('@/components/SmartRecommendations', () => () => null);

const originalFetch = global.fetch;
const originalIndexedDB = window.indexedDB;
afterEach(() => {
  global.fetch = originalFetch;
  Object.defineProperty(window, 'indexedDB', { value: originalIndexedDB });
});

test('switches episodes manually and after playback ends with an episode link in the URL', async () => {
  mockSearchParams = new URLSearchParams({
    source: 'cms',
    id: 'series',
    episode: '1',
  });
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: {
      open: () => {
        const request = {
          result: {
            objectStoreNames: { contains: () => false },
            close: jest.fn(),
          },
          onsuccess: (_event: { target: unknown }) => undefined,
        };
        queueMicrotask(() => request.onsuccess({ target: request }));
        return request;
      },
    },
  });
  global.fetch = jest.fn().mockImplementation(async (input: string) => ({
    ok: true,
    json: async () =>
      input.startsWith('/api/source-detail?') ? detail : { results: [] },
  }));
  const { rerender } = render(<PlayPage />);
  const second = await screen.findByRole(
    'button',
    { name: '第2集' },
    { timeout: 3000 }
  );
  await waitFor(() => expect(mockPlayer?.option.url).toBe(episodes[0]));

  fireEvent.click(second);
  await waitFor(() => expect(mockPlayer.option.url).toBe(episodes[1]));
  expect(second).toHaveAttribute('aria-pressed', 'true');

  mockSearchParams = new URLSearchParams(`${mockSearchParams}&year=2026`);
  rerender(<PlayPage />);
  expect(second).toHaveAttribute('aria-pressed', 'true');

  act(() => mockPlayer.emit('video:ended'));
  await waitFor(() => expect(mockPlayer.option.url).toBe(episodes[2]), {
    timeout: 2500,
  });

  mockSearchParams = new URLSearchParams({
    source: 'cms',
    id: 'series',
    episode: '4',
  });
  rerender(<PlayPage />);
  await waitFor(() => expect(mockPlayer.option.url).toBe(episodes[3]));
});
