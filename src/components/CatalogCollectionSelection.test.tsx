import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import type { CatalogSettings } from '@/lib/catalog/model';

import CatalogCollectionSelection from './CatalogCollectionSelection';

test('collection choices do not change lifecycle flags and never show disabled categories', () => {
  function Selection() {
    const [settings, setSettings] = useState<CatalogSettings>({
      Enabled: true,
      SourceKeys: ['a'],
      IntervalMinutes: 30,
      Kinds: ['movie'],
      Categories: [
        {
          id: 'movie',
          name: '电影',
          kind: 'movie',
          parentId: '',
          enabled: true,
        },
        {
          id: 'action',
          name: '动作片',
          kind: 'movie',
          parentId: 'movie',
          enabled: true,
        },
        {
          id: 'old',
          name: '停用分类',
          kind: 'other',
          parentId: '',
          enabled: false,
        },
      ],
    });
    return (
      <>
        <CatalogCollectionSelection
          settings={settings}
          setSettings={setSettings}
          disabled={false}
        />
        <output data-testid='settings'>{JSON.stringify(settings)}</output>
      </>
    );
  }
  render(<Selection />);
  expect(screen.queryByRole('checkbox', { name: '停用分类' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '展开 1 项' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '动作片' }));
  const settings = JSON.parse(
    screen.getByTestId('settings').textContent || '{}'
  );
  expect(settings.CollectionCategoryIds).not.toContain('action');
  expect(
    settings.Categories.find(
      (category: { id: string }) => category.id === 'action'
    ).enabled
  ).toBe(true);
  expect(screen.getByRole('checkbox', { name: '电影' })).toBePartiallyChecked();
  expect(screen.getByRole('link', { name: '管理分类' })).toHaveAttribute(
    'href',
    '/admin/catalog-taxonomy'
  );
});
