import VersionReader from '../../../components/version-reader';
export default async function VersionPage({params}: {params: Promise<{versionId: string}>}) { const {versionId} = await params; return <VersionReader kind="version" id={versionId}/>; }
