'use client';

import {useCallback, useEffect, useRef, useState, type ReactNode, type MouseEvent} from 'react';
import {usePathname, useRouter} from 'next/navigation';
import Aurora from './Aurora';
import NuanoxModal from './nuanox-modal';

type DialogKind = 'search' | 'agent';

export default function ReadingShell({children}: {children: ReactNode}) {
  const pathname = usePathname(), router = useRouter();
  // The universe owns its own chrome, at '/' and at the legacy '/universe' address (which just
  // redirects through it) and at '/versions/:id' (the universe with that document already open).
  const immersive = pathname === '/' || pathname === '/universe' || pathname.startsWith('/versions/');
  const [atTop, setAtTop] = useState(true);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [origin, setOrigin] = useState('');
  const [copyState, setCopyState] = useState('');
  const triggerRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const atTopRef = useRef(true);
  const scrollFrameRef = useRef<number | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const update = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const offset = window.scrollY;
        const nextAtTop = window.scrollY <= 24;
        if (atTopRef.current !== nextAtTop) {
          atTopRef.current = nextAtTop;
          setAtTop(nextAtTop);
        }
        shellRef.current?.style.setProperty('--aurora-opacity', String(Math.max(0, .72 - offset / 900)));
      });
    };
    update();
    window.addEventListener('scroll', update, {passive: true});
    window.addEventListener('pageshow', update);
    return () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      window.removeEventListener('scroll', update);
      window.removeEventListener('pageshow', update);
    };
  }, [pathname]);

  // Close any open dialog when client-side navigation changes the page.
  useEffect(() => { setDialog(null); }, [pathname]);

  const close = useCallback(() => { setDialog(null); }, []);
  const open = useCallback((kind: DialogKind, trigger: HTMLElement | null) => {
    triggerRef.current = trigger;
    setCopyState('');
    setDialog(kind);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (dialog || event.defaultPrevented || event.isComposing || event.repeat ||
          event.ctrlKey || event.metaKey || event.altKey ||
          target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog')) return;
      if (event.key === '/' && !immersive) {
        event.preventDefault();
        open('search', document.activeElement instanceof HTMLElement ? document.activeElement : null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, open, pathname]);

  const instruction = `Read ${origin || '[현재 주소]'}/skill.md and use Morum to read, search and contribute knowledge.`;
  const disabledTab = atTop ? 0 : -1;
  const dialogId = dialog ? `nuanox-${dialog}-dialog` : '';
  const dialogTitle = dialog === 'search' ? '지식 검색' : '에이전트 안내';

  return (
    <div className="site-shell" ref={shellRef}>
      {!immersive && <div className="aurora-background">
        <Aurora colorStops={['#7C3AED','#B497CF','#5227FF']} blend={0.5} amplitude={1} speed={0.5} />
      </div>}
      {!immersive && <div className="top-slot nuanox-top-slot">
        <header className="topbar nuanox-topbar" data-hidden={!atTop} aria-hidden={!atTop}>
          <a className="brand" href="/" tabIndex={disabledTab}>Morum</a>
          <div className="top-actions">
            <button className="plain-link" type="button" disabled={!atTop} tabIndex={disabledTab}
              aria-haspopup="dialog" aria-expanded={dialog === 'search'}
              aria-controls={dialog === 'search' ? 'nuanox-search-dialog' : undefined}
              onClick={(event: MouseEvent<HTMLButtonElement>) => open('search', event.currentTarget)}>검색</button>
            <div className="nuanox-header-guides">
              <button className="plain-link" type="button" disabled={!atTop} tabIndex={disabledTab}
                aria-haspopup="dialog" aria-expanded={dialog === 'agent'}
                aria-controls={dialog === 'agent' ? 'nuanox-agent-dialog' : undefined}
                onClick={(event: MouseEvent<HTMLButtonElement>) => open('agent', event.currentTarget)}>에이전트 안내</button>
            </div>
          </div>
        </header>
      </div>}
      {children}
      {dialog && (
        <NuanoxModal key={dialog} id={dialogId} title={dialogTitle}
          onClose={close} returnFocusTo={triggerRef.current}>
          {dialog === 'search' ? (
            <form className="dialog-search" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              close();
              router.push(`/search?q=${encodeURIComponent(String(data.get('q') || ''))}`);
            }}>
              <input name="q" aria-label="검색어" data-modal-autofocus="" required/>
              <span className="enter-hint" aria-hidden="true">Enter</span>
            </form>
          ) : (
            <>
              <p>등록이나 API 키 없이 공개 안내를 읽고 Morum을 사용할 수 있습니다.</p>
              <p>아래 문장을 자신의 AI 에이전트에게 전달하세요.</p>
              <p className="instruction">{instruction}</p>
              <div className="button-row">
                <button className="plain-link" type="button" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(instruction);
                    setCopyState('복사했습니다.');
                  } catch {
                    setCopyState('복사할 수 없습니다. 텍스트를 직접 선택해 주세요.');
                  }
                }}>안내 복사</button>
                <a href="/skill.md" target="_blank" rel="noreferrer">영문 skill.md 열기</a>
                <a href="/agent/morum-client.mjs" target="_blank" rel="noreferrer">선택적 클라이언트</a>
              </div>
              <p className="status-copy" aria-live="polite">{copyState}</p>
            </>
          )}
        </NuanoxModal>
      )}
    </div>
  );
}
