import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';

import type { CatalogSettings } from '@/lib/catalog/model';

import CatalogCategoriesEditor from './CatalogCategoriesEditor';

const settings: CatalogSettings = {
  Enabled: true,
  SourceKeys: ['a', 'b'],
  IntervalMinutes: 30,
  Kinds: ['movie'],
  Categories: [
    { id: 'movie', name: '电影', parentId: '', kind: 'movie', enabled: true },
  ],
  CategoryBindings: [
    { sourceKey: 'a', typeId: '1', categoryId: 'movie' },
    { sourceKey: 'b', typeId: '99', categoryId: '' },
  ],
  SourceCategories: [
    { sourceKey: 'a', categories: [{ id: '1', name: '电影', parentId: '' }] },
    { sourceKey: 'b', categories: [{ id: '99', name: '影片', parentId: '' }] },
  ],
};
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
const busy = jest.fn();
function Editor({ initial = settings }: { initial?: CatalogSettings }) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <CatalogCategoriesEditor
        settings={draft}
        setSettings={setDraft}
        sources={[
          { key: 'a', name: '首源' },
          { key: 'b', name: '次源' },
        ]}
        disabled={false}
        onBusyChange={busy}
      />
      <output data-testid='draft'>{JSON.stringify(draft)}</output>
    </>
  );
}
const draft = () => JSON.parse(screen.getByTestId('draft').textContent || '{}');

test('edits a name in its own form and binds another source to the stable category ID', () => {
  global.fetch = jest.fn();
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: '编辑分类 电影' }));
  fireEvent.change(screen.getByLabelText('名称'), {
    target: { value: '电影馆' },
  });
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  fireEvent.click(screen.getByRole('tab', { name: '源分类绑定' }));
  fireEvent.change(screen.getByLabelText('采集源'), { target: { value: 'b' } });
  fireEvent.change(screen.getByLabelText('影片 对应系统分类'), {
    target: { value: 'movie' },
  });
  expect(draft().Categories[0]).toMatchObject({ id: 'movie', name: '电影馆' });
  expect(
    draft().CategoryBindings.find(
      (binding: { sourceKey: string }) => binding.sourceKey === 'b'
    ).categoryId
  ).toBe('movie');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('source classification reads are explicit instead of running on every settings visit', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ settings, errors: [] }),
  });
  render(
    <Editor
      initial={{
        Enabled: true,
        SourceKeys: ['a', 'b'],
        IntervalMinutes: 30,
        Kinds: ['movie'],
      }}
    />
  );
  expect(global.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '从默认源生成分类' }));
  await screen.findByRole('button', { name: '编辑分类 电影' });
  const request = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
  expect(request.action).toBe('categories');
  expect(request.settings.SourceKeys[0]).toBe('a');
});

test('binding choices hide disabled categories while retaining a clear explanation of old bindings', () => {
  const initial: CatalogSettings = {
    ...settings,
    Categories: [
      ...(settings.Categories || []),
      { id: 'old', name: '旧分类', kind: 'tv', parentId: '', enabled: false },
    ],
    CategoryBindings: [{ sourceKey: 'b', typeId: '99', categoryId: 'old' }],
  };
  render(<Editor initial={initial} />);
  fireEvent.click(screen.getByRole('tab', { name: '源分类绑定' }));
  fireEvent.change(screen.getByLabelText('采集源'), { target: { value: 'b' } });
  const select = screen.getByLabelText('影片 对应系统分类');
  expect(
    within(select).getByRole('option', { name: '电影' })
  ).toBeInTheDocument();
  expect(within(select).queryByRole('option', { name: /旧分类/ })).toBeNull();
  expect(screen.getByText('原绑定“旧分类”已停用')).toBeInTheDocument();
});

test('deleting a parent keeps its child, unlinks bindings and supports undo before saving', () => {
  const initial: CatalogSettings = {
    ...settings,
    Categories: [
      ...(settings.Categories || []),
      {
        id: 'child',
        name: '动作',
        kind: 'movie',
        parentId: 'movie',
        enabled: true,
      },
    ],
  };
  render(<Editor initial={initial} />);
  fireEvent.click(screen.getByRole('button', { name: '删除分类 电影' }));
  expect(draft().Categories).toEqual([
    expect.objectContaining({ id: 'child', parentId: '' }),
  ]);
  expect(draft().CategoryBindings[0].categoryId).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '撤销删除' }));
  expect(draft().Categories).toHaveLength(2);
  expect(draft().CategoryBindings[0].categoryId).toBe('movie');
});
