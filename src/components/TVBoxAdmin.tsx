'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { cloudDriveReason } from '@/lib/tvbox/cloud-filter';
import type { TVBoxSettings, TVBoxSubscription } from '@/lib/tvbox/types';

const button =
  'min-h-[44px] cursor-pointer rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:cursor-wait disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const input =
  'min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';
const cmsSite = (site: TVBoxSubscription['document']['sites'][number]) =>
  site.type === 1 && /^https?:\/\//i.test(site.api) && !site.playUrl;
type Run = (
  action: string,
  values?: Record<string, unknown>
) => Promise<boolean>;

function Subscription({
  subscription,
  busy,
  run,
  filterCloudDrive,
}: {
  subscription: TVBoxSubscription;
  busy: boolean;
  run: Run;
  filterCloudDrive: boolean;
}) {
  const [selected, setSelected] = useState(
    subscription.selectedSiteKeys ||
      subscription.document.sites.map((site) => site.key)
  );
  const [removing, setRemoving] = useState(false);
  const sites = subscription.document.sites;
  const cmsCount = sites.filter(
    (site) =>
      selected.includes(site.key) &&
      cmsSite(site) &&
      (!filterCloudDrive || !cloudDriveReason(site))
  ).length;
  const filteredCount = sites.filter(
    (site) =>
      selected.includes(site.key) && filterCloudDrive && cloudDriveReason(site)
  ).length;
  const changed =
    JSON.stringify([...selected].sort()) !==
    JSON.stringify(
      [
        ...(subscription.selectedSiteKeys || sites.map((site) => site.key)),
      ].sort()
    );
  return (
    <article className='rounded-xl border border-gray-200 p-4 dark:border-gray-700'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <h3 className='font-semibold text-gray-900 dark:text-gray-100'>
            {subscription.name}
          </h3>
          <p className='mt-1 text-sm text-gray-600 [overflow-wrap:anywhere] dark:text-gray-400'>
            {subscription.url}
          </p>
          <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
            {subscription.enabled ? '已启用' : '已停用'} · {sites.length} 个站点
            · 更新于 {new Date(subscription.updatedAt).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            className={button}
            disabled={busy}
            onClick={() =>
              void run('update', {
                id: subscription.id,
                enabled: !subscription.enabled,
              })
            }
          >
            {subscription.enabled ? '停用' : '启用'}
          </button>
          <button
            type='button'
            className={button}
            disabled={busy}
            onClick={() => void run('refresh', { id: subscription.id })}
          >
            更新订阅
          </button>
          <button
            type='button'
            className={button}
            disabled={busy}
            onClick={() => void run('mirror', { id: subscription.id })}
          >
            下载源文件
          </button>
          <button
            type='button'
            className={button}
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            移除
          </button>
        </div>
      </div>
      <p className='mt-3 text-sm text-gray-600 dark:text-gray-400'>
        本地源文件：{subscription.assets?.length || 0} 个
        {subscription.assets?.length
          ? ` · ${(
              subscription.assets.reduce((sum, asset) => sum + asset.size, 0) /
              1024 /
              1024
            ).toFixed(1)} MiB`
          : ' · 尚未下载'}
        {filteredCount > 0 ? ` · 默认过滤 ${filteredCount} 个网盘接口` : ''}
      </p>
      {!!subscription.assetErrors?.length && (
        <details className='mt-2 text-sm text-amber-800 dark:text-amber-300'>
          <summary className='cursor-pointer py-2'>
            有 {subscription.assetErrors.length}{' '}
            个文件下载失败，点击“下载源文件”重试
          </summary>
          <ul className='space-y-2 [overflow-wrap:anywhere]'>
            {subscription.assetErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </details>
      )}
      {removing && (
        <div className='mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800'>
          <p className='text-sm'>
            移除“{subscription.name}”？已导入的视频源会保留。
          </p>
          <button
            type='button'
            className={button}
            disabled={busy}
            onClick={() => void run('remove', { id: subscription.id })}
          >
            确认移除
          </button>
          <button
            type='button'
            className={button}
            onClick={() => setRemoving(false)}
          >
            取消
          </button>
        </div>
      )}
      <details className='mt-4'>
        <summary className='min-h-[44px] cursor-pointer rounded-lg py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500'>
          站点选择（{selected.length} / {sites.length}）
        </summary>
        <fieldset disabled={busy} className='mt-2 space-y-3'>
          <legend className='sr-only'>{subscription.name}的站点选择</legend>
          <div className='flex flex-wrap gap-2'>
            <button
              type='button'
              className={button}
              onClick={() => setSelected(sites.map((site) => site.key))}
            >
              全选
            </button>
            <button
              type='button'
              className={button}
              onClick={() => setSelected([])}
            >
              取消全选
            </button>
          </div>
          <div className='grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2'>
            {sites.map((site) => (
              <label
                key={site.key}
                className='flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700'
              >
                <input
                  type='checkbox'
                  className='h-4 w-4 shrink-0 accent-green-600'
                  checked={selected.includes(site.key)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, site.key]
                        : current.filter((key) => key !== site.key)
                    )
                  }
                />
                <span className='min-w-0 text-sm [overflow-wrap:anywhere]'>
                  <span className='block font-medium'>{site.name}</span>
                  <span className='text-gray-600 dark:text-gray-400'>
                    {filterCloudDrive && cloudDriveReason(site)
                      ? '网盘接口 · 已过滤'
                      : cmsSite(site)
                      ? 'CMS · 可加入片库采集'
                      : '客户端站点'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className='flex flex-wrap gap-2'>
            <button
              type='button'
              className={button}
              disabled={!changed}
              onClick={() =>
                void run('update', {
                  id: subscription.id,
                  selectedSiteKeys: selected,
                })
              }
            >
              保存站点选择
            </button>
            <button
              type='button'
              className={button}
              disabled={!cmsCount || changed}
              onClick={() => void run('import-cms', { id: subscription.id })}
            >
              导入 {cmsCount} 个 CMS 视频源
            </button>
          </div>
          <p className='text-sm text-gray-600 dark:text-gray-400'>
            CMS 源导入后，在本地片库中选择采集源并绑定分类。客户端站点由 OK
            影视等客户端加载和搜索。
          </p>
        </fieldset>
      </details>
    </article>
  );
}

export default function TVBoxAdmin() {
  const id = useId();
  const [settings, setSettings] = useState<TVBoxSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch('/api/admin/tvbox', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '加载 TVBox 配置失败');
        if (!alive) return;
        setSettings(data.settings);
        setEnabled(data.enabled);
        setCatalogEnabled(data.catalogEnabled);
        setError('');
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadAttempt]);

  const run: Run = async (action, values = {}) => {
    setBusy(action);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/admin/tvbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...values }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      setSettings(data.settings);
      setMessage(data.message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  };

  return (
    <div className='space-y-5 text-gray-900 dark:text-gray-100'>
      {error && (
        <div
          role='alert'
          className='rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200'
        >
          {error}
          {!settings && (
            <button
              type='button'
              className={`${button} ml-3`}
              onClick={() => setLoadAttempt((current) => current + 1)}
            >
              重新加载
            </button>
          )}
        </div>
      )}
      <div
        role='status'
        aria-live='polite'
        className='text-sm text-green-700 dark:text-green-400'
      >
        {busy
          ? busy === 'add' || busy === 'refresh' || busy === 'mirror'
            ? '正在读取订阅或下载源文件…'
            : '正在保存…'
          : message}
      </div>
      {!settings ? (
        <p className='text-sm text-gray-600 dark:text-gray-400'>
          正在加载配置…
        </p>
      ) : (
        <>
          <section className='rounded-xl border border-gray-200 p-4 dark:border-gray-700'>
            {!enabled && (
              <p className='mb-3 text-sm text-amber-800 dark:text-amber-300'>
                TVBox 订阅尚未开启，请设置环境变量 ENABLE_TVBOX_SUBSCRIBE=true
                后重启服务。
              </p>
            )}
            <label className='flex min-h-[44px] cursor-pointer items-center gap-3 font-medium'>
              <input
                type='checkbox'
                className='h-4 w-4 accent-green-600'
                checked={settings.CatalogEnabled}
                disabled={!!busy}
                onChange={(event) =>
                  void run('catalog', { enabled: event.target.checked })
                }
              />
              本地片库首页
            </label>
            <p className='mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400'>
              首页按作品归并，详情中展示各来源和播放线路。电影分类、年份、地区和本地海报沿用片库设置。
            </p>
            {!catalogEnabled && (
              <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
                请先在{' '}
                <Link
                  className='text-green-700 underline dark:text-green-400'
                  href='/admin?section=catalog'
                >
                  本地片库
                </Link>{' '}
                中启用并采集内容。
              </p>
            )}
          </section>
          <section
            className='space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700'
            aria-label='外部源设置'
          >
            <div>
              <label className='flex min-h-[44px] cursor-pointer items-center gap-3 font-medium'>
                <input
                  type='checkbox'
                  className='h-4 w-4 accent-green-600'
                  checked={settings.LocalAssetsEnabled !== false}
                  disabled={!!busy}
                  onChange={(event) =>
                    void run('options', {
                      LocalAssetsEnabled: event.target.checked,
                    })
                  }
                />
                本地保存源文件
              </label>
              <p className='mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400'>
                导入、更新时下载
                JAR、脚本和可识别的静态配置，由本站提供给电视端。已有订阅可点击“下载源文件”；影片播放仍需联网。
              </p>
            </div>
            <div>
              <label className='flex min-h-[44px] cursor-pointer items-center gap-3 font-medium'>
                <input
                  type='checkbox'
                  className='h-4 w-4 accent-green-600'
                  checked={settings.FilterCloudDrive !== false}
                  disabled={!!busy}
                  onChange={(event) =>
                    void run('options', {
                      FilterCloudDrive: event.target.checked,
                    })
                  }
                />
                默认过滤网盘接口
              </label>
              <p className='mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400'>
                作为本站订阅的默认设置。当前订阅链接可使用上方开关单独选择；其他站点可在站点选择中手动取消勾选。
              </p>
            </div>
          </section>
          <form
            className='space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-700'
            onSubmit={(event) => {
              event.preventDefault();
              void run('add', { name, url }).then((success) => {
                if (success) {
                  setName('');
                  setUrl('');
                }
              });
            }}
          >
            <h3 className='font-semibold'>添加外部订阅</h3>
            <div className='grid gap-4 md:grid-cols-[1fr_2fr]'>
              <div>
                <label
                  htmlFor={`${id}-name`}
                  className='mb-2 block text-sm font-medium'
                >
                  订阅名称
                </label>
                <input
                  id={`${id}-name`}
                  className={input}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  required
                  disabled={!!busy}
                />
              </div>
              <div>
                <label
                  htmlFor={`${id}-url`}
                  className='mb-2 block text-sm font-medium'
                >
                  订阅地址
                </label>
                <input
                  id={`${id}-url`}
                  className={input}
                  type='url'
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder='https://example.com/tvbox.json'
                  required
                  disabled={!!busy}
                  aria-describedby={`${id}-help`}
                />
              </div>
            </div>
            <p
              id={`${id}-help`}
              className='text-sm leading-6 text-gray-600 dark:text-gray-400'
            >
              支持 JSON、图片封装 Base64 和常见 TVBox
              编码。添加后默认启用订阅，按网盘过滤和站点选择输出；可展开站点列表调整范围。
            </p>
            <button
              className={`${button} bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:text-white dark:hover:bg-green-700`}
              disabled={!!busy || !name.trim() || !url.trim()}
              type='submit'
            >
              {busy === 'add' ? '正在添加…' : '添加订阅'}
            </button>
          </form>
          <section aria-label='外部订阅列表' className='space-y-3'>
            {!settings.Subscriptions.length ? (
              <p className='rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400'>
                尚未添加外部订阅。添加后会与本站片库和视频源一起提供给 TVBox。
              </p>
            ) : (
              settings.Subscriptions.map((subscription) => (
                <Subscription
                  key={`${subscription.id}:${
                    subscription.updatedAt
                  }:${JSON.stringify(subscription.selectedSiteKeys)}`}
                  subscription={subscription}
                  busy={!!busy}
                  run={run}
                  filterCloudDrive={settings.FilterCloudDrive !== false}
                />
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
