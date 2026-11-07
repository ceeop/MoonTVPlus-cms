'use client';

import Link from 'next/link';
import { type Dispatch, type SetStateAction, useState } from 'react';

import {
  type CatalogCategory,
  activeCatalogCategories,
} from '@/lib/catalog/category-config';
import type { CatalogSettings } from '@/lib/catalog/model';

export default function CatalogCollectionSelection({
  settings,
  setSettings,
  disabled,
}: {
  settings: CatalogSettings;
  setSettings: Dispatch<SetStateAction<CatalogSettings>>;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const categories = activeCatalogCategories(settings);
  const selected = new Set(
    settings.CollectionCategoryIds ?? categories.map((category) => category.id)
  );
  const roots = categories.filter((category) => !category.parentId);
  const descendants = (id: string): CatalogCategory[] => {
    const ids = new Set([id]);
    for (let index = 0; index < categories.length; index++) {
      const before = ids.size;
      categories.forEach((category) => {
        if (ids.has(category.parentId)) ids.add(category.id);
      });
      if (before === ids.size) break;
    }
    return categories.filter((category) => ids.has(category.id));
  };
  const toggle = (ids: string[], checked: boolean) =>
    setSettings((current) => {
      const value = new Set(
        current.CollectionCategoryIds ??
          activeCatalogCategories(current).map((category) => category.id)
      );
      ids.forEach((id) => (checked ? value.add(id) : value.delete(id)));
      return { ...current, CollectionCategoryIds: Array.from(value) };
    });
  return (
    <section
      aria-label='采集分类选择'
      className='space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700'
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h3 className='font-medium text-gray-900 dark:text-gray-100'>
          采集分类{' '}
          <span className='text-sm font-normal text-gray-600 dark:text-gray-300'>
            已选{' '}
            {categories.filter((category) => selected.has(category.id)).length}{' '}
            / {categories.length}
          </span>
        </h3>
        <Link
          href='/admin/catalog-taxonomy'
          className='inline-flex min-h-[44px] items-center text-sm text-green-700 underline dark:text-green-400'
        >
          管理分类
        </Link>
      </div>
      <p className='text-sm text-gray-600 dark:text-gray-300'>
        勾选本次需要采集的分类。分类名称、启停和源分类绑定在独立设置页管理。
      </p>
      {!categories.length ? (
        <p className='text-sm text-gray-600 dark:text-gray-300'>
          暂无可用分类，请先到管理页添加或启用分类。
        </p>
      ) : (
        <>
          <div className='flex flex-wrap gap-3'>
            <input
              aria-label='筛选采集分类'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className='min-h-[44px] min-w-0 flex-1 rounded-lg border border-gray-300 bg-transparent px-3 text-sm dark:border-gray-600'
              placeholder='搜索分类'
            />
            <button
              type='button'
              disabled={disabled}
              onClick={() =>
                setSettings((current) => ({
                  ...current,
                  CollectionCategoryIds: categories.map(
                    (category) => category.id
                  ),
                }))
              }
              className='min-h-[44px] px-3 text-sm text-green-700 dark:text-green-400'
            >
              全选
            </button>
            <button
              type='button'
              disabled={disabled}
              onClick={() =>
                setSettings((current) => ({
                  ...current,
                  CollectionCategoryIds: [],
                }))
              }
              className='min-h-[44px] px-3 text-sm text-gray-700 dark:text-gray-200'
            >
              清空选择
            </button>
          </div>
          <fieldset disabled={disabled} className='grid gap-3 sm:grid-cols-2'>
            <legend className='sr-only'>要采集的分类</legend>
            {roots.map((root) => {
              const nodes = descendants(root.id);
              const visible = query
                ? nodes.filter((category) => category.name.includes(query))
                : nodes;
              if (!visible.length) return null;
              const checked = nodes.every((category) =>
                selected.has(category.id)
              );
              const partial =
                !checked && nodes.some((category) => selected.has(category.id));
              const open = expanded.includes(root.id) || !!query;
              return (
                <div
                  key={root.id}
                  className='rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50'
                >
                  <div className='flex items-center justify-between gap-2'>
                    <label className='flex min-h-[44px] items-center gap-3 text-sm font-medium text-gray-900 dark:text-gray-100'>
                      <input
                        type='checkbox'
                        checked={checked}
                        ref={(element) => {
                          if (element) element.indeterminate = partial;
                        }}
                        onChange={(event) =>
                          toggle(
                            nodes.map((category) => category.id),
                            event.target.checked
                          )
                        }
                        className='h-5 w-5 accent-green-600'
                      />
                      {root.name}
                    </label>
                    {nodes.length > 1 && (
                      <button
                        type='button'
                        aria-expanded={open}
                        onClick={() =>
                          setExpanded((current) =>
                            current.includes(root.id)
                              ? current.filter((id) => id !== root.id)
                              : [...current, root.id]
                          )
                        }
                        className='min-h-[44px] px-2 text-sm text-gray-600 dark:text-gray-300'
                      >
                        {open ? '收起' : `展开 ${nodes.length - 1} 项`}
                      </button>
                    )}
                  </div>
                  {open && (
                    <div className='mt-1 grid gap-1 border-t border-gray-200 pt-2 dark:border-gray-700'>
                      {visible
                        .filter((category) => category.id !== root.id)
                        .map((category) => (
                          <label
                            key={category.id}
                            className='flex min-h-[44px] items-center gap-3 pl-2 text-sm text-gray-700 dark:text-gray-200'
                          >
                            <input
                              type='checkbox'
                              checked={selected.has(category.id)}
                              onChange={(event) =>
                                toggle([category.id], event.target.checked)
                              }
                              className='h-5 w-5 accent-green-600'
                            />
                            {category.name}
                          </label>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
        </>
      )}
    </section>
  );
}
