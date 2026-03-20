import React, { useState, useRef, useEffect, MouseEvent as ReactMouseEvent } from 'react';

export interface CurvePoint {
  x: number;
  y: number;
  lx?: number;
  ly?: number;
  rx?: number;
  ry?: number;
}

interface CurveEditorProps {
  value: string; // JSON of CurvePoint[]
  onChange: (value: string) => void;
  height?: number;
  width?: number;
}

export const CurveEditor: React.FC<CurveEditorProps> = ({ value, onChange, height = 60, width = 200 }) => {
  const [points, setPoints] = useState<CurvePoint[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [draggingState, setDraggingState] = useState<{ idx: number, type: 'point'|'lx'|'rx' } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  useEffect(() => {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        setPoints(parsed);
      } else {
        setPoints([{x: 0, y: 1}, {x: 1, y: 1}]);
      }
    } catch (e) {
      setPoints([{x: 0, y: 1}, {x: 1, y: 1}]);
    }
  }, [value]);

  const updateValue = (newPoints: CurvePoint[]) => {
    const sorted = [...newPoints].sort((a, b) => a.x - b.x);
    if (sorted.length > 0) {
      sorted[0].x = 0;
      sorted[sorted.length - 1].x = 1;
    }
    setPoints(sorted);
    onChange(JSON.stringify(sorted));
    
    // Find where the selected index moved (since we sorted)
    if (selectedIdx !== null) {
        const oldPoint = points[selectedIdx];
        const newSelectedIdx = sorted.findIndex(p => p === oldPoint);
        if (newSelectedIdx !== -1) setSelectedIdx(newSelectedIdx);
    }
  };

  const toPx = (x: number, y: number) => ({
    x: x * width,
    y: (1 - y) * height
  });

  const handlePointMouseDown = (e: ReactMouseEvent, idx: number) => {
    e.stopPropagation();
    setSelectedIdx(idx);
    if (e.altKey) {
        // Init handles implicitly at point
        const newPoints = [...points];
        newPoints[idx] = { ...newPoints[idx], lx: newPoints[idx].x, ly: newPoints[idx].y, rx: newPoints[idx].x, ry: newPoints[idx].y };
        setPoints(newPoints);
        setDraggingState({ idx, type: 'rx' }); // start pulling right handle
    } else {
        setDraggingState({ idx, type: 'point' });
    }
  };

  const handleHandleMouseDown = (e: ReactMouseEvent, idx: number, type: 'lx'|'rx') => {
    e.stopPropagation();
    setSelectedIdx(idx);
    setDraggingState({ idx, type });
  };

  const handleBackgroundMouseDown = (e: ReactMouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / height));
    
    // if we just click, make a linear point.
    // to match Illustrator pen tool: if we drag right after clicking, it will pull handles.
    // we can simulate this by initializing handles right here, and starting a drag of 'rx'.
    // If they don't drag, MouseUp keeps handles at origin, which renders same as linear, 
    // OR we could clean up zero-length handles on mouse up! 
    const newPoint = { x, y, lx: x, ly: y, rx: x, ry: y };
    const newPoints = [...points, newPoint];
    const newIdx = newPoints.length - 1;
    
    setPoints(newPoints);
    setSelectedIdx(newIdx);
    setDraggingState({ idx: newIdx, type: 'rx' }); 
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingState || !containerRef.current) return;
      const { idx, type } = draggingState;
      const rect = containerRef.current.getBoundingClientRect();
      let rawX = (e.clientX - rect.left) / width;
      let rawY = 1 - (e.clientY - rect.top) / height;
      
      const newPoints = [...points];
      const p = { ...newPoints[idx] };
      
      if (type === 'point') {
          const clampedX = Math.max(0, Math.min(1, rawX));
          const clampedY = Math.max(0, Math.min(1, rawY));
          const nx = (idx === 0 || idx === points.length - 1) ? p.x : clampedX;
          const ny = clampedY;
          
          const dx = nx - p.x;
          const dy = ny - p.y;
          p.x = nx; p.y = ny;
          if (p.lx !== undefined) { p.lx += dx; p.ly! += dy; }
          if (p.rx !== undefined) { p.rx += dx; p.ry! += dy; }
      } else {
          // If we are dragging a handle, don't clamp it as strictly, let them pull far!
          const nx = rawX;
          const ny = rawY;
          
          if (type === 'lx') {
              p.lx = nx; p.ly = ny;
              if (!e.altKey && p.rx !== undefined) {
                  // mirror rx
                  p.rx = p.x + (p.x - nx);
                  p.ry = p.y + (p.y - ny);
              }
          } else if (type === 'rx') {
              p.rx = nx; p.ry = ny;
              if (!e.altKey && p.lx !== undefined) {
                  // mirror lx
                  p.lx = p.x + (p.x - nx);
                  p.ly = p.y + (p.y - ny);
              }
          }
      }
      newPoints[idx] = p;
      setPoints(newPoints);
    };

    const handleMouseUp = () => {
      if (draggingState !== null) {
         let newPts = [...points];
         // Clean up 0-length handles to keep JSON clean? Optional. 
         // For simplicity, we just keep them, they work fine.
         updateValue(newPts); 
         setDraggingState(null);
      }
    };

    if (draggingState !== null) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggingState, points]);

  const removePoint = (e: ReactMouseEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault(); 
    if (idx === 0 || idx === points.length - 1) return;
    const newPoints = points.filter((_, i) => i !== idx);
    setSelectedIdx(null);
    updateValue(newPoints);
  };

  if (points.length < 2) return null;

  const pathD = points.map((p, i) => {
    const pt = toPx(p.x, p.y);
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    
    const prev = points[i-1];
    if (prev.rx !== undefined || p.lx !== undefined) {
        const cp1x = prev.rx !== undefined ? prev.rx : prev.x + (p.x - prev.x)/3;
        const cp1y = prev.ry !== undefined ? prev.ry : prev.y + (p.y - prev.y)/3;
        const cp2x = p.lx !== undefined ? p.lx : p.x - (p.x - prev.x)/3;
        const cp2y = p.ly !== undefined ? p.ly : p.y - (p.y - prev.y)/3;
        
        const c1 = toPx(cp1x, cp1y);
        const c2 = toPx(cp2x, cp2y);
        return `C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${pt.x} ${pt.y}`;
    }
    
    return `L ${pt.x} ${pt.y}`;
  }).join(' ');

  return (
    <div 
      ref={containerRef}
      onMouseDown={handleBackgroundMouseDown}
      style={{
        position: 'relative', 
        width: width + 'px',
        height: height + 'px',
        background: '#222', 
        border: '1px solid #444',
        cursor: 'crosshair',
        marginBottom: '5px',
        overflow: 'hidden'
      }}
    >
      <svg width={width} height={height} style={{position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible'}}>
        <path d={pathD} stroke="#ffaa00" strokeWidth="2" fill="none" />
        
        {points.map((p, i) => {
           if (i !== selectedIdx) return null;
           const pt = toPx(p.x, p.y);
           const elems = [];
           if (p.lx !== undefined) {
               const lPt = toPx(p.lx, p.ly!);
               elems.push(<line key={`ll_${i}`} x1={pt.x} y1={pt.y} x2={lPt.x} y2={lPt.y} stroke="#888" strokeWidth="1" />);
           }
           if (p.rx !== undefined) {
               const rPt = toPx(p.rx, p.ry!);
               elems.push(<line key={`rl_${i}`} x1={pt.x} y1={pt.y} x2={rPt.x} y2={rPt.y} stroke="#888" strokeWidth="1" />);
           }
           return elems;
        })}
      </svg>
      
      {points.map((p, i) => {
        const pt = toPx(p.x, p.y);
        const handles = [];
        
        if (i === selectedIdx) {
            if (p.lx !== undefined) {
                const lPt = toPx(p.lx, p.ly!);
                handles.push(
                    <div key={`lh_${i}`}
                         onMouseDown={(e) => handleHandleMouseDown(e, i, 'lx')}
                         style={{ position: 'absolute', left: lPt.x - 3, top: lPt.y - 3, width: 6, height: 6, background: '#fff', borderRadius: '50%', cursor: 'pointer', zIndex: 11 }} />
                );
            }
            if (p.rx !== undefined) {
                const rPt = toPx(p.rx, p.ry!);
                handles.push(
                    <div key={`rh_${i}`}
                         onMouseDown={(e) => handleHandleMouseDown(e, i, 'rx')}
                         style={{ position: 'absolute', left: rPt.x - 3, top: rPt.y - 3, width: 6, height: 6, background: '#fff', borderRadius: '50%', cursor: 'pointer', zIndex: 11 }} />
                );
            }
        }
        
        return (
          <React.Fragment key={`p_${i}`}>
            {handles}
            <div 
              onMouseDown={(e) => {
                 if (e.button === 2) {
                     removePoint(e, i); 
                 } else {
                     handlePointMouseDown(e, i); 
                 }
              }}
              onContextMenu={(e) => { e.preventDefault(); removePoint(e, i); }}
              style={{
                position: 'absolute',
                left: pt.x - 4,
                top: pt.y - 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: (i === draggingState?.idx && draggingState.type === 'point') ? '#fff' : (i === selectedIdx ? '#ffcc00' : '#ffaa00'),
                cursor: (i === 0 || i === points.length - 1) ? 'ns-resize' : 'pointer',
                zIndex: 10
              }}
            />
          </React.Fragment>
        );
      })}
      {selectedIdx === null && <div style={{position:'absolute', bottom:-18, left:0, fontSize:'10px', color:'#777'}}>Alt-drag point for handles</div>}
    </div>
  );
};

export const evaluateCurve = (curveJson: string | undefined, t: number, defaultValue: number = 1): number => {
  if (!curveJson) return defaultValue;
  try {
    const points: CurvePoint[] = JSON.parse(curveJson);
    if (!Array.isArray(points) || points.length === 0) return defaultValue;
    if (points.length === 1) return points[0].y;
    
    // assume pre-sorted but let's be safe
    const sortedPoints = [...points].sort((a, b) => a.x - b.x);

    if (t <= sortedPoints[0].x) return sortedPoints[0].y;
    if (t >= sortedPoints[sortedPoints.length - 1].x) return sortedPoints[sortedPoints.length - 1].y;

    for (let i = 0; i < sortedPoints.length - 1; i++) {
       const p1 = sortedPoints[i];
       const p2 = sortedPoints[i+1];
       if (t >= p1.x && t <= p2.x) {
         if (p1.rx !== undefined || p2.lx !== undefined) {
             const cp1x = p1.rx !== undefined ? p1.rx : p1.x + (p2.x - p1.x) / 3;
             const cp1y = p1.ry !== undefined ? p1.ry : p1.y + (p2.y - p1.y) / 3;
             const cp2x = p2.lx !== undefined ? p2.lx : p2.x - (p2.x - p1.x) / 3;
             const cp2y = p2.ly !== undefined ? p2.ly : p2.y - (p2.y - p1.y) / 3;
             
             let lower = 0;
             let upper = 1;
             let u = 0.5;
             for (let iter = 0; iter < 15; iter++) {
                 const invU = 1 - u;
                 const currentX = invU*invU*invU*p1.x + 3*invU*invU*u*cp1x + 3*invU*u*u*cp2x + u*u*u*p2.x;
                 if (currentX < t) lower = u;
                 else upper = u;
                 u = (lower + upper) / 2;
             }
             const invU = 1 - u;
             return invU*invU*invU*p1.y + 3*invU*invU*u*cp1y + 3*invU*u*u*cp2y + u*u*u*p2.y;
         } else {
             const segmentT = (t - p1.x) / (p2.x - p1.x);
             return p1.y + (p2.y - p1.y) * segmentT;
         }
       }
    }
    return defaultValue;
  } catch(e) {
    return defaultValue;
  }
}
