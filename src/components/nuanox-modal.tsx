'use client';

import {useEffect, useRef, useState, type ReactNode} from 'react';
import {createPortal} from 'react-dom';

type NuanoxModalProps = {
  id: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
};

export default function NuanoxModal({
  id, title, children, onClose, returnFocusTo,
}: NuanoxModalProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef(returnFocusTo);
  const pressedOutside = useRef(false);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    const node = dialogRef.current;
    if (!portalTarget || !node) return;

    // Keep the old inline values so closing restores the exact scroll settings.
    const html = document.documentElement;
    const body = document.body;
    const saved = [
      [html, 'overflow'],
      [body, 'overflow'],
      [body, 'padding-right'],
    ].map(([element, property]) => {
      const target = element as HTMLElement;
      const name = property as string;
      return {
        target, name,
        value: target.style.getPropertyValue(name),
        priority: target.style.getPropertyPriority(name),
      };
    });
    const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
    const paddingRight = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
    html.style.setProperty('overflow', 'hidden');
    body.style.setProperty('overflow', 'hidden');
    if (scrollbarWidth > 0) {
      body.style.setProperty('padding-right', `${paddingRight + scrollbarWidth}px`);
    }

    // showModal() puts the dialog in the browser top layer and makes the page inert.
    // There is no React `open` prop: only the native modal API opens this element.
    node.showModal();
    (node.querySelector<HTMLElement>('[data-modal-autofocus]') ?? titleRef.current)
      ?.focus({preventScroll: true});

    return () => {
      if (node.open) node.close();
      for (const {target, name, value, priority} of saved) {
        if (value) target.style.setProperty(name, value, priority);
        else target.style.removeProperty(name);
      }
      // Strict Mode can immediately mount another modal. Do not steal its focus.
      requestAnimationFrame(() => {
        if (document.querySelector('dialog[data-nuanox-modal][open]')) return;
        const trigger = returnFocusRef.current;
        if (trigger?.isConnected && trigger.getClientRects().length > 0 &&
            getComputedStyle(trigger).visibility !== 'hidden' &&
            !trigger.matches(':disabled')) {
          trigger.focus({preventScroll: true});
        } else {
          const main = document.querySelector<HTMLElement>('main');
          if (!main) return;
          const hadTabIndex = main.hasAttribute('tabindex');
          if (!hadTabIndex) main.setAttribute('tabindex', '-1');
          main.focus({preventScroll: true});
          if (!hadTabIndex) main.addEventListener('blur', () => {
            main.removeAttribute('tabindex');
          }, {once: true});
        }
      });
    };
  }, [portalTarget]);

  if (!portalTarget) return null;

  const isOutside = (x: number, y: number) => {
    const rect = dialogRef.current?.getBoundingClientRect();
    return !!rect && (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom);
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      id={id}
      className="nuanox-modal"
      data-nuanox-modal=""
      aria-labelledby={`${id}-title`}
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]',
        )).filter((element) =>
          element.tabIndex >= 0 && !element.matches(':disabled, [aria-disabled="true"]') &&
          element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
        );
        const first = items[0], last = items[items.length - 1];
        const active = document.activeElement;
        if (!first || !last) {
          event.preventDefault();
          titleRef.current?.focus({preventScroll: true});
        } else if (event.shiftKey && (active === first || !items.includes(active as HTMLElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !items.includes(active as HTMLElement))) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget &&
          isOutside(event.clientX, event.clientY);
      }}
      onPointerCancel={() => { pressedOutside.current = false; }}
      onClick={(event) => {
        const dismiss = pressedOutside.current &&
          event.target === event.currentTarget &&
          isOutside(event.clientX, event.clientY);
        pressedOutside.current = false;
        if (dismiss) onClose();
      }}
    >
      <div className="nuanox-modal-frame">
        <div className="nuanox-modal-heading">
          <h2 ref={titleRef} id={`${id}-title`} tabIndex={-1}>{title}</h2>
          <button type="button" className="nuanox-modal-close" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="nuanox-modal-body">{children}</div>
      </div>
    </dialog>,
    portalTarget,
  );
}
