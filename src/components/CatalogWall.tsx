'use client';

import { ChevronLeft, ChevronRight, Film, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { CatalogCard } from '@/lib/catalog/model';

import CatalogPoster from '@/components/CatalogPoster';

const kinds = [
  ['', '全部'],
  ['movie', '电影'],
  ['tv', '电视剧'],
  ['anime', '动漫'],
  ['variety', '综艺'],
  ['other', '其他'],
];
const control =
  'min-h-[44px] rounded-lg border border-gray-200 bg-white px-3 text-base sm:text-sm text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
interface WallData {
  enabled: boolean;
  results: CatalogCard[];
  total: number;
  pageCount: number;
  years: string[];
  areas: string[];
  categoryMode?: boolean;
  categories: Array<{
    id: string;
    name: string;
    parentId: string;
    kind: string;
  }>;
}

export default function CatalogWall({
  compact = false,
  initialKind = '',
  initialCategory = '',
}: {
  compact?: boolean;
  initialKind?: string;
  initialCategory?: string;
}) {
  const [filters, setFilters] = useState({
    kind: kinds.some(([value]) => value === initialKind) ? initialKind : '',
    category: initialCategory,
    year: '',
    area: '',
    order: 'year',
    q: '',
    page: 1,
  });
  const [query, setQuery] = useState('');
  const [data, setData] = useState<WallData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const kind = kinds.some(([value]) => value === initialKind)
      ? initialKind
      : '';
    setFilters((previous) =>
      previous.kind === kind && previous.category === initialCategory
        ? previous
        : { ...previous, kind, category: initialCategory, page: 1 }
    );
  }, [initialKind, initialCategory]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      ...filters,
      page: String(filters.page),
      limit: compact ? '18' : '30',
    });
    fetch(`/api/catalog?${params}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '片库加载失败');
        setData(body);
      })
      .catch((reason) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [filters, compact, revision]);

  const setFilter = (key: string, value: string) =>
    setFilters((previous) => ({ ...previous, [key]: value, page: 1 }));
  const categories = data?.categories || [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  const rootFor = (id: string) => {
    let category = byId.get(id);
    const seen = new Set<string>();
    while (
      category?.parentId &&
      byId.has(category.parentId) &&
      !seen.has(category.id)
    ) {
      seen.add(category.id);
      category = byId.get(category.parentId);
    }
    return category;
  };
  const roots = categories.filter(
    (category) => !category.parentId || !byId.has(category.parentId)
  );
  const selectedRoot =
    rootFor(filters.category) ||
    roots.find((category) => category.kind === filters.kind);
  const children = selectedRoot
    ? categories.filter(
        (category) =>
          category.parentId && rootFor(category.id)?.id === selectedRoot.id
      )
    : [];
  const selectCategory = (id: string) =>
    setFilters((previous) => ({
      ...previous,
      kind: data?.categoryMode ? '' : id,
      category: data?.categoryMode ? id : '',
      page: 1,
    }));
  useEffect(() => {
    if (!data?.enabled || loading) return;
    if (
      (filters.category &&
        !data.categories.some(
          (category) => category.id === filters.category
        )) ||
      (filters.kind &&
        !data.categories.some((category) => category.kind === filters.kind))
    ) {
      setFilters((previous) => ({
        ...previous,
        category: '',
        kind: '',
        page: 1,
      }));
    }
  }, [data, loading, filters.category, filters.kind]);
  return (
    <section className='mb-10 mt-6' aria-label='影视片库' aria-busy={loading}>
      <div className='mb-5 flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100'>
            影视片库
          </h1>
          <p
            className='mt-1 text-sm text-gray-600 dark:text-gray-400'
            role='status'
          >
            {data?.enabled
              ? `已收录 ${data.total.toLocaleString()} 部作品 · ${
                  filters.order === 'updated' ? '最近更新' : '上映年份'
                }`
              : '浏览已收录的电影与剧集'}
          </p>
        </div>
        {compact && (
          <Link
            href='/catalog'
            className='inline-flex min-h-[44px] items-center gap-1 text-sm text-green-700 dark:text-green-400'
          >
            查看全部
            <ChevronRight size={16} aria-hidden='true' />
          </Link>
        )}
      </div>

      <div className='mb-4 flex flex-wrap gap-2' aria-label='影片分类'>
        {[{ id: '', name: '全部' }, ...roots].map(
          ({ id: value, name: label }) => (
            <button
              key={value}
              type='button'
              aria-pressed={
                value
                  ? data?.categoryMode
                    ? selectedRoot?.id === value
                    : filters.kind === value
                  : !filters.kind && !filters.category
              }
              onClick={() => selectCategory(value)}
              className={`min-h-[44px] rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-600 ${
                (
                  value
                    ? data?.categoryMode
                      ? selectedRoot?.id === value
                      : filters.kind === value
                    : !filters.kind && !filters.category
                )
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          )
        )}
      </div>
      {!!children.length && (
        <div className='mb-4 flex flex-wrap gap-2' aria-label='子分类'>
          {children.map((category) => (
            <button
              key={category.id}
              type='button'
              aria-pressed={filters.category === category.id}
              onClick={() => selectCategory(category.id)}
              className={`min-h-[44px] rounded-lg border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-600 ${
                filters.category === category.id
                  ? 'border-green-600 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}
      <div className='mb-6 flex flex-wrap gap-2'>
        <label className='sr-only' htmlFor='catalog-year'>
          年份
        </label>
        <select
          id='catalog-year'
          className={control}
          value={filters.year}
          onChange={(e) => setFilter('year', e.target.value)}
        >
          <option value=''>全部年份</option>
          {data?.years.map((year) => (
            <option key={year}>{year}</option>
          ))}
        </select>
        <label className='sr-only' htmlFor='catalog-area'>
          地区
        </label>
        <select
          id='catalog-area'
          className={control}
          value={filters.area}
          onChange={(e) => setFilter('area', e.target.value)}
        >
          <option value=''>全部地区</option>
          {data?.areas.map((area) => (
            <option key={area}>{area}</option>
          ))}
        </select>
        <label className='sr-only' htmlFor='catalog-order'>
          排序
        </label>
        <select
          id='catalog-order'
          className={control}
          value={filters.order}
          onChange={(e) => setFilter('order', e.target.value)}
        >
          <option value='year'>上映年份</option>
          <option value='updated'>最近更新</option>
        </select>
        {!compact && (
          <form
            className='flex min-w-0 flex-1 basis-full gap-2 sm:min-w-[180px] sm:basis-auto'
            onSubmit={(e) => {
              e.preventDefault();
              setFilter('q', query.trim());
            }}
          >
            <label className='sr-only' htmlFor='catalog-query'>
              搜索片库
            </label>
            <input
              id='catalog-query'
              className={`${control} min-w-0 flex-1`}
              placeholder='搜索片名'
              maxLength={40}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type='submit'
              aria-label='搜索片库'
              className={`${control} inline-flex w-11 items-center justify-center`}
            >
              <Search size={18} aria-hidden='true' />
            </button>
          </form>
        )}
      </div>

      {error ? (
        <div
          role='alert'
          className='rounded-xl bg-red-50 p-6 text-red-800 dark:bg-red-950 dark:text-red-200'
        >
          <p>{error}</p>
          <button
            className='mt-3 min-h-[44px] underline'
            onClick={() => setRevision((n) => n + 1)}
          >
            重新加载
          </button>
        </div>
      ) : !loading && !data?.enabled ? (
        <div className='rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-600 dark:border-gray-700 dark:text-gray-300'>
          <Film className='mx-auto mb-3' size={28} aria-hidden='true' />
          <p>片库尚未启用，请管理员在后台的“本地片库”中选择采集源并启用。</p>
        </div>
      ) : !loading && !data?.results.length ? (
        <div className='rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-600 dark:border-gray-700 dark:text-gray-300'>
          <Film className='mx-auto mb-3' size={28} aria-hidden='true' />
          <p>暂时没有符合条件的影片。首次采集完成后，影片会显示在这里。</p>
          <Link
            href={`/search?q=${encodeURIComponent(filters.q)}`}
            className='mt-3 inline-flex min-h-[44px] items-center text-green-700 dark:text-green-400'
          >
            搜索更多影片
            <ChevronRight size={16} aria-hidden='true' />
          </Link>
        </div>
      ) : (
        <div className='grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-5 lg:grid-cols-6'>
          {loading
            ? Array.from({ length: compact ? 12 : 18 }, (_, i) => (
                <div key={i} aria-hidden='true'>
                  <div className='aspect-[2/3] animate-pulse rounded-xl bg-gray-200 motion-reduce:animate-none dark:bg-gray-800' />
                  <div className='mt-3 h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-800' />
                </div>
              ))
            : data?.results.map((item) => (
                <Link
                  key={item.work_id}
                  href={`/catalog/${item.work_id}`}
                  className='group min-w-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green-600'
                >
                  <div className='relative aspect-[2/3] overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800'>
                    <CatalogPoster
                      src={item.poster}
                      alt={item.title}
                      className='h-full w-full object-cover transition-opacity group-hover:opacity-90'
                    />
                    <span className='absolute right-2 top-2 rounded bg-black/70 px-1.5 py-1 text-xs text-white'>
                      {item.resource_count} 个源
                    </span>
                    {item.vod_remarks && (
                      <span className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-6 text-right text-xs text-white'>
                        {item.vod_remarks}
                      </span>
                    )}
                  </div>
                  <h2
                    className='mt-2 truncate text-sm font-medium text-gray-900 group-hover:text-green-700 dark:text-gray-100 dark:group-hover:text-green-400'
                    title={item.title}
                  >
                    {item.title}
                  </h2>
                  <p className='mt-1 truncate text-xs text-gray-600 dark:text-gray-400'>
                    {[item.year, item.area].filter(Boolean).join(' · ')}
                  </p>
                </Link>
              ))}
        </div>
      )}

      {!compact && data && data.pageCount > 1 && (
        <nav
          aria-label='片库分页'
          className='mt-8 flex items-center justify-center gap-4'
        >
          <button
            className={`${control} inline-flex items-center gap-1 disabled:opacity-40`}
            disabled={loading || filters.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          >
            <ChevronLeft size={16} aria-hidden='true' />
            上一页
          </button>
          <span className='text-sm text-gray-600 dark:text-gray-300'>
            {filters.page} / {data.pageCount}
          </span>
          <button
            className={`${control} inline-flex items-center gap-1 disabled:opacity-40`}
            disabled={loading || filters.page >= data.pageCount}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            下一页
            <ChevronRight size={16} aria-hidden='true' />
          </button>
        </nav>
      )}
    </section>
  );
}
