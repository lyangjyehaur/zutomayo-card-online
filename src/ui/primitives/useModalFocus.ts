import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
  );
}

function setElementInert(element: HTMLElement, inert: boolean): () => void {
  const previousAriaHidden = element.getAttribute('aria-hidden');
  const previousInert = element.inert;

  element.inert = inert;
  if (inert) element.setAttribute('aria-hidden', 'true');
  else if (previousAriaHidden === null) element.removeAttribute('aria-hidden');
  else element.setAttribute('aria-hidden', previousAriaHidden);

  return () => {
    element.inert = previousInert;
    if (previousAriaHidden === null) element.removeAttribute('aria-hidden');
    else element.setAttribute('aria-hidden', previousAriaHidden);
  };
}

export function useModalFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  modalRootRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    const modalRoot = modalRootRef.current;
    if (!dialog || !modalRoot) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreSiblings = Array.from(modalRoot.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== modalRoot)
      .map((element) => setElementInert(element, true));

    const focusInitialElement = () => {
      const firstFocusable = focusableElements(dialog)[0];
      (firstFocusable ?? dialog).focus();
    };

    window.requestAnimationFrame(focusInitialElement);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      restoreSiblings.forEach((restore) => restore());
      previousFocus?.focus();
    };
  }, [dialogRef, modalRootRef, open]);
}
