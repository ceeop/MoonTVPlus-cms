import { act, fireEvent, render, screen } from '@testing-library/react';

import CatalogPoster from './CatalogPoster';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('retries failed images with a new URL and replaces exhausted failures with a labeled placeholder', () => {
  const { rerender } = render(
    <CatalogPoster src='/api/catalog/posters/first' alt='测试影片' />
  );
  fireEvent.error(screen.getByRole('img', { name: '测试影片' }));
  expect(screen.getByText('正在重试封面…')).toBeVisible();
  act(() => jest.advanceTimersByTime(1500));
  expect(screen.getByRole('img', { name: '测试影片' })).toHaveAttribute(
    'src',
    '/api/catalog/posters/first?retry=1'
  );
  fireEvent.error(screen.getByRole('img', { name: '测试影片' }));
  act(() => jest.advanceTimersByTime(1500));
  fireEvent.error(screen.getByRole('img', { name: '测试影片' }));
  expect(screen.queryByRole('img', { name: '测试影片' })).toBeNull();
  expect(
    screen.getByRole('img', { name: '测试影片：封面暂不可用' })
  ).toBeVisible();
  rerender(<CatalogPoster src='/api/catalog/posters/second' alt='测试影片' />);
  expect(screen.getByRole('img', { name: '测试影片' })).toHaveAttribute(
    'src',
    '/api/catalog/posters/second'
  );
});
