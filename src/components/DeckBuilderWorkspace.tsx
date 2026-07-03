import type { HTMLAttributes, ReactNode } from 'react';
import { Sheet } from './ui';
import { cn } from './ui/utils';

interface ActiveDeckPanelProps extends HTMLAttributes<HTMLElement> {
  label: string;
}

export function ActiveDeckPanel({ label, className, children, ...props }: ActiveDeckPanelProps) {
  return (
    <aside
      className={cn(
        'hidden min-h-[18rem] flex-col rounded-sm bg-lacquer p-4 ring-1 ring-bone/10 md:min-h-[22rem] md:p-5 xl:flex xl:min-h-0',
        className,
      )}
      aria-label={label}
      {...props}
    >
      {children}
    </aside>
  );
}

interface ActiveDeckSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  footer?: ReactNode;
  children: ReactNode;
}

export function ActiveDeckSheet({ open, onOpenChange, title, closeLabel, footer, children }: ActiveDeckSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} closeLabel={closeLabel} footer={footer}>
      <div className="flex max-h-[58dvh] min-h-0 flex-col">{children}</div>
    </Sheet>
  );
}
