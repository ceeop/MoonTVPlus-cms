'use client';

import { ChevronDown, Settings2 } from 'lucide-react';
import { useState } from 'react';

import TVBoxAdmin from '@/components/TVBoxAdmin';

export default function TVBoxManagementSection({ role }: { role: string }) {
  const [expanded, setExpanded] = useState(false);
  if (role !== 'owner' && role !== 'admin') return null;

  return (
    <section className='mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.04]'>
      <details
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary className='flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 rounded-xl text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [&::-webkit-details-marker]:hidden dark:text-slate-100'>
          <span className='flex min-w-0 items-center gap-3'>
            <Settings2
              className='h-5 w-5 shrink-0 text-green-600 dark:text-green-400'
              aria-hidden='true'
            />
            <span className='font-bold'>管理订阅与源文件</span>
          </span>
          <ChevronDown
            className={`h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none ${
              expanded ? 'rotate-180' : ''
            }`}
            aria-hidden='true'
          />
        </summary>
        {expanded && (
          <div className='mt-4 space-y-4'>
            <p className='text-sm leading-6 text-slate-600 dark:text-slate-400'>
              添加或更新外部订阅，下载源文件并选择输出站点。修改后，在 OK
              影视中更新本站订阅。
            </p>
            <TVBoxAdmin />
          </div>
        )}
      </details>
    </section>
  );
}
