import {redirect} from 'next/navigation';
import {createServices} from '../../../server/service/factory';

/**
 * `/records/:id` names a record, whose current version changes over time — a temporary (307)
 * redirect, not permanent. Resolved through the server's own record service (`kb_get_record`),
 * not an HTTP round trip to our own API. On any failure (bad id, database unconfigured, no
 * such record, ...) fall back to the universe rather than surfacing a server error.
 */
export default async function RecordPage({params}: {params: Promise<{recordId: string}>}) {
 const {recordId} = await params;
 let target = '/';
 try {
  const services = createServices();
  const view = await services.repo.getRecord(recordId);
  target = `/versions/${encodeURIComponent(view.version.id)}`;
 } catch {
  target = '/';
 }
 redirect(target);
}
