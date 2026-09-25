import type {Metadata} from 'next';
import ObjectReader from '../../../../components/object-reader';

// Only the 'source' object kind renders a contributor-submitted excerpt (submitted_text) of
// third-party text; keep that out of indexes while record/version and other object kinds stay indexable.
export async function generateMetadata({params}: {params: Promise<{kind: string; id: string}>}): Promise<Metadata> {
 const {kind} = await params;
 return kind === 'source' ? {robots: {index: false, follow: true}} : {};
}

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
