import { GestureRecognizer } from './gesture';
import { gestureToActions, KeyboardMapper } from './mapper';
import type { Action } from './actions';

export interface InputHooks {
  onAction(a: Action): void;
  onKey(code: string): boolean; // meta keys (overlay, retry...). return true if consumed
}

/** Binds DOM pointer + keyboard events to the recogniser/mapper. Only glue lives here. */
export function bindInput(surface: HTMLElement, gestures: GestureRecognizer, hooks: InputHooks): void {
  const keys = new KeyboardMapper();
  const flush = () => { for (const e of gestures.drain()) for (const a of gestureToActions(e)) hooks.onAction(a); };
  const resize = () => gestures.setViewport(window.innerWidth, window.innerHeight);
  resize();
  window.addEventListener('resize', resize);

  surface.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    surface.setPointerCapture?.(e.pointerId);
    gestures.pointerDown(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    flush();
  });
  surface.addEventListener('pointermove', (e) => {
    // coalesced events give the full finger path even if frames drop
    const list = (e.getCoalescedEvents?.() ?? []) as PointerEvent[];
    for (const c of list.length ? list : [e]) gestures.pointerMove(e.pointerId, c.clientX, c.clientY, c.timeStamp || e.timeStamp);
    flush();
  });
  const end = (e: PointerEvent) => { gestures.pointerUp(e.pointerId, e.clientX, e.clientY, e.timeStamp); flush(); };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', (e) => { gestures.pointerCancel(e.pointerId, e.timeStamp); flush(); });
  // stop iOS/Android scrolling, zooming and the context menu
  surface.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  surface.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (hooks.onKey(e.code)) { e.preventDefault(); return; }
    const acts = keys.keyDown(e.code, e.repeat);
    if (acts.length || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    for (const a of acts) hooks.onAction(a);
  });
  window.addEventListener('keyup', (e) => { for (const a of keys.keyUp(e.code)) hooks.onAction(a); });
  window.addEventListener('blur', () => { for (const a of keys.releaseAll()) hooks.onAction(a); });
}
