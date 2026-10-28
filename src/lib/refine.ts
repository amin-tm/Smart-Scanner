import type { Pt, Quad } from './types';
import { clamp, dist, isConvex, polygonArea, type RGBAImage } from './imageproc';
interface Line {
    nx: number;
    ny: number;
    c: number;
}
/** Conservative evidence for an existing scan: paper on nearly the entire
 * perimeter plus ink inside it. Uniform surfaces deliberately return false. */
export function isFullPageScan(image: RGBAImage): boolean {
    const { width: W, height: H, data } = image;
    if (W < 16 || H < 16)
        return false;
    const hist = new Uint32Array(256);
    let count = 0;
    const luminance = (i: number) => .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    for (let i = 0; i < data.length; i += 16) {
        hist[Math.round(luminance(i))]++;
        count++;
    }
    let acc = 0, white = 255, dark = 0;
    for (let i = 0; i < 256; i++) {
        acc += hist[i];
        if (acc >= count * .9) {
            white = i;
            break;
        }
    }
    for (let i = 0; i < white * .75; i++)
        dark += hist[i];
    if (white <= 175 || dark < count * .02)
        return false;
    let samePaper = 0, border = 0;
    const probe = (x: number, y: number) => {
        const i = (y * W + x) * 4, max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]);
        border++;
        if (luminance(i) >= white * .96 && (max - min) / Math.max(1, max) < .18)
            samePaper++;
    };
    for (let x = 2; x < W - 2; x += 4) {
        probe(x, 2);
        probe(x, H - 3);
    }
    for (let y = 2; y < H - 2; y += 4) {
        probe(2, y);
        probe(W - 3, y);
    }
    return samePaper / border > .92;
}
function fit(points: Pt[]): Line {
    const x = points.reduce((s, p) => s + p.x, 0) / points.length;
    const y = points.reduce((s, p) => s + p.y, 0) / points.length;
    let xx = 0, xy = 0, yy = 0;
    for (const p of points) {
        xx += (p.x - x) ** 2;
        xy += (p.x - x) * (p.y - y);
        yy += (p.y - y) ** 2;
    }
    const angle = .5 * Math.atan2(2 * xy, xx - yy);
    const nx = -Math.sin(angle), ny = Math.cos(angle);
    return { nx, ny, c: nx * x + ny * y };
}
/** Refine contour corners against the original resolution. Fit each physical
 * edge independently, then intersect the fitted lines. Robust consensus ignores
 * fingers, table lines and text; frame edges stay fixed for clipped documents. */
export function refineDocumentQuad(image: RGBAImage, quad: Quad): Quad {
    const { width: W, height: H, data } = image;
    const q = quad.map(p => ({ x: p.x * W, y: p.y * H })) as Quad;
    const long = Math.max(W, H), radius = Math.max(5, Math.round(long * .025));
    const sample = (x: number, y: number, c: number) => {
        const ix = clamp(Math.round(x), 0, W - 1), iy = clamp(Math.round(y), 0, H - 1);
        return data[(iy * W + ix) * 4 + c];
    };
    const lines: Line[] = [];
    for (let s = 0; s < 4; s++) {
        const a = q[s], b = q[(s + 1) % 4], len = dist(a, b);
        if (len < 8)
            return quad;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        const original = { nx, ny, c: nx * a.x + ny * a.y };
        // Never snap an edge at the image boundary to an interior printed line.
        if ((a.x < 2 && b.x < 2) || (a.y < 2 && b.y < 2) || (a.x > W - 2 && b.x > W - 2) || (a.y > H - 2 && b.y > H - 2)) {
            lines.push(original);
            continue;
        }
        const points: Pt[] = [];
        const count = Math.max(24, Math.min(100, Math.round(len / 8)));
        const probe = Math.max(2, Math.round(long / 500));
        for (let k = 0; k < count; k++) {
            const t = .08 + .84 * (k + .5) / count, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
            let best = 0, offset = 0;
            for (let o = -radius; o <= radius; o++) {
                const x = px + nx * o, y = py + ny * o;
                if (x < probe + 1 || y < probe + 1 || x >= W - probe - 1 || y >= H - probe - 1)
                    continue;
                let step = 0, local = 0;
                for (let c = 0; c < 3; c++) {
                    // Wide and narrow differences must agree: an isolated text stroke
                    // has two opposite edges, unlike the sustained paper/table step.
                    const d = sample(x + nx * probe, y + ny * probe, c) - sample(x - nx * probe, y - ny * probe, c);
                    const g = sample(x + nx, y + ny, c) - sample(x - nx, y - ny, c);
                    step += d * d;
                    local += d * g;
                }
                const score = local > 0 ? Math.sqrt(step) * (0.3 + 0.7 * Math.exp(-o * o / (radius * radius * .65))) : 0;
                if (score > best) {
                    best = score;
                    offset = o;
                }
            }
            if (best > 12)
                points.push({ x: px + nx * offset, y: py + ny * offset });
        }
        if (points.length < count * .4) {
            lines.push(original);
            continue;
        }
        // Deterministic RANSAC: a least-squares fit alone can follow a finger
        // protruding at one end of a side. Require inliers spread along the side.
        let inliers: Pt[] = [];
        const tolerance = Math.max(1.4, long * .0015);
        for (let i = 0; i < points.length; i += 3)
            for (let j = i + Math.max(6, Math.floor(points.length / 3)); j < points.length; j += 3) {
                const u = points[i], v = points[j], l = dist(u, v);
                if (l < len * .25)
                    continue;
                const nnx = -(v.y - u.y) / l, nny = (v.x - u.x) / l;
                if (Math.abs(nnx * nx + nny * ny) < .98)
                    continue;
                const c = nnx * u.x + nny * u.y;
                const set = points.filter(p => Math.abs(nnx * p.x + nny * p.y - c) <= tolerance);
                if (set.length > inliers.length)
                    inliers = set;
            }
        if (inliers.length < Math.max(12, count * .4)) {
            lines.push(original);
            continue;
        }
        lines.push(fit(inliers));
    }
    const refined: Pt[] = [];
    for (let i = 0; i < 4; i++) {
        const a = lines[(i + 3) % 4], b = lines[i], det = a.nx * b.ny - a.ny * b.nx;
        if (Math.abs(det) < .08)
            return quad;
        const p = { x: (a.c * b.ny - a.ny * b.c) / det, y: (a.nx * b.c - a.c * b.nx) / det };
        if (dist(p, q[i]) > radius * 2.5)
            return quad;
        refined.push(p);
    }
    const area = polygonArea(refined) / polygonArea(q);
    if (!isConvex(refined) || area < .8 || area > 1.2)
        return quad;
    return refined.map(p => ({ x: clamp(p.x / W, 0, 1), y: clamp(p.y / H, 0, 1) })) as Quad;
}
