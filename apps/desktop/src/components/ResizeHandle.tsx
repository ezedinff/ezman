import React, { useEffect, useState } from 'react';

interface ResizeHandleProps {
  // Receives the pointer's position on the resizing axis in viewport pixels.
  onDrag: (position: number) => void;
  onDoubleClick?: () => void;
  title?: string;
  orientation?: 'vertical' | 'horizontal';
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  onDrag,
  onDoubleClick,
  title,
  orientation = 'vertical',
}) => {
  const [dragging, setDragging] = useState(false);
  const horizontal = orientation === 'horizontal';

  useEffect(() => {
    if (!dragging) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = horizontal ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [dragging, horizontal]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      title={title ?? 'Drag to resize · Double-click to reset'}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => dragging && onDrag(horizontal ? e.clientY : e.clientX)}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => setDragging(false)}
      onDoubleClick={onDoubleClick}
      className={`relative flex-shrink-0 z-20 group ${
        horizontal ? 'h-0 cursor-row-resize' : 'w-0 cursor-col-resize'
      }`}
    >
      {/* Wide invisible hit area, thin visible line */}
      <div className={horizontal ? 'absolute inset-x-0 -top-1.5 h-3' : 'absolute inset-y-0 -left-1.5 w-3'} />
      <div
        className={`absolute transition-colors ${
          horizontal ? 'inset-x-0 -top-px h-0.5' : 'inset-y-0 -left-px w-0.5'
        } ${
          dragging ? 'bg-blue-500' : 'bg-transparent group-hover:bg-blue-500/70'
        }`}
      />
    </div>
  );
};
