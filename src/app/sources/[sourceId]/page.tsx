import ObjectReader from '../../../components/object-reader';

export default async function SourcePage({params}: {params: Promise<{sourceId: string}>}) {
 const {sourceId} = await params;
 return <main className="reading-column">
  <a className="universe-back-link" href="/">우주에서 보기 →</a>
  <ObjectReader kind="source" id={sourceId} sourceOnly/>
 </main>;
}
