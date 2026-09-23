import {permanentRedirect} from 'next/navigation';

/** The universe is the one search entry point; `/search` only ever forwards into it. */
export default async function SearchPage({searchParams}: {searchParams: Promise<{q?: string}>}) {
  const {q} = await searchParams;
  const query = typeof q === 'string' ? q.trim() : '';
  permanentRedirect(query ? `/?q=${encodeURIComponent(query)}` : '/');
}
