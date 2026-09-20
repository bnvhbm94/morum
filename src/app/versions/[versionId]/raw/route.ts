import {NextRequest} from 'next/server';
export async function GET(request: NextRequest, {params}: {params: Promise<{versionId: string}>}) {
  const {versionId} = await params;
  const upstream = new URL(`/api/v2/versions/${encodeURIComponent(versionId)}/raw`, request.url);
  const response = await fetch(upstream, {cache: 'no-store', headers: {'x-contract-version': '2.1.0'}});
  return new Response(response.body, {status: response.status, headers: {'content-type': response.headers.get('content-type') || 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}});
}
