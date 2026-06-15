import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import { CornerDownRight, GripVertical } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  measureEditableCardLayoutBounds,
  normalizeEditableCardLayout,
  persistEditableCardLayout,
  readEditableCardLayoutMap,
  useEditableCardLayoutMap,
  type EditableCardLayout,
  type EditableCardLayoutMap
} from './editable-card-layout';

type EditableCardFrameProps = HTMLAttributes<HTMLDivElement> & {
  storageKey: string;
  layoutKey: string;
  title: string;
  defaultLayout: EditableCardLayout;
  isEditable?: boolean;
  children: ReactNode;
};

type DragState =
  | {
      kind: 'move';
      pointerId: number;
      startX: number;
      startY: number;
      layout: EditableCardLayout;
    }
  | {
      kind: 'resize';
      pointerId: number;
      startX: number;
      startY: number;
      layout: EditableCardLayout;
    }
  | null;

type DragPayload = {
  pointerId: number;
  clientX: number;
  clientY: number;
};

function getEventPointerId(event: PointerEvent | MouseEvent) {
  return typeof (event as PointerEvent).pointerId === 'number' ? (event as PointerEvent).pointerId : 1;
}

type EditableCardStageProps = HTMLAttributes<HTMLDivElement> & {
  storageKey: string;
  defaultLayouts: EditableCardLayoutMap;
  padding?: number;
  constrainToLayouts?: boolean;
};

export function EditableCardStage({
  children,
  className,
  constrainToLayouts = true,
  defaultLayouts,
  padding = 24,
  storageKey,
  style,
  ...props
}: EditableCardStageProps) {
  const storedLayouts = useEditableCardLayoutMap(storageKey);
  const resolvedLayouts = useMemo(
    () =>
      Object.entries(defaultLayouts).map(([layoutKey, defaultLayout]) =>
        normalizeEditableCardLayout(storedLayouts[layoutKey] ?? defaultLayout)
      ),
    [defaultLayouts, storedLayouts]
  );
  const bounds = useMemo(() => measureEditableCardLayoutBounds(resolvedLayouts, padding), [padding, resolvedLayouts]);

  return (
    <div
      {...props}
      className={cn('relative min-w-0 overflow-visible', className)}
      style={{
        ...(constrainToLayouts
          ? {
              minHeight: `${bounds.height}px`,
              minWidth: `${bounds.width}px`
            }
          : {}),
        ...style
      }}
    >
      {children}
    </div>
  );
}

