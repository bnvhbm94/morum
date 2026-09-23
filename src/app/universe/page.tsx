import {permanentRedirect} from 'next/navigation';

/** `/universe` is the old address for the front page; keep it working for llms.txt and shared links. */
export default async function UniversePage({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') qs.set(key, value);
    else if (Array.isArray(value)) for (const item of value) qs.append(key, item);
  }
  const suffix = qs.toString();
  permanentRedirect(suffix ? `/?${suffix}` : '/');
}
