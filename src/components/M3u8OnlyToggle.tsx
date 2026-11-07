'use client';

import { useId } from 'react';

export default function M3u8OnlyToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const toggleId = useId();
  const descriptionId = `${toggleId}-description`;
  return (
    <div>
      <div className='flex items-center justify-between'>
        <label
          htmlFor={toggleId}
          className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'
        >
          仅保留 M3U8 线路
        </label>
        <button
          id={toggleId}
          type='button'
          role='switch'
          aria-label='仅保留 M3U8 线路'
          aria-checked={enabled}
          aria-describedby={descriptionId}
          onClick={() => onChange(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
            enabled
              ? 'bg-green-600 dark:bg-green-600'
              : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          <span
            aria-hidden='true'
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <p
        id={descriptionId}
        className='mt-1 text-xs text-gray-500 dark:text-gray-400'
      >
        网页和 TVBox 统一只保留可识别的 M3U8 直链，隐藏其他格式及客户端解析站点
      </p>
    </div>
  );
}
