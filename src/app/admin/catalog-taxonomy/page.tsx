import CatalogTaxonomyAdmin from '@/components/CatalogTaxonomyAdmin';
import PageLayout from '@/components/PageLayout';

export default function CatalogTaxonomyPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab = searchParams.tab === 'bindings' ? searchParams.tab : 'categories';
  return (
    <PageLayout activePath='/admin'>
      <div className='mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-8'>
        <CatalogTaxonomyAdmin initialTab={tab} />
      </div>
    </PageLayout>
  );
}
