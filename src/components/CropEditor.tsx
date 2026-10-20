import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { applyH, clamp, homography, isConvex } from '../lib/imageproc';
import type { Page, Pt, Quad } from '../lib/types';
import { QUAD_OUT } from '../lib/types';
import { Spinner } from './ui';

/**
 * Crop editor.
 *  - a corner handle moves ONLY that corner
 *  - an edge handle moves ONLY the two end points of that edge, perpendicular to the edge
 *  - there is no "drag the whole quad" gesture, so nothing can shift by accident
 */
type Drag = { kind: 'corner'; idx: number } | { kind: 'edge'; idx: number; origin: Pt; start: Quad };

const PAD = 44;
const MARGIN = 0.06;
const LOUPE = 150;
const ZOOM = 3.4;

export default function CropEditor({ page, onCommit }: { page: Page; onCommit: (q: Quad) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [quad, setQuad] = useState<Quad>(page.quad);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [loupe, setLoupe] = useState<Pt | null>(null);
  const quadRef = useRef(quad);
  quadRef.current = quad;
  const startRef = useRef<Quad>(page.quad);

  useEffect(() => {
    if (!drag) setQuad(page.quad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.quad, page.id]);
  useEffect(() => setActive(null), [page.id]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iw = page.width || 1;
  const ih = page.height || 1;
  const scale = Math.max(0.01, Math.min((size.w - PAD * 2) / (iw * (1 + 2 * MARGIN)), (size.h - PAD * 2) / (ih * (1 + 2 * MARGIN))));
  const dw = Math.max(1, iw * scale);
  const dh = Math.max(1, ih * scale);

  const rawNorm = (cx: number, cy: number): Pt => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height };
  };

  const begin = (e: RPointerEvent, d: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    startRef.current = quadRef.current;
    setDrag(d);
    if (d.kind === 'corner') {
      setActive(d.idx);
      setLoupe(quadRef.current[d.idx]);
    } else {
      setActive(null);
      const a = quadRef.current[d.idx];
      const b = quadRef.current[(d.idx + 1) % 4];
      setLoupe({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
  };

  const onMove = (e: RPointerEvent) => {
    if (!drag) return;
    const raw = rawNorm(e.clientX, e.clientY);
    if (drag.kind === 'corner') {
      const p = { x: clamp(raw.x, -QUAD_OUT, 1 + QUAD_OUT), y: clamp(raw.y, -QUAD_OUT, 1 + QUAD_OUT) };
      setQuad(quadRef.current.map((c, i) => (i === drag.idx ? p : c)) as Quad);
      setLoupe(p);
      return;
    }
    // edge: slide along the edge normal only
    const i = drag.idx;
    const j = (i + 1) % 4;
    const a = drag.start[i];
    const b = drag.start[j];
    const ex = (b.x - a.x) * dw;
    const ey = (b.y - a.y) * dh;
    const len = Math.hypot(ex, ey) || 1;
    const nx = -ey / len;
    const ny = ex / len;
    const t = (raw.x - drag.origin.x) * dw * nx + (raw.y - drag.origin.y) * dh * ny;
    const ox = nx / dw;
    const oy = ny / dh;
    let lo = -Infinity;
    let hi = Infinity;
    for (const c of [a, b]) {
      for (const [pos, o] of [
        [c.x, ox],
        [c.y, oy],
      ] as const) {
        if (Math.abs(o) < 1e-9) continue;
        const t1 = (-QUAD_OUT - pos) / o;
        const t2 = (1 + QUAD_OUT - pos) / o;
        lo = Math.max(lo, Math.min(t1, t2));
        hi = Math.min(hi, Math.max(t1, t2));
      }
    }
    const tc = Math.min(hi, Math.max(lo, t));
    const nq = drag.start.map((c, k) => (k === i || k === j ? { x: c.x + ox * tc, y: c.y + oy * tc } : c)) as Quad;
    setQuad(nq);
    setLoupe({ x: (nq[i].x + nq[j].x) / 2, y: (nq[i].y + nq[j].y) / 2 });
  };

  const end = () => {
    if (!drag) return;
    setDrag(null);
    setLoupe(null);
    const q = quadRef.current;
    const s = startRef.current;
    const moved = q.some((p, i) => Math.abs(p.x - s[i].x) > 1e-5 || Math.abs(p.y - s[i].y) > 1e-5);
    if (!moved) return;
    if (isConvex(q)) onCommit(q);
    else setQuad(s);
  };

  // keyboard nudging of the selected corner
  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (e.key === 'Escape') return setActive(null);
      const dv = dirs[e.key];
      if (!dv) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const nq = quadRef.current.map((c, i) =>
        i === active
          ? { x: clamp(c.x + (dv[0] * step) / dw, -QUAD_OUT, 1 + QUAD_OUT), y: clamp(c.y + (dv[1] * step) / dh, -QUAD_OUT, 1 + QUAD_OUT) }
          : c,
      ) as Quad;
      if (isConvex(nq)) {
        setQuad(nq);
        onCommit(nq);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, dw, dh, onCommit]);

  const P = quad.map((p) => ({ x: p.x * dw, y: p.y * dh }));
  const valid = isConvex(quad);

  const grid = useMemo(() => {
    if (!valid) return [] as [Pt, Pt][];
    const Hm = homography(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      quad.map((p) => ({ x: p.x * dw, y: p.y * dh })),
    );
    if (!Hm) return [];
    const lines: [Pt, Pt][] = [];
    for (const t of [1 / 3, 2 / 3]) {
      lines.push([applyH(Hm, t, 0), applyH(Hm, t, 1)]);
      lines.push([applyH(Hm, 0, t), applyH(Hm, 1, t)]);
    }
    return lines;
  }, [quad, dw, dh, valid]);

  const stroke = valid ? '#2dd4bf' : '#f87171';
  const poly = P.map((p) => `${p.x},${p.y}`).join(' ');

  let loupeEl = null;
  if (loupe && page.srcUrl) {
    const lx = loupe.x * dw;
    const ly = loupe.y * dh;
    let left = lx - LOUPE - 30;
    let top = ly - LOUPE - 30;
    if (left < -PAD + 4) left = lx + 30;
    if (top < -PAD + 4) top = ly + 30;
    const ox = LOUPE / 2 - lx * ZOOM;
    const oy = LOUPE / 2 - ly * ZOOM;
    loupeEl = (
      <div
        className="a-pop pointer-events-none absolute z-20 overflow-hidden rounded-full border-[3px] border-teal-200 bg-slate-900 shadow-2xl shadow-black/70 ring-4 ring-teal-300/20"
        style={{
          left,
          top,
          width: LOUPE,
          height: LOUPE,
          backgroundImage: `url(${page.srcUrl})`,
          backgroundSize: `${dw * ZOOM}px ${dh * ZOOM}px`,
          backgroundPosition: `${ox}px ${oy}px`,
          backgroundRepeat: 'no-repeat',
        }}
      >
        <svg width={LOUPE} height={LOUPE} className="absolute inset-0">
          <polygon points={P.map((p) => `${p.x * ZOOM + ox},${p.y * ZOOM + oy}`).join(' ')} fill="none" stroke={stroke} strokeWidth={1.5} />
          <line x1={LOUPE / 2} y1={LOUPE / 2 - 12} x2={LOUPE / 2} y2={LOUPE / 2 + 12} stroke="#fff" strokeWidth={1} />
          <line x1={LOUPE / 2 - 12} y1={LOUPE / 2} x2={LOUPE / 2 + 12} y2={LOUPE / 2} stroke="#fff" strokeWidth={1} />
          <circle cx={LOUPE / 2} cy={LOUPE / 2} r={3} fill="none" stroke="#2dd4bf" strokeWidth={1.5} />
        </svg>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="checker absolute inset-0 flex items-center justify-center overflow-hidden">
      {!page.srcUrl || !page.width ? (
        <Spinner className="h-8 w-8 text-teal-300" />
      ) : (
        <div ref={boxRef} className="a-fade-in paper-shadow relative" style={{ width: dw, height: dh }}>
          <img src={page.srcUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none" />
          <svg
            ref={svgRef}
            width={dw}
            height={dh}
            className="absolute inset-0 touch-none overflow-visible"
            onPointerMove={onMove}
            onPointerUp={end}
            onPointerCancel={end}
            onPointerDown={() => setActive(null)}
          >
            <path
              d={`M${-PAD},${-PAD} H${dw + PAD} V${dh + PAD} H${-PAD} Z M${P[0].x},${P[0].y} L${P[1].x},${P[1].y} L${P[2].x},${P[2].y} L${P[3].x},${P[3].y} Z`}
              fill="rgba(3,6,14,0.66)"
              fillRule="evenodd"
              pointerEvents="none"
            />
            <polygon points={poly} fill="rgba(45,212,191,0.05)" stroke={stroke} strokeWidth={2} pointerEvents="none" style={{ filter: `drop-shadow(0 0 5px ${stroke}99)` }} />
            {grid.map(([a, b], i) => (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,0.3)" strokeWidth={1} strokeDasharray="4 5" pointerEvents="none" />
            ))}
            {/* edge handles (below corners) */}
            {[0, 1, 2, 3].map((i) => {
              const a = P[i];
              const b = P[(i + 1) % 4];
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
              const hot = drag?.kind === 'edge' && drag.idx === i;
              return (
                <g
                  key={`e${i}`}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => begin(e, { kind: 'edge', idx: i, origin: rawNorm(e.clientX, e.clientY), start: quad })}
                >
                  <circle cx={mx} cy={my} r={22} fill="transparent" />
                  <rect
                    x={mx - 15}
                    y={my - 4.5}
                    width={30}
                    height={9}
                    rx={4.5}
                    transform={`rotate(${ang} ${mx} ${my})`}
                    fill={hot ? '#2dd4bf' : '#fff'}
                    stroke="rgba(3,6,14,0.55)"
                    strokeWidth={1.5}
                    style={{ transition: 'fill .15s', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.5))' }}
                  />
                </g>
              );
            })}
            {/* corner handles */}
            {P.map((p, i) => {
              const hot = (drag?.kind === 'corner' && drag.idx === i) || active === i;
              return (
                <g
                  key={`c${i}`}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => begin(e, { kind: 'corner', idx: i })}
                >
                  <circle cx={p.x} cy={p.y} r={26} fill="transparent" />
                  {hot && <circle cx={p.x} cy={p.y} r={19} fill="rgba(45,212,191,0.18)" stroke="rgba(45,212,191,0.5)" />}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={hot ? 11 : 9.5}
                    fill={hot ? '#2dd4bf' : '#fff'}
                    stroke="rgba(3,6,14,0.7)"
                    strokeWidth={2}
                    style={{ transition: 'r .15s, fill .15s', filter: 'drop-shadow(0 2px 5px rgba(0,0,0,.55))' }}
                  />
                </g>
              );
            })}
          </svg>
          {loupeEl}
        </div>
      )}
    </div>
  );
}
