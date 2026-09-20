'use client';
import React, {useEffect, useRef, useState, type HTMLAttributes, type ReactNode} from 'react';
interface MagnetProps extends HTMLAttributes<HTMLDivElement> { children: ReactNode; padding?: number; disabled?: boolean; magnetStrength?: number; maxTravel?: number; }
/** Adapted from ReactBits Magnet. Source: https://reactbits.dev/r/Magnet-TS-CSS.json (inspected 2026-09-20). */
export default function Magnet({children, padding = 12, disabled = false, magnetStrength = 14, maxTravel = 1.6, ...props}: MagnetProps) {
  const [position, setPosition] = useState({x: 0, y: 0});
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (disabled || !finePointer.matches || reducedMotion.matches) { setPosition({x: 0, y: 0}); return; }
    const reset = () => setPosition({x: 0, y: 0});
    const move = (event: PointerEvent) => {
      const node = ref.current;
      if (!node || event.pointerType !== 'mouse') return reset();
      const {left, top, width, height} = node.getBoundingClientRect();
      const centerX = left + width / 2, centerY = top + height / 2;
      if (Math.abs(centerX - event.clientX) >= width / 2 + padding || Math.abs(centerY - event.clientY) >= height / 2 + padding) return reset();
      const x = Math.max(-maxTravel, Math.min(maxTravel, (event.clientX - centerX) / magnetStrength));
      const y = Math.max(-maxTravel, Math.min(maxTravel, (event.clientY - centerY) / magnetStrength));
      setPosition({x, y});
    };
    window.addEventListener('pointermove', move, {passive: true}); window.addEventListener('blur', reset);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('blur', reset); };
  }, [disabled, magnetStrength, maxTravel, padding]);
  return <div ref={ref} style={{display: 'inline-block'}} {...props}><div style={{transform: `translate3d(${position.x}px, ${position.y}px, 0)`, transition: 'transform 140ms ease-out'}}>{children}</div></div>;
}
