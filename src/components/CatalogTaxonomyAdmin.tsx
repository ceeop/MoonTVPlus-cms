'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { CatalogSettings } from '@/lib/catalog/model';
import { useCatalogAutosave } from '@/hooks/useCatalogAutosave';

import CatalogCategoriesEditor from './CatalogCategoriesEditor';

const taxonomyValue = (settings: CatalogSettings) =>
  JSON.stringify([
    settings.Categories,
    settings.CategoryBindings,
    settings.SourceCategories,
  ]);

export default function CatalogTaxonomyAdmin({
  initialTab = 'categories',
}: {
  initialTab?: 'categories' | 'bindings';
}) {
  const [settings, setSettings] = useState<CatalogSettings | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  const [sources, setSources] = useState<Array<{ key: string; name: string }>>(
    []
  );
  const [saved, setSaved] = useState('');
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState(true);
  const [reading, setReading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/catalog', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '分类设置加载失败');
      setSettings(data.settings);
      setSources(data.sources);
      setRevision(data.taxonomyRevision);
      setSaved(taxonomyValue(data.settings));
      setEditing(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const autosave = useCatalogAutosave({
    settings,
    savedValue: saved,
    valueOf: taxonomyValue,
    paused: busy || reading,
    action: 'save-taxonomy',
    revision,
    onSaved: (data, submitted) => {
      setSettings((current) =>
        current && taxonomyValue(current) !== taxonomyValue(submitted)
          ? {
              ...data.settings,
              Categories: current.Categories,
              CategoryBindings: current.CategoryBindings,
              SourceCategories: current.SourceCategories,
            }
          : data.settings
      );
      setRevision(data.taxonomyRevision);
      setSaved(taxonomyValue(data.settings));
    },
  });
  return (
    <div className='space-y-5'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
            分类管理
          </h1>
          <p className='mt-2 text-sm text-gray-600 dark:text-gray-300'>
            统一管理分类及各源分类对应关系。
          </p>
        </div>
        <Link
          href='/admin?section=catalog'
          className='inline-flex min-h-[44px] items-center text-sm text-green-700 underline dark:text-green-400'
        >
          返回采集设置
        </Link>
      </div>
      {(error || autosave.error) && (
        <p
          role='alert'
          className='rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200'
        >
          {error || autosave.error}
          {autosave.error && (
            <button
              type='button'
              onClick={autosave.retry}
              className='ml-3 min-h-[44px] underline'
            >
              重试保存
            </button>
          )}
        </p>
      )}
      {!settings ? (
        <p className='text-sm text-gray-600 dark:text-gray-300'>
          {busy
            ? '正在加载设置…'
            : '无法读取设置，请确认当前账号拥有管理权限。'}
        </p>
      ) : (
        <>
          <p
            role='status'
            aria-live='polite'
            className='text-sm text-gray-600 dark:text-gray-300'
          >
            {autosave.error
              ? '更改尚未保存。'
              : autosave.saving
              ? '正在自动保存…'
              : autosave.dirty
              ? '等待自动保存…'
              : editing
              ? '确定编辑后将自动保存。'
              : '所有更改已自动保存。'}
          </p>
          <CatalogCategoriesEditor
            settings={settings}
            setSettings={(value) =>
              setSettings((current) =>
                current
                  ? typeof value === 'function'
                    ? value(current)
                    : value
                  : current
              )
            }
            sources={sources}
            disabled={busy}
            onBusyChange={setReading}
            onEditingChange={setEditing}
            initialTab={activeTab}
            onTabChange={setActiveTab}
          />
        </>
      )}
    </div>
  );
}
