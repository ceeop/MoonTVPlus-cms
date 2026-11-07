'use client';

import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import {
  type CatalogCategory,
  activeCatalogCategories,
  removeCatalogCategory,
} from '@/lib/catalog/category-config';
import type { CatalogKind, CatalogSettings } from '@/lib/catalog/model';

const control =
  'min-h-[44px] min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const button = `${control} px-3 hover:bg-gray-100 dark:hover:bg-gray-800`;
const kinds: Array<[CatalogKind, string]> = [
  ['movie', '电影'],
  ['tv', '电视剧'],
  ['anime', '动漫'],
  ['variety', '综艺'],
  ['other', '其他'],
];
const tabs = [
  ['categories', '分类管理'],
  ['bindings', '源分类绑定'],
] as const;
const newId = () =>
  `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const pageSize = 15;
type Tab = 'categories' | 'bindings';

function Pages({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className='flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600 dark:text-gray-300'>
      <span>
        共 {total} 项 · 第 {page} / {pages} 页
      </span>
      <div className='flex gap-2'>
        <button
          type='button'
          className={button}
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </button>
        <button
          type='button'
          className={button}
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export default function CatalogCategoriesEditor({
  settings,
  setSettings,
  sources,
  disabled,
  onBusyChange,
  onEditingChange,
  onTabChange,
  initialTab = 'categories',
}: {
  settings: CatalogSettings;
  setSettings: Dispatch<SetStateAction<CatalogSettings>>;
  sources: Array<{ key: string; name: string }>;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
  onTabChange?: (tab: Tab) => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const panelId = useId();
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [sourceKey, setSourceKey] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [categoryForm, setCategoryForm] = useState<CatalogCategory | null>(
    null
  );
  const [undo, setUndo] = useState<{
    value: CatalogSettings;
    label: string;
  } | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const categories = settings.Categories || [];
  const active = activeCatalogCategories(settings);
  const activeIds = new Set(active.map((category) => category.id));
  const locked = disabled || reading;
  const editing = !!categoryForm;
  useEffect(() => {
    onEditingChange?.(editing);
    if (editing) nameInput.current?.focus();
  }, [editing, onEditingChange]);
  const path = (category: CatalogCategory) => {
    const names = [category.name];
    const seen = new Set([category.id]);
    let parent = categories.find((entry) => entry.id === category.parentId);
    while (parent && !seen.has(parent.id)) {
      names.unshift(parent.name);
      seen.add(parent.id);
      parent = categories.find((entry) => entry.id === parent?.parentId);
    }
    return names.join(' / ');
  };
  const update = (change: (current: CatalogSettings) => CatalogSettings) => {
    setUndo(null);
    setSettings(change);
  };
  const switchTab = (next: Tab) => {
    setTab(next);
    onTabChange?.(next);
    setQuery('');
    setStatus('all');
    setPage(1);
    setCategoryForm(null);
  };
  const readCategories = async () => {
    setReading(true);
    onBusyChange(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'categories', settings }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取源分类失败');
      update((current) => ({
        ...current,
        Categories: data.settings.Categories,
        CategoryBindings: data.settings.CategoryBindings,
        SourceCategories: data.settings.SourceCategories,
      }));
      setMessage('源分类已读取，分类与绑定更改会自动保存。');
      if (data.errors?.length)
        setError(
          data.errors
            .map(
              (entry: { sourceKey: string; error: string }) =>
                `${
                  sources.find((source) => source.key === entry.sourceKey)
                    ?.name || entry.sourceKey
                }：${entry.error}`
            )
            .join('；')
        );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setReading(false);
      onBusyChange(false);
    }
  };
  const currentSource = settings.SourceKeys.includes(sourceKey)
    ? sourceKey
    : settings.DefaultSourceKey || settings.SourceKeys[0] || '';
  const snapshot = settings.SourceCategories?.find(
    (source) => source.sourceKey === currentSource
  );
  const filteredCategories = categories.filter(
    (category) =>
      path(category).includes(query) &&
      (status === 'all' ||
        (status === 'enabled'
          ? activeIds.has(category.id)
          : !activeIds.has(category.id)))
  );
  const filteredBindings = (snapshot?.categories || []).filter((category) => {
    const binding = settings.CategoryBindings?.find(
      (entry) =>
        entry.sourceKey === currentSource && entry.typeId === category.id
    );
    return (
      `${category.name} ${category.id}`.includes(query) &&
      (status === 'all' ||
        (status === 'enabled'
          ? activeIds.has(binding?.categoryId || '')
          : !activeIds.has(binding?.categoryId || '')))
    );
  });
  const total =
    tab === 'categories' ? filteredCategories.length : filteredBindings.length;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const start = (currentPage - 1) * pageSize;
  const forbiddenParents = new Set(categoryForm ? [categoryForm.id] : []);
  for (let index = 0; index < categories.length; index++) {
    const size = forbiddenParents.size;
    categories.forEach((category) => {
      if (forbiddenParents.has(category.parentId))
        forbiddenParents.add(category.id);
    });
    if (size === forbiddenParents.size) break;
  }
  return (
    <section aria-label='分类与源绑定管理' className='space-y-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div
          role='tablist'
          aria-label='分类设置'
          className='flex flex-wrap gap-2'
        >
          {tabs.map(([value, label], index) => (
            <button
              key={value}
              type='button'
              role='tab'
              aria-selected={tab === value}
              id={`${panelId}-${value}`}
              aria-controls={`${panelId}-panel`}
              tabIndex={tab === value ? 0 : -1}
              disabled={locked}
              onClick={() => switchTab(value)}
              onKeyDown={(event) => {
                if (
                  !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                    event.key
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                    ? tabs.length - 1
                    : (index +
                        (event.key === 'ArrowRight' ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
                switchTab(tabs[next][0]);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
                  [next]?.focus();
              }}
              className={`min-h-[44px] rounded-lg px-4 text-sm ${
                tab === value
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type='button'
          disabled={locked || editing || !settings.SourceKeys.length}
          onClick={() => void readCategories()}
          className={button}
        >
          {reading
            ? '正在读取源分类…'
            : settings.Categories === undefined
            ? '从默认源生成分类'
            : '更新源分类'}
        </button>
      </div>
      <p className='text-sm leading-6 text-gray-600 dark:text-gray-300'>
        在这里维护分类名称、状态和源分类绑定。采集范围在“本地片库”单独勾选。停用父分类会同时暂停子分类；删除分类会解除它的源分类绑定，子分类会移至它的上级。
      </p>
      {error && (
        <p
          role='alert'
          className='rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200'
        >
          {error}
        </p>
      )}
      {message && (
        <p className='text-sm text-gray-700 dark:text-gray-200'>{message}</p>
      )}
      {undo && (
        <div
          role='status'
          className='flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100'
        >
          <span>已删除{undo.label}，更改会自动保存。</span>
          <button
            type='button'
            disabled={locked}
            onClick={() => {
              setSettings(undo.value);
              setUndo(null);
            }}
            className='min-h-[44px] px-3 underline'
          >
            撤销删除
          </button>
        </div>
      )}
      {categoryForm && (
        <form
          aria-label='编辑分类'
          className='space-y-4 rounded-xl border border-green-200 bg-green-50/40 p-4 dark:border-green-900 dark:bg-green-950/20'
          onSubmit={(event) => {
            event.preventDefault();
            const value = { ...categoryForm, name: categoryForm.name.trim() };
            if (!value.name) return;
            update((current) => ({
              ...current,
              Categories: current.Categories?.some(
                (category) => category.id === value.id
              )
                ? current.Categories.map((category) =>
                    category.id === value.id ? value : category
                  )
                : [...(current.Categories || []), value],
            }));
            setCategoryForm(null);
          }}
        >
          <h3 className='font-medium text-gray-900 dark:text-gray-100'>
            编辑分类
          </h3>
          <fieldset disabled={locked} className='space-y-4'>
            <label className='flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200'>
              名称
              <input
                ref={nameInput}
                value={categoryForm.name}
                required
                maxLength={100}
                onChange={(event) =>
                  setCategoryForm({ ...categoryForm, name: event.target.value })
                }
                className={`${control} w-full`}
              />
            </label>
            <div className='grid gap-4 sm:grid-cols-2'>
              <label className='flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200'>
                上级分类
                <select
                  value={categoryForm.parentId}
                  onChange={(event) =>
                    setCategoryForm({
                      ...categoryForm,
                      parentId: event.target.value,
                    })
                  }
                  className={control}
                >
                  <option value=''>一级分类</option>
                  {categories
                    .filter((category) => !forbiddenParents.has(category.id))
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {path(category)}
                        {activeIds.has(category.id) ? '' : '（停用）'}
                      </option>
                    ))}
                </select>
              </label>
              <label className='flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200'>
                所属大类
                <select
                  value={categoryForm.kind}
                  onChange={(event) =>
                    setCategoryForm({
                      ...categoryForm,
                      kind: event.target.value as CatalogKind,
                    })
                  }
                  className={control}
                >
                  {kinds.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className='flex min-h-[44px] items-center gap-2 text-sm text-gray-700 dark:text-gray-200'>
              <input
                type='checkbox'
                checked={categoryForm.enabled}
                onChange={(event) =>
                  setCategoryForm({
                    ...categoryForm,
                    enabled: event.target.checked,
                  })
                }
                className='h-5 w-5 accent-green-600'
              />
              启用
            </label>
            <div className='flex gap-3'>
              <button
                type='submit'
                className='min-h-[44px] rounded-lg bg-green-600 px-5 text-sm text-white hover:bg-green-700'
              >
                确定
              </button>
              <button
                type='button'
                onClick={() => setCategoryForm(null)}
                className={button}
              >
                取消
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <fieldset
        disabled={locked}
        className='space-y-4'
        role='tabpanel'
        id={`${panelId}-panel`}
        aria-labelledby={`${panelId}-${tab}`}
      >
        <div className='flex flex-wrap gap-3'>
          {tab === 'bindings' && (
            <label className='flex min-w-0 flex-col gap-1 text-sm text-gray-700 dark:text-gray-200'>
              采集源
              <select
                value={currentSource}
                onChange={(event) => {
                  setSourceKey(event.target.value);
                  setPage(1);
                  setQuery('');
                }}
                className={control}
              >
                {settings.SourceKeys.map((key) => (
                  <option key={key} value={key}>
                    {sources.find((source) => source.key === key)?.name || key}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className='flex min-w-0 flex-1 flex-col gap-1 text-sm text-gray-700 dark:text-gray-200'>
            搜索{tab === 'categories' ? '分类' : '源分类'}
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              className={control}
              placeholder='输入名称搜索'
            />
          </label>
          <label className='flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-200'>
            状态
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className={control}
            >
              <option value='all'>全部状态</option>
              <option value='enabled'>
                {tab === 'bindings' ? '可用绑定' : '启用'}
              </option>
              <option value='disabled'>
                {tab === 'bindings' ? '未绑定或目标停用' : '停用'}
              </option>
            </select>
          </label>
          {tab === 'categories' && (
            <button
              type='button'
              disabled={editing}
              className={`${button} self-end`}
              onClick={() =>
                setCategoryForm({
                  id: newId(),
                  name: '',
                  parentId: '',
                  kind: 'other',
                  enabled: true,
                })
              }
            >
              新增分类
            </button>
          )}
        </div>
        <div className='divide-y divide-gray-200 rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700'>
          {tab === 'categories' &&
            filteredCategories
              .slice(start, start + pageSize)
              .map((category) => (
                <div
                  key={category.id}
                  className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_6rem_auto]'
                >
                  <div className='min-w-0'>
                    <p className='break-words font-medium text-gray-900 dark:text-gray-100'>
                      {category.name}
                    </p>
                    <p className='mt-1 text-xs text-gray-600 dark:text-gray-300'>
                      {category.parentId
                        ? path(category).split(' / ').slice(0, -1).join(' / ')
                        : '一级分类'}{' '}
                      · {kinds.find(([kind]) => kind === category.kind)?.[1]}
                    </p>
                  </div>
                  <span
                    className={`text-sm ${
                      activeIds.has(category.id)
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {!category.enabled
                      ? '停用'
                      : activeIds.has(category.id)
                      ? '启用'
                      : '上级停用'}
                  </span>
                  <div className='col-span-2 flex flex-wrap gap-2 sm:col-span-1'>
                    <button
                      type='button'
                      disabled={editing}
                      className={button}
                      aria-label={`编辑分类 ${category.name}`}
                      onClick={() => setCategoryForm({ ...category })}
                    >
                      编辑
                    </button>
                    <button
                      type='button'
                      disabled={editing}
                      className={button}
                      aria-label={`${category.enabled ? '停用' : '启用'}分类 ${
                        category.name
                      }`}
                      onClick={() =>
                        update((current) => ({
                          ...current,
                          Categories: current.Categories?.map((entry) =>
                            entry.id === category.id
                              ? { ...entry, enabled: !entry.enabled }
                              : entry
                          ),
                        }))
                      }
                    >
                      {category.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      type='button'
                      disabled={editing}
                      className='min-h-[44px] rounded-lg px-3 text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950'
                      aria-label={`删除分类 ${category.name}`}
                      onClick={() => {
                        setUndo({
                          value: settings,
                          label: `分类“${category.name}”`,
                        });
                        setSettings(
                          removeCatalogCategory(settings, category.id)
                        );
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
          {tab === 'bindings' &&
            filteredBindings.slice(start, start + pageSize).map((category) => {
              const binding = settings.CategoryBindings?.find(
                (entry) =>
                  entry.sourceKey === currentSource &&
                  entry.typeId === category.id
              );
              const previous = categories.find(
                (entry) => entry.id === binding?.categoryId
              );
              return (
                <label
                  key={category.id}
                  className='grid items-center gap-3 p-3 text-sm sm:grid-cols-2'
                >
                  <span className='min-w-0 break-words text-gray-900 dark:text-gray-100'>
                    {category.name}
                    <span className='ml-2 text-xs text-gray-600 dark:text-gray-300'>
                      ID {category.id}
                    </span>
                    {previous && !activeIds.has(previous.id) && (
                      <span className='mt-1 block text-xs text-amber-800 dark:text-amber-200'>
                        原绑定“{path(previous)}”已停用
                      </span>
                    )}
                  </span>
                  <select
                    aria-label={`${category.name} 对应系统分类`}
                    value={
                      activeIds.has(binding?.categoryId || '')
                        ? binding?.categoryId
                        : ''
                    }
                    className={`${control} w-full`}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        CategoryBindings: [
                          ...(current.CategoryBindings || []).filter(
                            (entry) =>
                              !(
                                entry.sourceKey === currentSource &&
                                entry.typeId === category.id
                              )
                          ),
                          {
                            sourceKey: currentSource,
                            typeId: category.id,
                            categoryId: event.target.value,
                          },
                        ],
                      }))
                    }
                  >
                    <option value=''>不采集</option>
                    {active.map((target) => (
                      <option key={target.id} value={target.id}>
                        {path(target)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          {!total && (
            <p className='p-6 text-center text-sm text-gray-600 dark:text-gray-300'>
              {tab === 'bindings' && !snapshot
                ? '尚未读取到这个源的分类，请点击“更新源分类”。'
                : '暂无符合条件的项目。'}
            </p>
          )}
        </div>
        <Pages page={currentPage} total={total} setPage={setPage} />
      </fieldset>
    </section>
  );
}
