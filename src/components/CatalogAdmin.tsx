'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { activeCatalogBindings } from '@/lib/catalog/category-config';
import type {
  CatalogKind,
  CatalogSettings,
  SyncState,
} from '@/lib/catalog/model';
import type { CatalogCleanup } from '@/lib/catalog/store';
import { useCatalogAutosave } from '@/hooks/useCatalogAutosave';

import CatalogCollectionSelection from '@/components/CatalogCollectionSelection';

interface SourceStatus {
  source: string;
  state: SyncState;
  running: boolean;
  count: number;
}
interface Source {
  key: string;
  name: string;
  disabled?: boolean;
}
const button =
  'min-h-[44px] rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const kinds: Array<{ value: CatalogKind; label: string }> = [
  { value: 'movie', label: '电影' },
  { value: 'tv', label: '电视剧 / 短剧' },
  { value: 'anime', label: '动漫' },
  { value: 'variety', label: '综艺' },
  { value: 'other', label: '其他 / 未分类' },
];
const collectionValue = (settings: CatalogSettings) =>
  JSON.stringify([
    settings.Enabled,
    settings.SourceKeys,
    settings.DefaultSourceKey || settings.SourceKeys[0] || '',
    settings.IntervalMinutes,
    settings.CleanupEnabled !== false,
    settings.RetentionMonths ?? 6,
    settings.Kinds,
    settings.CollectionCategoryIds,
  ]);

