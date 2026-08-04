/**
 * useFitText.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Shrinks an element's font size until its single-line text fits inside its
 * parent's width. Used by the board toolbar so long board IDs never wrap and
 * spill out of the header bar.
 *
 * The hook applies the font size directly to the element during measurement
 * (synchronous layout reads) and mirrors the final value through state so the
 * renderer can keep the inline style in sync. It re-measures whenever the
 * element or its parent is resized (ResizeObserver) or on window resize.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseFitTextOptions {
  /** Font size (px) to start from — the element's natural size. */
  maxSize?: number;
  /** Smallest font size (px) the text may shrink to. */
  minSize?: number;
  /** Shrink step (px) applied per measurement pass. */
  step?: number;
}

export function useFitText<T extends HTMLElement>({
  maxSize = 18,
  minSize = 10,
  step = 0.5,
}: UseFitTextOptions = {}) {
  const ref = useRef<T | null>(null);
  const [fontSize, setFontSize] = useState(maxSize);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;

    let size = maxSize;
    el.style.fontSize = `${maxSize}px`;
    while (el.scrollWidth > parent.clientWidth && size > minSize) {
      size = Math.max(minSize, size - step);
      el.style.fontSize = `${size}px`;
    }
    setFontSize(size);
  }, [maxSize, minSize, step]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;

    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [fit]);

  return { ref, fontSize };
}
