import React, { useState } from 'react';

interface ResizeHandleProps {
  // Receives the pointer's X position (viewport px) while dragging.
  onDrag: (clientX: number) => void;
  onDoubleClick?: () => void;
  title?: string;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({ onDrag, onDoubleClick, title }) => {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title={title ?? 'Drag to resize · Double-click to reset'}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => dragging && onDrag(e.clientX)}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onDoubleClick}
      className="relative w-0 flex-shrink-0 z-20 cursor-col-resize group"
    >
      {/* Wide invisible hit area, thin visible line */}
      <div className="absolute inset-y-0 -left-1.5 w-3" />
      <div
        className={`absolute inset-y-0 -left-px w-0.5 transition-colors ${
          dragging ? 'bg-blue-500' : 'bg-transparent group-hover:bg-blue-500/70'
        }`}
      />
    </div>
  );
};