export default function CatalogAdmin() {
  const cleanupId = useId();
  const [settings, setSettings] = useState<CatalogSettings>({
    Enabled: false,
    SourceKeys: [],
    IntervalMinutes: 30,
    CleanupEnabled: true,
    RetentionMonths: 6,
    Kinds: kinds.map((kind) => kind.value),
  });
  const [savedSettings, setSavedSettings] = useState('');
  const [savedDefaultSource, setSavedDefaultSource] = useState('');
  const latest = useRef({ settings, savedSettings });
  latest.current = { settings, savedSettings };
  const [cleanup, setCleanup] = useState<CatalogCleanup | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [states, setStates] = useState<SourceStatus[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [ready, setReady] = useState(false);
  const loadEpoch = useRef(0);
  const load = useCallback(async (initial = false) => {
    const epoch = loadEpoch.current;
    try {
      const response = await fetch('/api/admin/catalog', { cache: 'no-store' });
      const data = await response.json();
      if (epoch !== loadEpoch.current) return;
      if (!response.ok) throw new Error(data.error || '加载片库配置失败');
      if (
        initial ||
        collectionValue(latest.current.settings) ===
          latest.current.savedSettings
      ) {
        setSettings(data.settings);
        setSavedSettings(collectionValue(data.settings));
        setSavedDefaultSource(
          data.settings.DefaultSourceKey || data.settings.SourceKeys[0] || ''
        );
      } else
        setSettings((current) => ({
          ...current,
          Categories: data.settings.Categories,
          CategoryBindings: data.settings.CategoryBindings,
          SourceCategories: data.settings.SourceCategories,
          ...(current.CollectionCategoryIds !== undefined &&
          data.settings.Categories !== undefined
            ? {
                CollectionCategoryIds: current.CollectionCategoryIds.filter(
                  (id) =>
                    data.settings.Categories.some(
                      (category: { id: string }) => category.id === id
                    )
                ),
              }
            : {}),
        }));
      setSources(data.sources);
      setStates(data.states);
      setCleanup(data.cleanup);
      setReady(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load(true);
    const timer = setInterval(() => {
      void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [load]);
  const submit = async (action: string, source?: string) => {
    setBusy(source || action);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, scope: 'collection', settings, source }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作失败');
      setMessage(
        action === 'cleanup'
          ? data.message
          : `${data.message}，后台将继续处理剩余页面。`
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const retentionMonths = settings.RetentionMonths ?? 6;
  const invalidRetention =
    !Number.isInteger(retentionMonths) ||
    retentionMonths < 1 ||
    retentionMonths > 120;
  const invalidSelection =
    invalidRetention ||
    settings.IntervalMinutes < 5 ||
    settings.IntervalMinutes > 1440 ||
    (settings.Enabled &&
      (!settings.SourceKeys.length ||
        (settings.Categories === undefined
          ? !settings.Kinds.length
          : settings.Categories.some((category) => !category.name.trim()) ||
            ((!settings.DefaultSourceKey ||
              settings.DefaultSourceKey === savedDefaultSource) &&
              !activeCatalogBindings(settings).some((binding) =>
                settings.SourceKeys.includes(binding.sourceKey)
              )))));
  const autosave = useCatalogAutosave({
    settings: ready ? settings : null,
    savedValue: savedSettings,
    valueOf: collectionValue,
    paused: !!busy || invalidSelection,
    action: 'save',
    onSaved: (data, submitted) => {
      loadEpoch.current++;
      setSettings((current) =>
        collectionValue(current) === collectionValue(submitted)
          ? data.settings
          : {
              ...data.settings,
              Enabled: current.Enabled,
              SourceKeys: current.SourceKeys,
              DefaultSourceKey: current.DefaultSourceKey,
              IntervalMinutes: current.IntervalMinutes,
              CleanupEnabled: current.CleanupEnabled,
              RetentionMonths: current.RetentionMonths,
              Kinds: current.Kinds,
              CollectionCategoryIds: current.CollectionCategoryIds,
            }
      );
      setSavedSettings(collectionValue(data.settings));
      setSavedDefaultSource(
        data.settings.DefaultSourceKey || data.settings.SourceKeys[0] || ''
      );
    },
  });
  const dirty = autosave.dirty || autosave.saving;
  return (
    <div className='space-y-5'>
      <p className='text-sm leading-6 text-gray-600 dark:text-gray-300'>
        定时收录当天更新的影片信息，首页展示海报墙，搜索和详情从本地片库读取。首次建议选择少量稳定的标准
        CMS 源；视频仍由原有播放地址提供。
      </p>
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
      {message && (
        <p
          role='status'
          className='rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200'
        >
          {message}
        </p>
      )}
      <label className='flex min-h-[44px] items-center gap-3 text-sm text-gray-900 dark:text-gray-100'>
        <input
          type='checkbox'
          disabled={!ready || !!busy}
          checked={settings.Enabled}
          onChange={(e) =>
            setSettings((s) => ({ ...s, Enabled: e.target.checked }))
          }
          className='h-5 w-5 accent-green-600'
        />
        启用本地片库和首页海报墙
      </label>
      <label className='flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200'>
        增量更新间隔（分钟）
        <input
          type='number'
          disabled={!ready || !!busy}
          min={5}
          max={1440}
          value={settings.IntervalMinutes}
          onChange={(e) =>
            setSettings((s) => ({
              ...s,
              IntervalMinutes: Number(e.target.value),
            }))
          }
          className='min-h-[44px] w-24 rounded-lg border border-gray-300 bg-transparent px-3 dark:border-gray-600'
        />
      </label>
      {settings.Categories === undefined && (
        <fieldset aria-describedby='catalog-kinds-hint' disabled={!!busy}>
          <legend className='mb-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
            采集类型（已选 {settings.Kinds.length} 种）
          </legend>
          <div className='flex flex-wrap gap-x-6 gap-y-2'>
            {kinds.map((kind) => (
              <label
                key={kind.value}
                className='flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-gray-700 dark:text-gray-200'
              >
                <input
                  type='checkbox'
                  checked={settings.Kinds.includes(kind.value)}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      Kinds: e.target.checked
                        ? [...s.Kinds, kind.value]
                        : s.Kinds.filter((value) => value !== kind.value),
                    }))
                  }
                  className='h-5 w-5 accent-green-600'
                />
                {kind.label}
              </label>
            ))}
          </div>
          <p
            id='catalog-kinds-hint'
            className='mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300'
          >
            只收录所选源中的这些类型，搜索结果入库也遵守此设置。修改后自动保存；新增类型会重新采集当天更新，取消的类型立即从片库隐藏。
          </p>
          {settings.Enabled && !settings.Kinds.length && (
            <p
              role='alert'
              className='mt-2 text-sm text-red-700 dark:text-red-300'
            >
              请至少选择一种采集类型。
            </p>
          )}
        </fieldset>
      )}
      <fieldset className='min-w-0'>
        <legend className='mb-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
          采集源（已选 {settings.SourceKeys.length} 个）
        </legend>
        <div className='grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-x-6 gap-y-1'>
          {sources.map((source) => (
            <label
              key={source.key}
              className='flex min-h-[44px] min-w-0 cursor-pointer items-center gap-3 text-sm text-gray-700 dark:text-gray-200'
            >
              <input
                type='checkbox'
                disabled={
                  !!busy ||
                  (source.disabled && !settings.SourceKeys.includes(source.key))
                }
                checked={settings.SourceKeys.includes(source.key)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSettings((s) => {
                    const keys = checked
                      ? [...s.SourceKeys, source.key]
                      : s.SourceKeys.filter((key) => key !== source.key);
                    return {
                      ...s,
                      SourceKeys: keys,
                      DefaultSourceKey: keys.includes(s.DefaultSourceKey || '')
                        ? s.DefaultSourceKey
                        : keys[0] || '',
                    };
                  });
                }}
                className='h-5 w-5 shrink-0 accent-green-600'
              />
              <span className='min-w-0 [overflow-wrap:anywhere]'>
                {source.name}
                {source.disabled ? '（已停用）' : ''}
              </span>
            </label>
          ))}
        </div>
        {ready && !sources.length && (
          <p className='py-3 text-sm text-gray-600 dark:text-gray-300'>
            请先在“视频源配置”中添加标准 CMS 源。
          </p>
        )}
      </fieldset>
      <div className='space-y-2'>
        <label
          htmlFor='catalog-default-source'
          className='block text-sm font-medium text-gray-900 dark:text-gray-100'
        >
          默认源
        </label>
        <select
          id='catalog-default-source'
          aria-describedby='catalog-default-source-hint'
          disabled={!!busy || !ready || !settings.SourceKeys.length}
          value={settings.DefaultSourceKey || settings.SourceKeys[0] || ''}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              DefaultSourceKey: event.target.value,
            }))
          }
          className='min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 disabled:opacity-50 sm:max-w-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'
        >
          {!settings.SourceKeys.length && (
            <option value=''>请先选择采集源</option>
          )}
          {sources
            .filter((source) => settings.SourceKeys.includes(source.key))
            .map((source) => (
              <option
                key={source.key}
                value={source.key}
                disabled={source.disabled}
              >
                {source.name}
                {source.disabled ? '（已停用）' : ''}
              </option>
            ))}
        </select>
        <p
          id='catalog-default-source-hint'
          className='text-sm leading-6 text-gray-600 dark:text-gray-300'
        >
          选择后自动同步该源的分类，并优先采集。同一影片优先使用它的海报、简介等信息，没有收录的影片由其他采集源补充。
        </p>
      </div>
      {ready && settings.Categories !== undefined ? (
        <CatalogCollectionSelection
          settings={settings}
          setSettings={setSettings}
          disabled={!!busy}
        />
      ) : (
        <Link
          href='/admin/catalog-taxonomy'
          className='inline-flex min-h-[44px] items-center text-sm text-green-700 underline dark:text-green-400'
        >
          设置分类与源分类绑定
        </Link>
      )}
      <section
        className='rounded-xl border border-gray-200 p-4 dark:border-gray-700'
        aria-labelledby={`${cleanupId}-heading`}
      >
        <div className='flex items-center justify-between gap-4'>
          <h3
            id={`${cleanupId}-heading`}
            className='font-medium text-gray-900 dark:text-gray-100'
          >
            定时清理
          </h3>
          <button
            type='button'
            role='switch'
            aria-checked={settings.CleanupEnabled !== false}
            aria-labelledby={`${cleanupId}-heading`}
            disabled={!!busy || !ready}
            onClick={() =>
              setSettings((current) => ({
                ...current,
                CleanupEnabled: current.CleanupEnabled === false,
              }))
            }
            className='inline-flex min-h-[44px] items-center gap-2 rounded-lg text-sm text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-600 disabled:opacity-50 dark:text-gray-200'
          >
            <span>
              {settings.CleanupEnabled !== false ? '已开启' : '已关闭'}
            </span>
            <span
              aria-hidden='true'
              className={`flex h-6 w-11 shrink-0 items-center rounded-full transition-colors motion-reduce:transition-none ${
                settings.CleanupEnabled !== false
                  ? 'bg-green-600'
                  : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`h-4 w-4 rounded-full bg-white transition-transform motion-reduce:transition-none ${
                  settings.CleanupEnabled !== false
                    ? 'translate-x-6'
                    : 'translate-x-1'
                }`}
              />
            </span>
          </button>
        </div>
        <label
          htmlFor={`${cleanupId}-months`}
          className='mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-200'
        >
          保留时长
          <input
            id={`${cleanupId}-months`}
            type='number'
            min={1}
            max={120}
            step={1}
            value={retentionMonths}
            disabled={!!busy || !ready}
            aria-invalid={invalidRetention}
            aria-describedby={
              invalidRetention ? `${cleanupId}-error` : undefined
            }
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                RetentionMonths: Number(event.target.value),
              }))
            }
            className='min-h-[44px] w-24 rounded-lg border border-gray-300 bg-transparent px-3 dark:border-gray-600'
          />
          <span>个月</span>
        </label>
        {invalidRetention && (
          <p
            id={`${cleanupId}-error`}
            role='alert'
            className='mt-2 text-sm text-red-700 dark:text-red-300'
          >
            请输入 1–120 的整数月数。
          </p>
        )}
        <p className='mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300'>
          按最近入库或更新计算，每天清理一次。
        </p>
        <p className='mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300'>
          {cleanup
            ? `最近清理：${new Date(cleanup.lastRun).toLocaleString('zh-CN')}`
            : '尚未执行清理'}
        </p>
        <button
          disabled={!!busy || !ready || dirty || invalidSelection}
          onClick={() => submit('cleanup')}
          className={`${button} mt-3`}
        >
          {busy === 'cleanup' ? '清理中…' : '立即清理'}
        </button>
      </section>
      <div className='flex flex-wrap gap-3'>
        <Link href='/catalog' className={button}>
          查看海报墙
        </Link>
      </div>
      {ready && (
        <p
          role='status'
          aria-live='polite'
          className='text-sm text-gray-600 dark:text-gray-300'
        >
          {autosave.error
            ? '更改尚未保存。'
            : invalidSelection
            ? '请检查设置，填写完整后将自动保存。'
            : autosave.saving
            ? settings.DefaultSourceKey !== savedDefaultSource ||
              settings.Categories === undefined
              ? '正在自动保存并同步默认源分类…'
              : '正在自动保存…'
            : autosave.dirty
            ? '等待自动保存…'
            : '所有设置已自动保存。'}
        </p>
      )}
      <p className='text-xs leading-5 text-gray-600 dark:text-gray-400'>
        按北京时间采集当天 0 点起更新的资源，每轮从第 1
        页开始，分批采集当天更新并保存进度，跨天后重新开始。常驻服务器自动调度；无常驻进程的部署需配置定时调用，详见
        README 的本地片库说明。
      </p>
      <div className='space-y-3'>
        {sources
          .filter((source) => settings.SourceKeys.includes(source.key))
          .map((source) => {
            const entry = states.find((state) => state.source === source.key);
            const state = entry?.state;
            return (
              <div
                key={source.key}
                className='rounded-xl border border-gray-200 p-4 dark:border-gray-700'
              >
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <h3 className='break-words font-medium text-gray-900 dark:text-gray-100'>
                      {source.name}
                    </h3>
                    <p className='mt-1 text-sm text-gray-600 dark:text-gray-300'>
                      {entry?.count || 0} 条资源 ·{' '}
                      {entry?.running
                        ? '正在采集当天更新'
                        : state?.error
                        ? '等待重试'
                        : state?.fullDone && state.nextPage === 1
                        ? '当天更新已采集，等待下轮同步'
                        : state
                        ? `当天更新：下次采集第 ${state.nextPage} 页`
                        : '等待采集当天更新'}
                    </p>
                    <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                      最近成功：
                      {state?.lastSuccess
                        ? new Date(state.lastSuccess).toLocaleString('zh-CN')
                        : '尚未完成当天采集'}
                    </p>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <button
                      className={button}
                      disabled={
                        !!busy || !settings.Enabled || source.disabled || dirty
                      }
                      onClick={() => submit('collect', source.key)}
                    >
                      {busy === source.key ? '处理中…' : '立即同步'}
                    </button>
                    <button
                      className={button}
                      disabled={
                        !!busy || !settings.Enabled || source.disabled || dirty
                      }
                      onClick={() => submit('rebuild', source.key)}
                    >
                      重新采集当天
                    </button>
                  </div>
                </div>
                {state?.error && (
                  <p className='mt-2 break-words text-sm text-red-700 dark:text-red-300'>
                    {state.error}
                  </p>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
