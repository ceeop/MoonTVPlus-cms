import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import type { SearchResult } from '@/lib/types';

import { SearchPageClient } from './SearchPageClient';

let mockParams = new URLSearchParams('q=测试');
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockParams,
}));
jest.mock('@/lib/auth', () => ({
  getAuthInfoFromBrowserCookie: () => ({ role: 'user' }),
}));
jest.mock('@/lib/db.client', () => ({
  addSearchHistory: jest.fn(),
  clearSearchHistory: jest.fn(),
  deleteSearchHistory: jest.fn(),
  getSearchHistory: async () => [],
  subscribeToDataUpdates: () => () => undefined,
}));
jest.mock('@/lib/utils', () => ({ processImageUrl: (url: string) => url }));
jest.mock('@/lib/danmaku/traditional-to-simplified', () => ({
  loadTraditionalToSimplifiedConverter: async () => (text: string) => text,
}));
jest.mock(
  '@/components/PageLayout',
  () =>
    ({ children }: { children: ReactNode }) =>
      <div>{children}</div>
);
jest.mock('@/components/AcgSearch', () => () => null);
jest.mock('@/components/PansouSearch', () => ({
  __esModule: true,
  default: () => null,
  CLOUD_TYPE_NAMES: {},
}));
jest.mock('@/components/ContinueWatching', () => () => null);
jest.mock('@/components/ImageViewer', () => () => null);
jest.mock('@/components/ProxyImage', () => () => null);
jest.mock('@/components/SearchSuggestions', () => () => null);
jest.mock('@/components/SearchResultFilter', () => () => null);
jest.mock('@/components/VideoCard', () => () => null);
jest.mock(
  '@/components/VirtualScrollableGrid',
  () =>
    ({ children }: { children: ReactNode }) =>
      <div>{children}</div>
);

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = jest.fn();
  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  send(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}
const originalEventSource = window.EventSource;
const result = (source: string, desc = ''): SearchResult => ({
  id: '1',
  source,
  source_name: source,
  title: '测试影片',
  poster: '',
  year: '2026',
  desc,
  type_name: '电影',
  episodes: ['1.m3u8'],
  episodes_titles: ['正片'],
});
const openSearch = async () => {
  const view = render(<SearchPageClient />);
  await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
  return { ...view, stream: MockEventSource.instances[0] };
};
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('searchResultDisplayMode', 'list');
  localStorage.setItem('defaultAggregateSearch', 'false');
  localStorage.setItem('fluidSearch', 'false');
  Object.assign(window, {
    RUNTIME_CONFIG: { CATALOG_ENABLED: true },
    EventSource: MockEventSource,
  });
  MockEventSource.instances = [];
  mockParams = new URLSearchParams('q=测试');
});
afterEach(() => {
  window.EventSource = originalEventSource;
});

test('shows catalog results immediately, updates duplicates in place, and appends each source', async () => {
  const { stream } = await openSearch();
  act(() =>
    stream.send({ type: 'catalog_result', results: [result('a', '片库简介')] })
  );
  expect(screen.getByText('片库简介')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('片库结果已显示');
  expect(
    screen.getByRole('button', { name: '强制刷新搜索结果' })
  ).toBeDisabled();
  expect(screen.queryByRole('link', { name: '在线补搜' })).toBeNull();

  act(() => {
    stream.send({ type: 'start', totalSources: 2 });
    stream.send({
      type: 'source_result',
      source: 'a',
      results: [result('a', '最新简介')],
    });
  });
  await screen.findByText('最新简介');
  expect(screen.queryByText('片库简介')).toBeNull();
  expect(screen.getAllByText('测试影片')).toHaveLength(1);

  act(() =>
    stream.send({ type: 'source_result', source: 'b', results: [result('b')] })
  );
  await waitFor(() => expect(screen.getAllByText('测试影片')).toHaveLength(2));
  act(() => stream.send({ type: 'complete', completedSources: 2 }));
  expect(screen.getByRole('status')).toHaveTextContent('各源搜索完成2/2');
  expect(
    screen.getByRole('button', { name: '强制刷新搜索结果' })
  ).toBeEnabled();
  const cache = JSON.parse(
    sessionStorage.getItem('search_cache_测试_unified') || 'null'
  );
  expect(cache.results).toHaveLength(2);
  expect(cache.status).toBe('complete');
});

test('changing the query closes the previous stream and ignores its late events', async () => {
  const { stream, rerender } = await openSearch();
  act(() =>
    stream.send({ type: 'source_result', results: [result('a', '过期简介')] })
  );
  mockParams = new URLSearchParams('q=新影片');
  rerender(<SearchPageClient />);
  await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
  expect(stream.close).toHaveBeenCalled();
  act(() => {
    stream.send({
      type: 'catalog_result',
      results: [result('a', '旧片库简介')],
    });
    stream.send({ type: 'complete', completedSources: 1 });
    stream.onerror?.();
  });
  expect(screen.queryByText('过期简介')).toBeNull();
  expect(screen.queryByText('旧片库简介')).toBeNull();
  expect(
    screen.getByRole('button', { name: '强制刷新搜索结果' })
  ).toBeDisabled();
});

test('refresh starts exactly one new search and bypasses source caches', async () => {
  const { stream } = await openSearch();
  act(() => {
    stream.send({ type: 'catalog_result', results: [result('a')] });
    stream.send({ type: 'complete', completedSources: 0 });
  });
  fireEvent.click(screen.getByRole('button', { name: '强制刷新搜索结果' }));
  await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
  expect(MockEventSource.instances[1].url).toContain('&fresh=1');
  expect(
    screen.getByRole('button', { name: '强制刷新搜索结果' })
  ).toBeDisabled();
});

test('a disconnected stream keeps catalog results available', async () => {
  const { stream } = await openSearch();
  act(() => {
    stream.send({ type: 'catalog_result', results: [result('a', '片库简介')] });
    stream.onerror?.();
  });
  expect(screen.getByText('片库简介')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: '强制刷新搜索结果' })
  ).toBeEnabled();
  expect(screen.getByRole('status')).toHaveTextContent(
    '部分来源搜索中断，可刷新重试'
  );
  expect(sessionStorage.getItem('search_cache_测试_unified')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^测试影片/ }));
  expect(
    JSON.parse(sessionStorage.getItem('search_cache_测试_unified') || 'null')
  ).toMatchObject({
    status: 'partial',
    results: [result('a', '片库简介')],
  });
});

test('opening a catalog result during loading saves even a single result for immediate playback', async () => {
  const { stream } = await openSearch();
  act(() =>
    stream.send({
      type: 'catalog_result',
      results: [result('a', '可立即播放')],
    })
  );
  fireEvent.click(screen.getByRole('button', { name: /^测试影片/ }));
  const cached = JSON.parse(
    sessionStorage.getItem('search_cache_测试_unified') || 'null'
  );
  expect(cached.status).toBe('partial');
  expect(cached.results).toHaveLength(1);
  expect(mockRouter.push).toHaveBeenCalled();
});
