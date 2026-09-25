import type {Metadata} from 'next';
import ObjectReader from '../../../components/object-reader';

// Source pages render a contributor-submitted excerpt (submitted_text) of third-party text,
// which we do not want indexed on our behalf.
export const metadata: Metadata = {robots: {index: false, follow: true}};

export default async function SourcePage({params}: {params: Promise<{sourceId: string}>}) {
 const {sourceId} = await params;
 return <main className="reading-column">
  <a className="universe-back-link" href="/">우주에서 보기 →</a>
  <ObjectReader kind="source" id={sourceId} sourceOnly/>
 </main>;
}
