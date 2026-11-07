import { render, screen } from '@testing-library/react';

import MobileBottomNav from './MobileBottomNav';
import Sidebar from './Sidebar';

let mockUrl: URL;
jest.mock('next/navigation', () => ({
  usePathname: () => mockUrl.pathname,
  useSearchParams: () => mockUrl.searchParams,
}));

const originalFetch = global.fetch;
const originalConfig = window.RUNTIME_CONFIG;
afterEach(() => {
  global.fetch = originalFetch;
  window.RUNTIME_CONFIG = originalConfig;
});

const navigation = () => (
  <>
    <Sidebar />
    <MobileBottomNav activePath='/' />
  </>
);

test.each([true, false])(
  'only highlights the current catalog entry on desktop and mobile (category mode: %s)',
  async (categoryMode) => {
    const categories = categoryMode
      ? [
          { id: '国产剧', name: '国产剧', kind: 'tv', parentId: '' },
          { id: '港台剧', name: '港台剧', kind: 'tv', parentId: '' },
        ]
      : [
          { id: 'movie', name: '电影', kind: 'movie', parentId: '' },
          { id: 'anime', name: '动漫', kind: 'anime', parentId: '' },
        ];
    window.RUNTIME_CONFIG = { CATALOG_ENABLED: true };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ categoryMode, categories }),
    });

    mockUrl = new URL('/catalog?year=2025', 'http://localhost');
    const { container, rerender } = render(navigation());
    const expectActive = (href: string) => {
      const sidebarLinks = container.querySelectorAll('a[data-active="true"]');
      expect(
        Array.from(sidebarLinks, (link) => link.getAttribute('href'))
      ).toEqual([href]);
      expect(
        screen
          .getAllByRole('link', { current: 'page' })
          .map((link) => link.getAttribute('href'))
      ).toEqual([href, href]);
    };

    await screen.findAllByRole('link', { name: categories[0].name });
    expectActive('/catalog');

    for (const { name, id } of categories) {
      const [link] = screen.getAllByRole('link', { name });
      const href = `/catalog?${
        categoryMode ? 'category' : 'kind'
      }=${encodeURIComponent(id)}`;
      expect(link).toHaveAttribute('href', href);

      mockUrl = new URL(href, 'http://localhost');
      mockUrl.searchParams.set('year', '2025');
      rerender(navigation());
      expectActive(href);
    }

    mockUrl = new URL('/catalog', 'http://localhost');
    rerender(navigation());
    expectActive('/catalog');
  }
);
