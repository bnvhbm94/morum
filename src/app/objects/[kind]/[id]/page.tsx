import ObjectReader from '../../../../components/object-reader';
export default async function ObjectPage({params}: {params: Promise<{kind: string; id: string}>}) { const {kind, id} = await params; return <main className="reading-column"><ObjectReader kind={kind} id={id}/></main>; }
