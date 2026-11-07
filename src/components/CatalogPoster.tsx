'use client';

import { Film } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  className?: string;
}

function PosterImage({ src, alt, className = '' }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retrying = !!src && failed && attempt < 2;

  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(() => {
      setAttempt((value) => value + 1);
      setFailed(false);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [retrying, attempt]);

  const imageSrc = attempt
    ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`
    : src;
  return (
    <div className={`relative h-full w-full ${className}`}>
      {src && (!failed || retrying) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageSrc}
          alt={alt}
          width={300}
          height={450}
          loading='lazy'
          decoding='async'
          className={`h-full w-full object-cover ${failed ? 'invisible' : ''}`}
          onError={() => setFailed(true)}
        />
      )}
      {(!src || failed) && (
        <div
          role='img'
          aria-label={`${alt}：${retrying ? '正在重试封面' : '封面暂不可用'}`}
          className='absolute inset-0 flex flex-col items-center justify-center gap-3 px-3 text-center text-gray-600 dark:text-gray-300'
        >
          <Film size={32} aria-hidden='true' />
          <span className='text-xs'>
            {retrying ? '正在重试封面…' : '封面暂不可用'}
          </span>
        </div>
      )}
    </div>
  );
}

export default function CatalogPoster(props: Props) {
  return <PosterImage key={props.src} {...props} />;
}