export function EditableCardFrame({
  children,
  className,
  defaultLayout,
  isEditable = true,
  layoutKey,
  storageKey,
  title,
  ...props
}: EditableCardFrameProps) {
  const [layout, setLayout] = useState<EditableCardLayout>(() => {
    const stored = readEditableCardLayoutMap(storageKey)[layoutKey];
    return normalizeEditableCardLayout(stored ?? defaultLayout);
  });
  const dragStateRef = useRef<DragState>(null);
  const [dragging, setDragging] = useState(false);
  const supportsPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;
  const defaultLayoutSnapshot = useMemo<EditableCardLayout>(
    () => ({ x: defaultLayout.x, y: defaultLayout.y, width: defaultLayout.width, height: defaultLayout.height }),
    [defaultLayout.height, defaultLayout.width, defaultLayout.x, defaultLayout.y]
  );

  useEffect(() => {
    const stored = readEditableCardLayoutMap(storageKey)[layoutKey];
    setLayout(normalizeEditableCardLayout(stored ?? defaultLayoutSnapshot));
  }, [defaultLayoutSnapshot, layoutKey, storageKey]);

  useEffect(() => {
    persistEditableCardLayout(storageKey, layoutKey, layout);
  }, [layout, layoutKey, storageKey]);

  useEffect(() => {
    if (!isEditable) {
      dragStateRef.current = null;
      setDragging(false);
      return undefined;
    }

    const handleMove = (event: PointerEvent | MouseEvent) => {
      const interaction = dragStateRef.current;

      if (!interaction || interaction.pointerId !== getEventPointerId(event)) {
        return;
      }

      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;

      if (interaction.kind === 'move') {
        setLayout(
          normalizeEditableCardLayout({
            ...interaction.layout,
            x: interaction.layout.x + deltaX,
            y: interaction.layout.y + deltaY
          })
        );
        return;
      }

      setLayout(
        normalizeEditableCardLayout({
          ...interaction.layout,
          width: interaction.layout.width + deltaX,
          height: interaction.layout.height + deltaY
        })
      );
    };

    const stopDragging = (event: PointerEvent | MouseEvent) => {
      const eventPointerId = getEventPointerId(event);

      if (dragStateRef.current?.pointerId === eventPointerId) {
        dragStateRef.current = null;
        setDragging(false);
      }
    };

    if (supportsPointerEvents) {
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', stopDragging);
      window.addEventListener('pointercancel', stopDragging);
    } else {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', stopDragging);
    }

    return () => {
      if (supportsPointerEvents) {
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', stopDragging);
        window.removeEventListener('pointercancel', stopDragging);
      } else {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', stopDragging);
      }
    };
  }, [isEditable, supportsPointerEvents]);

  const beginMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isEditable) {
      return;
    }

    if (!supportsPointerEvents || (typeof event.button === 'number' && event.button > 0)) {
      return;
    }

    startDrag('move', { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }, event);
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isEditable) {
      return;
    }

    if (!supportsPointerEvents || (typeof event.button === 'number' && event.button > 0)) {
      return;
    }

    startDrag('resize', { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY }, event);
  };

  const beginMoveMouse = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!isEditable) {
      return;
    }

    if (supportsPointerEvents || (typeof event.button === 'number' && event.button > 0)) {
      return;
    }

    startDrag('move', { pointerId: 1, clientX: event.clientX, clientY: event.clientY }, event);
  };

  const beginResizeMouse = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!isEditable) {
      return;
    }

    if (supportsPointerEvents || (typeof event.button === 'number' && event.button > 0)) {
      return;
    }

    startDrag('resize', { pointerId: 1, clientX: event.clientX, clientY: event.clientY }, event);
  };

  function startDrag(
    kind: 'move' | 'resize',
    payload: DragPayload,
    event: ReactPointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>
  ) {
    if (!isEditable) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
    dragStateRef.current = {
      kind,
      pointerId: payload.pointerId,
      startX: payload.clientX,
      startY: payload.clientY,
      layout
    };
  }

  return (
    <div
      {...props}
      aria-label={title}
      className={cn(
        isEditable ? 'absolute overflow-hidden' : 'relative overflow-hidden',
        !isEditable && 'block',
        className
      )}
      role="group"
      style={{
        ...(isEditable
          ? {
              position: 'absolute' as const,
              left: 0,
              top: 0,
              transform: `translate(${layout.x}px, ${layout.y}px)`,
              width: `${layout.width}px`,
              height: `${layout.height}px`,
              zIndex: dragging ? 20 : 1,
              touchAction: 'none' as const
            }
          : {
              left: 'auto',
              position: 'relative' as const,
              top: 'auto',
              width: '100%',
              height: 'auto',
              transform: 'none',
              zIndex: 1,
              touchAction: 'auto' as const
            }),
        ...props.style
      }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 border border-dashed border-transparent" />
      {isEditable ? (
        <>
          <button
            aria-label={`Move ${title} card`}
            className="absolute left-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center border border-[#07111F]/18 bg-[#FFFDF5]/92 text-[#07111F] opacity-90 transition duration-200 ease-out hover:bg-[#DCE1FF]/72 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 active:cursor-grabbing motion-reduce:transition-none dark:border-white/10 dark:bg-[#101827]/90 dark:text-[#DDE3FF] dark:hover:bg-[#1E3AFF]/24"
            style={{ touchAction: 'none' }}
            onPointerDown={beginMove}
            onMouseDown={beginMoveMouse}
            type="button"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label={`Resize ${title} card`}
            className="absolute bottom-2 right-2 z-10 inline-flex h-7 w-7 items-center justify-center border border-[#07111F]/18 bg-[#FFFDF5]/92 text-[#07111F] opacity-90 transition duration-200 ease-out hover:bg-[#DCE1FF]/72 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3AFF]/35 active:cursor-se-resize motion-reduce:transition-none dark:border-white/10 dark:bg-[#101827]/90 dark:text-[#DDE3FF] dark:hover:bg-[#1E3AFF]/24"
            style={{ touchAction: 'none' }}
            onPointerDown={beginResize}
            onMouseDown={beginResizeMouse}
            type="button"
          >
            <CornerDownRight className="h-3.5 w-3.5" />
          </button>
        </>
      ) : null}
      <div className="relative z-0 h-full w-full overflow-hidden">{children}</div>
    </div>
  );
}
