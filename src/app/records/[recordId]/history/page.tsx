import HistoryView from '../../../../components/history-view';
import {createServices} from '../../../../server/service/factory';

async function currentVersionId(recordId: string): Promise<string | null> {
 try { return (await createServices().repo.getRecord(recordId)).version.id; }
 catch { return null; }
}

export default async function HistoryPage({params}: {params: Promise<{recordId: string}>}) {
 const {recordId} = await params;
 const versionId = await currentVersionId(recordId);
 return <main className="reading-column">
  <a className="universe-back-link" href={versionId ? `/?doc=${encodeURIComponent(versionId)}` : '/'}>우주에서 보기 →</a>
  <p className="eyebrow">기록</p>
  <h1 className="page-heading" tabIndex={-1}>버전 이력</h1>
  <p className="page-intro">같은 부모에서 갈라진 수정도 각각의 버전으로 표시됩니다.</p>
  <nav className="inline-links"><a href={`/records/${encodeURIComponent(recordId)}`}>최신 버전 읽기</a></nav>
  <HistoryView recordId={recordId}/>
 </main>;
}
