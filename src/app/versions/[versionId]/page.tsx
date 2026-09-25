import Universe from '../../../components/universe/universe';

/**
 * Roadmap 2.9: ClaimReview data for this version's public reviews is available from the
 * /api/v2/dossier JSON API (see src/server/service/claimreview.ts and
 * src/server/service/handlers/surfaces.ts), but is intentionally NOT embedded as
 * application/ld+json here. Google's ClaimReview eligibility requires the reviewed claim to be
 * attributed to a separate source and at most one ClaimReview per page; our pages review our
 * own anonymous records, so inline markup here would not qualify and could read as a mismatch
 * to anyone diffing the page against Google's guidance. The dossier API remains the source of
 * truth for any consumer (including our own skill.md) that wants this data.
 */
export default async function VersionPage({params}: {params: Promise<{versionId: string}>}) {
 const {versionId} = await params;
 return <>
  <noscript><a href={`/versions/${encodeURIComponent(versionId)}/raw`}>원문 보기</a></noscript>
  <Universe initialDoc={versionId}/>
 </>;
}
