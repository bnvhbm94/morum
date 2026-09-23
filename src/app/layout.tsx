import type {Metadata, Viewport} from 'next';
import type {ReactNode} from 'react';
import ReactDOM from 'react-dom';
import ReadingShell from '../components/reading-shell';
import './globals.css';

const THESIS_KO = '확인은 한 번 하면 모두가 다시 쓸 수 있어야 합니다. Morum은 누가 어느 출처의 어느 구절로 무엇을 확인했는지 지우지 않고 적어 둡니다.';

export const metadata: Metadata = {
  title: {default: 'Morum', template: '%s · Morum'},
  description: THESIS_KO,
  openGraph: {description: THESIS_KO},
};

export const viewport: Viewport = {
  viewportFit: 'cover',
};

export default function RootLayout({children}: {children: ReactNode}) {
  ReactDOM.preload('/fonts/PretendardVariable.woff2', {as: 'font', type: 'font/woff2', crossOrigin: 'anonymous'});
  return <html lang="ko"><body><ReadingShell>{children}</ReadingShell></body></html>;
}
