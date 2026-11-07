'use client';

import CatalogWall from '@/components/CatalogWall';
import PageLayout from '@/components/PageLayout';

export default function CatalogPage({
  searchParams,
}: {
  searchParams: { kind?: string; category?: string };
}) {
  return (
    <PageLayout>
      <div className='mx-auto max-w-7xl px-4 pb-10 pt-6 sm:px-8'>
        <CatalogWall
          initialKind={searchParams.kind}
          initialCategory={searchParams.category}
        />
      </div>
    </PageLayout>
  );
}
