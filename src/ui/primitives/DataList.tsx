import type { TdHTMLAttributes, TableHTMLAttributes } from 'react';
import { cn } from './utils';

export interface DataListTableProps extends TableHTMLAttributes<HTMLTableElement> {}

export function DataListTable({ className, children, ...props }: DataListTableProps) {
  return (
    <table className={cn('responsive-data-list w-full border-collapse text-left text-sm', className)} {...props}>
      {children}
    </table>
  );
}

export interface DataListCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  label: string;
}

export function DataListCell({ label, className, children, ...props }: DataListCellProps) {
  return (
    <td data-label={label} className={cn('px-3 py-2', className)} {...props}>
      {children}
    </td>
  );
}
