import VersionReader from '../../../components/version-reader';
export default async function RecordPage({params}: {params: Promise<{recordId: string}>}) { const {recordId} = await params; return <VersionReader kind="record" id={recordId}/>; }
