import type {Metadata} from 'next';
import Universe from '../../components/universe/universe';

export const metadata: Metadata = {title: 'Morum — universe'};

export default function UniversePage() {
  return <Universe />;
}
