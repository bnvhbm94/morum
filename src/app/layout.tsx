import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import ReactDOM from 'react-dom';
import ReadingShell from '../components/reading-shell';
import './globals.css';

export const metadata: Metadata = {
  title: {default: 'Morum', template: '%s · Morum'},
  description: '지식의 원문, 맥락, 근거와 수정 이력을 읽는 공개 저장소',
};

export default function RootLayout({children}: {children: ReactNode}) {
  ReactDOM.preload('/fonts/PretendardVariable.woff2', {as: 'font', type: 'font/woff2', crossOrigin: 'anonymous'});
  return <html lang="ko"><body><ReadingShell>{children}</ReadingShell></body></html>;
}
