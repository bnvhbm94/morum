import SearchResults from '../../components/search-results';
export default async function SearchPage({searchParams}: {searchParams: Promise<{q?: string; scope?: string}>}) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q : '';
  const scope = params.scope === 'all_versions' ? 'all_versions' : 'current';
  return <main className="reading-column"><p className="eyebrow">검색</p><h1 className="page-heading" tabIndex={-1}>{query ? `“${query}”` : '지식 검색'}</h1><SearchResults query={query} scope={scope}/></main>;
}
