import ObjectReader from '../../../components/object-reader';
export default async function SourcePage({params}: {params: Promise<{sourceId: string}>}) { const {sourceId} = await params; return <main className="reading-column"><ObjectReader kind="source" id={sourceId} sourceOnly/></main>; }
