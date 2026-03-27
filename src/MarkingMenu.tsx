import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';

export type MarkingMenuItem = {
  label: string;
  icon?: string;
  shortcut?: string;
  action: () => void;
  /** Compass position in the radial menu */
  position: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  color?: string;
  /** Highlight item as currently active state */
  active?: boolean;
};

type MarkingMenuProps = {
  x: number;
  y: number;
  items: MarkingMenuItem[];
  onClose: () => void;
  /** Called whenever hovered item changes — used by hold-and-release flow */
  onHoverChange?: (item: MarkingMenuItem | null) => void;
  title?: string;
};

// Compass positions: angle (radians from East, CCW) + pixel offsets from center
const SLOTS: Record<string, { angle: number; dx: number; dy: number }> = {
  N:  { angle: -Math.PI / 2,       dx:   0, dy: -90 },
  NE: { angle: -Math.PI / 4,       dx:  64, dy: -64 },
  E:  { angle:  0,                 dx:  92, dy:   0  },
  SE: { angle:  Math.PI / 4,       dx:  64, dy:  64  },
  S:  { angle:  Math.PI / 2,       dx:   0, dy:  90  },
  SW: { angle: (3 * Math.PI) / 4,  dx: -64, dy:  64  },
  W:  { angle:  Math.PI,           dx: -92, dy:   0  },
  NW: { angle: -(3 * Math.PI) / 4, dx: -64, dy: -64  },
};

function pickHovered(mdx: number, mdy: number, items: MarkingMenuItem[]): MarkingMenuItem | null {
  const dist = Math.sqrt(mdx * mdx + mdy * mdy);
  if (dist < 22) return null;
  const angle = Math.atan2(mdy, mdx);
  let best: MarkingMenuItem | null = null;
  let bestDiff = Infinity;
  for (const item of items) {
    const slot = SLOTS[item.position];
    let diff = Math.abs(angle - slot.angle);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff < bestDiff) { bestDiff = diff; best = item; }
  }
  return best;
}

export const MarkingMenu: React.FC<MarkingMenuProps> = ({ x, y, items, onClose, onHoverChange, title }) => {
  const [hovered, setHovered] = useState<MarkingMenuItem | null>(null);
  const hoveredRef = useRef<MarkingMenuItem | null>(null);

  // Track mouse movement for directional hover (hold-and-release flow)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const item = pickHovered(e.clientX - x, e.clientY - y, items);
      if (item !== hoveredRef.current) {
        hoveredRef.current = item;
        setHovered(item);
        onHoverChange?.(item);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [x, y, items, onHoverChange]);

  const executeItem = (item: MarkingMenuItem) => {
    item.action();
    onClose();
  };

  const content = (
    <>
      {/* Full-screen backdrop: dims background, blocks clicks reaching canvas, closes on outside click */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.28)' }}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
      />

      {/* Menu root, centered at cursor */}
      <div style={{
        position: 'fixed', left: x, top: y,
        transform: 'translate(-50%,-50%)',
        zIndex: 9999,
        pointerEvents: 'none', // root passes through; items override this
      }}>
        {/* SVG guide lines from center to each item */}
        <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width={0} height={0}>
          {items.map(item => {
            const slot = SLOTS[item.position];
            const isHov = hovered?.position === item.position;
            return (
              <line key={item.position}
                x1={0} y1={0} x2={slot.dx * 0.5} y2={slot.dy * 0.5}
                stroke={isHov ? 'rgba(255,210,80,0.8)' : 'rgba(255,255,255,0.1)'}
                strokeWidth={isHov ? 2 : 1}
              />
            );
          })}
        </svg>

        {/* Center dot */}
        <div style={{
          position: 'absolute', left: 0, top: 0,
          transform: 'translate(-50%,-50%)',
          width: 10, height: 10, borderRadius: '50%',
          background: 'rgba(255,210,80,1)',
          boxShadow: '0 0 10px rgba(255,210,80,0.8)',
          pointerEvents: 'none',
        }} />

        {/* Title */}
        {title && (
          <div style={{
            position: 'absolute', left: 0, top: 18,
            transform: 'translateX(-50%)',
            fontSize: 9, color: 'rgba(255,255,255,0.38)',
            whiteSpace: 'nowrap', pointerEvents: 'none',
            fontFamily: 'monospace', letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>{title}</div>
        )}

        {/* Items */}
        {items.map(item => {
          const slot = SLOTS[item.position];
          const isHov = hovered?.position === item.position;
          const isActive = item.active;
          const bg = isHov
            ? (item.color ?? 'rgba(228,120,50,0.97)')
            : isActive ? 'rgba(55,110,200,0.85)' : 'rgba(18,18,22,0.94)';
          const border = isHov
            ? 'rgba(255,210,80,0.9)'
            : isActive ? 'rgba(100,170,255,0.5)' : 'rgba(255,255,255,0.11)';

          return (
            <div
              key={item.position}
              style={{
                position: 'absolute',
                left: slot.dx, top: slot.dy,
                transform: 'translate(-50%,-50%)',
                background: bg,
                border: `1.5px solid ${border}`,
                borderRadius: 8,
                padding: '6px 12px',
                color: (isHov || isActive) ? '#fff' : '#bbb',
                fontSize: 11,
                fontWeight: (isHov || isActive) ? 700 : 400,
                whiteSpace: 'nowrap',
                boxShadow: isHov
                  ? '0 0 18px rgba(228,120,50,0.55), 0 3px 12px rgba(0,0,0,0.8)'
                  : '0 2px 8px rgba(0,0,0,0.65)',
                transition: 'background 0.06s, border-color 0.06s, box-shadow 0.06s',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                minWidth: 58, textAlign: 'center',
                userSelect: 'none',
                cursor: 'pointer',
                pointerEvents: 'auto', // ← items ARE interactive
              }}
              onClick={(e) => { e.stopPropagation(); executeItem(item); }}
              onMouseEnter={() => {
                hoveredRef.current = item;
                setHovered(item);
                onHoverChange?.(item);
              }}
              onMouseLeave={() => {
                hoveredRef.current = null;
                setHovered(null);
                onHoverChange?.(null);
              }}
            >
              {item.icon && <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>}
              <span style={{ lineHeight: 1.3 }}>{item.label}</span>
              {item.shortcut && (
                <span style={{ fontSize: 9, color: isHov ? 'rgba(255,255,255,0.6)' : '#555', fontFamily: 'monospace' }}>
                  {item.shortcut}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
  return ReactDOM.createPortal(content, document.body);
};
