'use client';

import { ArrowLeft, Play, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { SearchResult } from '@/lib/types';

import CatalogPoster from '@/components/CatalogPoster';
import PageLayout from '@/components/PageLayout';

export default function CatalogDetail({ params }: { params: { id: string } }) {
  const [resources, setResources] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setResources([]);
    setError('');
    fetch(`/api/catalog?work=${encodeURIComponent(params.id)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setResources(data.resources);
        setSelected(0);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [params.id, revision]);
  const current = resources[selected];
  const playUrl = (episode: number) =>
    `/play?${new URLSearchParams({
      source: current.source,
      id: current.id,
      title: current.title,
      year: current.year,
      stitle: current.title,
      episode: String(episode + 1),
    })}`;
  const refresh = async () => {
    setRefreshing(true);
    setError('');
    const selectedSource = current.source;
    const selectedId = current.id;
    try {
      const response = await fetch(
        `/api/source-detail?${new URLSearchParams({
          source: selectedSource,
          id: selectedId,
          fresh: '1',
        })}`,
        { cache: 'no-store' }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '刷新线路失败');
      setResources((previous) =>
        previous.map((item) =>
          item.source === selectedSource && item.id === selectedId ? data : item
        )
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <PageLayout>
      <main className='mx-auto max-w-6xl px-4 py-8 sm:px-8'>
        <Link
          href='/catalog'
          className='mb-6 inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-600 dark:text-gray-300'
        >
          <ArrowLeft size={16} aria-hidden='true' />
          返回片库
        </Link>
        {loading ? (
          <p role='status' className='text-gray-600 dark:text-gray-300'>
            正在加载影片…
          </p>
        ) : !current ? (
          <div className='text-gray-700 dark:text-gray-200'>
            <p role='alert'>
              {error || '影片尚未收录，或当前账号没有可用的播放源。'}
            </p>
            <button
              className='mt-3 min-h-[44px] underline'
              onClick={() => setRevision((n) => n + 1)}
            >
              重新加载
            </button>
          </div>
        ) : (
          <>
            <div className='flex flex-col gap-6 sm:flex-row'>
              <div className='aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-xl bg-gray-200 sm:w-52 dark:bg-gray-800'>
                <CatalogPoster
                  src={current.poster}
                  alt={current.title}
                  className='h-full w-full object-cover'
                />
              </div>
              <div className='min-w-0 flex-1'>
                <h1 className='text-3xl font-bold text-gray-900 dark:text-gray-100'>
                  {current.title}
                </h1>
                <p className='mt-3 text-sm text-gray-600 dark:text-gray-300'>
                  {[current.year, current.type_name, current.vod_remarks]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className='mt-4 whitespace-pre-line text-sm leading-7 text-gray-700 dark:text-gray-300'>
                  {current.desc || '暂无简介'}
                </p>
                {!!current.episodes.length && (
                  <Link
                    href={playUrl(0)}
                    className='mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-green-600 px-5 text-white hover:bg-green-700'
                  >
                    <Play size={18} aria-hidden='true' />
                    立即播放
                  </Link>
                )}
              </div>
            </div>
            <section className='mt-10' aria-label='播放线路'>
              <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
                <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  播放源
                </h2>
                <button
                  onClick={refresh}
                  disabled={refreshing}
                  className='inline-flex min-h-[44px] items-center gap-2 px-3 text-sm text-green-700 disabled:opacity-50 dark:text-green-400'
                >
                  <RefreshCw size={16} aria-hidden='true' />
                  {refreshing ? '刷新中…' : '刷新线路'}
                </button>
              </div>
              {error && (
                <p
                  role='alert'
                  className='mb-4 text-sm text-red-700 dark:text-red-300'
                >
                  {error}
                </p>
              )}
              <div className='flex flex-wrap gap-2'>
                {resources.map((resource, index) => (
                  <button
                    key={`${resource.source}:${resource.id}`}
                    aria-pressed={selected === index}
                    onClick={() => setSelected(index)}
                    className={`min-h-[44px] rounded-lg border px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-600 ${
                      selected === index
                        ? 'border-green-600 bg-green-600 text-white'
                        : 'border-gray-200 text-gray-700 dark:border-gray-700 dark:text-gray-200'
                    }`}
                  >
                    {resource.source_name} · {resource.episodes.length} 集
                  </button>
                ))}
              </div>
              <div className='mt-5 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8'>
                {current.episodes.map((_, index) => (
                  <Link
                    key={index}
                    href={playUrl(index)}
                    className='flex min-h-[44px] items-center justify-center rounded-lg bg-gray-100 px-2 py-3 text-center text-sm text-gray-800 hover:bg-green-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700'
                  >
                    {current.episodes_titles[index] || `第${index + 1}集`}
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </PageLayout>
  );
}
