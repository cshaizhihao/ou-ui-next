import { useEffect, useState } from 'react';

export type EditableCardLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EditableCardLayoutMap = Record<string, EditableCardLayout>;

export const EDITABLE_CARD_LAYOUT_CHANGE_EVENT = 'ou:editable-card-layout-change';
export const EDITABLE_CARD_LAYOUT_DEFAULTS = {
  minHeight: 220,
  minWidth: 280,
  maxHeight: 540,
  maxWidth: 720
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isEditableCardLayout(value: unknown): value is EditableCardLayout {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<EditableCardLayout>;

  return (
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number' &&
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number'
  );
}

export function readEditableCardLayoutMap(storageKey: string): EditableCardLayoutMap {
  if (typeof window === 'undefined' || !storageKey) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(storageKey);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, EditableCardLayout] => isEditableCardLayout(entry[1]))
    );
  } catch {
    return {};
  }
}

export function useEditableCardLayoutMap(storageKey: string) {
  const [layouts, setLayouts] = useState<EditableCardLayoutMap>(() => readEditableCardLayoutMap(storageKey));

  useEffect(() => {
    if (typeof window === 'undefined' || !storageKey) {
      return undefined;
    }

    const handleLayoutChange = (event: Event) => {
      const detail = (event as CustomEvent<{ storageKey?: string }>).detail;

      if (detail?.storageKey === storageKey) {
        setLayouts(readEditableCardLayoutMap(storageKey));
      }
    };

    setLayouts(readEditableCardLayoutMap(storageKey));
    window.addEventListener(EDITABLE_CARD_LAYOUT_CHANGE_EVENT, handleLayoutChange);

    return () => {
      window.removeEventListener(EDITABLE_CARD_LAYOUT_CHANGE_EVENT, handleLayoutChange);
    };
  }, [storageKey]);

  return layouts;
}

export function measureEditableCardLayoutBounds(layouts: EditableCardLayout[], padding = 24) {
  const bounds = layouts.reduce(
    (current, layout) => ({
      height: Math.max(current.height, layout.y + layout.height),
      width: Math.max(current.width, layout.x + layout.width)
    }),
    { height: 0, width: 0 }
  );

  return {
    height: bounds.height + padding,
    width: bounds.width + padding
  };
}

export function normalizeEditableCardLayout(
  layout: EditableCardLayout,
  minWidth: number = EDITABLE_CARD_LAYOUT_DEFAULTS.minWidth,
  minHeight: number = EDITABLE_CARD_LAYOUT_DEFAULTS.minHeight,
  maxWidth: number = EDITABLE_CARD_LAYOUT_DEFAULTS.maxWidth,
  maxHeight: number = EDITABLE_CARD_LAYOUT_DEFAULTS.maxHeight
) {
  return {
    x: Math.max(0, Math.round(layout.x)),
    y: Math.max(0, Math.round(layout.y)),
    width: Math.round(clamp(layout.width, minWidth, maxWidth)),
    height: Math.round(clamp(layout.height, minHeight, maxHeight))
  };
}

export function persistEditableCardLayout(storageKey: string, layoutKey: string, layout: EditableCardLayout) {
  if (typeof window === 'undefined' || !storageKey || !layoutKey) {
    return;
  }

  try {
    const map = readEditableCardLayoutMap(storageKey);
    map[layoutKey] = layout;
    window.localStorage.setItem(storageKey, JSON.stringify(map));
    window.dispatchEvent(
      new CustomEvent(EDITABLE_CARD_LAYOUT_CHANGE_EVENT, {
        detail: {
          layout,
          layoutKey,
          storageKey
        }
      })
    );
  } catch {
    // Layout persistence is a progressive enhancement.
  }
}
