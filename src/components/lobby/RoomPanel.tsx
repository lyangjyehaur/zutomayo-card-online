import type { ComponentProps } from 'react';
import { Panel, cn } from '../../ui';

type PanelProps = ComponentProps<typeof Panel>;

export type RoomPanelMode = 'quick' | 'deck' | 'custom' | 'status';

const roomPanelClass: Record<RoomPanelMode, string> = {
  quick: 'flex flex-col gap-4 lg:overflow-y-auto',
  deck: '',
  custom: 'flex flex-col gap-4',
  status: 'flex flex-col gap-3',
};

const roomPanelSize: Record<RoomPanelMode, NonNullable<PanelProps['size']>> = {
  quick: 'xl',
  deck: 'lg',
  custom: 'lg',
  status: 'md',
};

const roomPanelVariant: Record<RoomPanelMode, NonNullable<PanelProps['variant']>> = {
  quick: 'solid',
  deck: 'ghost',
  custom: 'ghost',
  status: 'ghost',
};

export interface RoomPanelProps extends PanelProps {
  mode: RoomPanelMode;
}

export function RoomPanel({ mode, className, size, variant, ...props }: RoomPanelProps) {
  return (
    <Panel
      data-room-panel={mode}
      className={cn(roomPanelClass[mode], className)}
      size={size ?? roomPanelSize[mode]}
      variant={variant ?? roomPanelVariant[mode]}
      {...props}
    />
  );
}

export type RoomDetailsProps = Omit<RoomPanelProps, 'mode'>;

export function RoomDetails(props: RoomDetailsProps) {
  return <RoomPanel mode="status" {...props} />;
}
