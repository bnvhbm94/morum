import ObjectReader from '../../../../components/object-reader';

export default async function ObjectPage({params}: {params: Promise<{kind: string; id: string}>}) {
 const {kind, id} = await params;
 // The version itself is a planet in the universe; other object kinds (annotation, relation,
 // evidence, review, source) have no place of their own there, so the link stays generic.
 const href = kind === 'version' ? `/?doc=${encodeURIComponent(id)}` : '/';
 return <main className="reading-column">
  <a className="universe-back-link" href={href}>우주에서 보기 →</a>
  <ObjectReader kind={kind} id={id}/>
 </main>;
}
