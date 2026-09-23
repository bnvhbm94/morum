import {headers} from 'next/headers';
import VersionReader from '../../../components/version-reader';
import type * as T from '../../../contracts/types';
import {uuid} from '../../../domain/validation';
import {createServices} from '../../../server/service/factory';
import {checkedRpc, checkDossier} from '../../../server/service/rpc-shapes';
import {renderClaimReviews, publicOrigin, claimReviewScript, type ClaimReviewJsonLd} from '../../../server/service/claimreview';

/**
 * Roadmap 2.9: server-render ClaimReview JSON-LD for this version's public reviews.
 *
 * VersionReader below is a Client Component: it fetches the version and everything related
 * to it (annotations, relations, evidence, reviews) from the browser via /api/v2, after
 * mount. That is too late for crawlers that read the initial HTML only, so the dossier used
 * for JSON-LD is fetched here instead, server-side, once, directly through the same server
 * service the /api/v2/dossier route uses (`createServices()` + `kb_dossier`) — not an HTTP
 * round trip to our own API. Any failure here (an invalid id, the database being
 * unconfigured, a dependency error, ...) is swallowed and simply omits the script tag;
 * VersionReader's own client-side fetch still renders the page and its own error UI
 * regardless, so this enrichment is additive and never blocks the page.
 */
async function loadClaimReviews(versionId: string): Promise<ClaimReviewJsonLd[] | null> {
 try {
  uuid(versionId);
  const services = createServices();
  const raw = await services.db.call('kb_dossier', {p_query: {target: {kind: 'version', id: versionId}}});
  const dossier = checkedRpc<T.Dossier>(raw, checkDossier);
  const origin = publicOrigin(await requestOrigin());
  return renderClaimReviews(dossier, origin);
 } catch {
  return null;
 }
}

async function requestOrigin(): Promise<string> {
 const h = await headers();
 const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'morum.vercel.app';
 const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
 const proto = h.get('x-forwarded-proto') ?? (isLocal ? 'http' : 'https');
 return `${proto}://${host}`;
}

export default async function VersionPage({params}: {params: Promise<{versionId: string}>}) {
 const {versionId} = await params;
 const claimReviews = await loadClaimReviews(versionId);
 return <>
  {claimReviews && claimReviews.length > 0 &&
   <script type="application/ld+json" dangerouslySetInnerHTML={{__html: claimReviewScript(claimReviews)}}/>}
  <VersionReader kind="version" id={versionId}/>
 </>;
}
