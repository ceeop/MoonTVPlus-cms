import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import CatalogWall from './CatalogWall';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

test.each([false, true])(
  'defaults to release year ordering and allows update ordering (compact: %s)',
  async (compact) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        results: [],
        total: 0,
        pageCount: 0,
        years: [],
        areas: [],
        categories: [],
      }),
    });
    global.fetch = fetchMock;
    render(<CatalogWall compact={compact} />);
    await screen.findByText('已收录 0 部作品 · 上映年份');
    const order = screen.getByRole('combobox', { name: '排序' });
    expect(order).toHaveValue('year');
    expect(
      new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
        .searchParams.get('order')
    ).toBe('year');
    fireEvent.change(order, { target: { value: 'updated' } });
    await waitFor(() => {
      const url = new URL(
        String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]),
        'http://localhost'
      );
      expect(url.searchParams.get('order')).toBe('updated');
      expect(url.searchParams.get('page')).toBe('1');
    });
    expect(
      screen.getByText('已收录 0 部作品 · 最近更新')
    ).toBeInTheDocument();
  }
);

test('renders only collected system categories and filters by category ID after a rename', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      enabled: true,
      categoryMode: true,
      results: [],
      total: 0,
      pageCount: 0,
      years: [],
      areas: [],
      categories: [
        { id: 'drama', name: '剧场', kind: 'tv', parentId: '' },
        { id: 'local', name: '华语剧集', kind: 'tv', parentId: 'drama' },
      ],
    }),
  });
  global.fetch = fetchMock;
  render(<CatalogWall />);
  fireEvent.click(await screen.findByRole('button', { name: '剧场' }));
  expect(screen.queryByRole('button', { name: '电影' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: '华语剧集' }));
  await waitFor(() => {
    const url = new URL(
      String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]),
      'http://localhost'
    );
    expect(url.searchParams.get('category')).toBe('local');
    expect(url.searchParams.get('kind')).toBe('');
  });
});
