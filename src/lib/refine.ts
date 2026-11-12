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
    if (white <= 175 || dark < count * .002)
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

/** Recover the visible crop when a sheet runs beyond three frame edges.
 * Require the detected bottom edge to continue past the interior right corner. */
export function recoverFrameSpanningPage(image: RGBAImage, quad: Quad): Quad {
    const { width, height, data } = image;
    const [tl, tr, br, bl] = quad;
    if (Math.max(tl.x, bl.x) > .025 || tr.x < .85 || br.x < .55 || br.x > .92 ||
        Math.max(tl.y, tr.y) > .2 || Math.min(tl.y, tr.y) < .025 ||
        Math.min(bl.y, br.y) < .7 || Math.abs(bl.y - br.y) > .08) return quad;

    const slope = (br.y - bl.y) / (br.x - bl.x);
    const bottomAt = (x: number) => bl.y + slope * (x - bl.x);
    const probe = Math.max(3, Math.round(height * .005));
    const luminance = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    };
    // Check both the existing edge and its continuation, including near the
    // right frame. A printed horizontal line normally has paper on both sides.
    let supported = 0;
    for (let i = 0; i < 24; i++) {
        const x = .08 + .9 * i / 23;
        const px = Math.round(x * (width - 1));
        const py = Math.round(bottomAt(x) * height);
        if (py < 2 * probe || py >= height - 2 * probe) return quad;
        const step = luminance(px, py - probe) - luminance(px, py + probe);
        const wide = luminance(px, py - 2 * probe) - luminance(px, py + 2 * probe);
        if (step >= 8 && wide >= 8) supported++;
    }
    if (supported < 19) return quad;
    return [{ x: 0, y: 0 }, { x: 1, y: 0 },
        { x: 1, y: bottomAt(1) }, { x: 0, y: bottomAt(0) }];
}

/** Find opposing paper edges when the other two sides run out of the photo.
 * A persistent change between surfaces rejects thin printed rules. */
export function detectFrameSpanningPaper(image: RGBAImage): Quad | undefined {
    const { width, height, data } = image;
    const findEdges = (across: number, depth: number, transposed: boolean) => {
        const gray = (x: number, y: number) => {
            const i = (transposed ? x * width + y : y * width + x) * 4;
            return .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
        };
        const gap = Math.max(2, Math.round(depth * .004));
        const edge = (reverse: boolean) => {
            const points: Pt[] = [];
            for (let column = 0; column < 32; column++) {
                const x = Math.round((.035 + .93 * column / 31) * (across - 1));
                const read = (d: number) => gray(x, reverse ? depth - 1 - d : d);
                let best = 24;
                let position = 0;
                for (let y = 2 * gap; y < depth * .22; y++) {
                    const inside = Math.min(read(y + gap), read(y + 2 * gap));
                    const outside = Math.max(read(y - gap), read(y - 2 * gap));
                    if (inside < 143 || inside - outside <= best) continue;
                    best = inside - outside;
                    position = y;
                }
                if (position) points.push({ x: x / (across - 1), y: position / (depth - 1) });
            }
            let support: Pt[] = [];
            for (const a of points) for (const b of points) {
                if (b.x - a.x < .25) continue;
                const slope = (b.y - a.y) / (b.x - a.x);
                if (Math.abs(slope) > .16) continue;
                const nearby = points.filter(p => Math.abs(p.y - a.y - slope * (p.x - a.x)) < .012);
                if (nearby.length > support.length) support = nearby;
            }
            if (support.length < 18 || support[support.length - 1].x - support[0].x < .52) return;
            const line = fit(support);
            const at = (x: number) => clamp((line.c - line.nx * x) / line.ny - .007, 0, .24);
            return { ends: [at(0), at(1)], count: support.length };
        };
        const near = edge(false), far = edge(true);
        if (!near || !far) return;
        return { near: near.ends, far: far.ends, score: near.count + far.count };
    };
    if (Math.min(width, height) < 64) return;
    const vertical = findEdges(width, height, false);
    const horizontal = findEdges(height, width, true);
    if (vertical && (!horizontal || vertical.score >= horizontal.score)) {
        return [{ x: 0, y: vertical.near[0] }, { x: 1, y: vertical.near[1] },
            { x: 1, y: 1 - vertical.far[1] }, { x: 0, y: 1 - vertical.far[0] }];
    }
    if (horizontal) {
        return [{ x: horizontal.near[0], y: 0 }, { x: 1 - horizontal.far[0], y: 0 },
            { x: 1 - horizontal.far[1], y: 1 }, { x: horizontal.near[1], y: 1 }];
    }
}
/** A narrow result can be a table row. Look for printed strokes well beyond
 * its long edges before discarding the rest of the image. */
export function excludesPrintedContent(image: RGBAImage, quad: Quad): boolean {
    const { width, height, data } = image;
    if (polygonArea(quad) > .35) return false;
    const xs = quad.map(p => p.x), ys = quad.map(p => p.y);
    const left = Math.min(...xs), right = Math.max(...xs);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    const luminance = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    };
    const probe = Math.max(2, Math.round(Math.min(width, height) / 200));
    let textTiles = 0;
    for (let row = 1; row < 7; row++) {
        for (let col = 1; col < 7; col++) {
            const x0 = col / 8, x1 = (col + 1) / 8;
            const y0 = row / 8, y1 = (row + 1) / 8;
            if (!(x1 < left - .02 || x0 > right + .02 || y1 < top - .02 || y0 > bottom + .02)) continue;
            let strokes = 0, light = 0, samples = 0;
            for (let y = Math.ceil(y0 * height); y < y1 * height; y += 2) {
                for (let x = Math.ceil(x0 * width); x < x1 * width; x += 2) {
                    const center = luminance(x, y);
                    const above = luminance(x, y - probe), below = luminance(x, y + probe);
                    samples++;
                    if (center > 140) light++;
                    if (Math.min(above, below) > Math.max(130, center + 35)) strokes++;
                }
            }
            if (light > samples * .55 && strokes > samples * .008 && ++textTiles >= 5) return true;
        }
    }
    return false;
}
/** Verify sides that remove substantial margins. Thin rules can produce a
 * strong gradient but do not separate two surfaces across the side. */
export function cutsThroughPaper(image: RGBAImage, quad: Quad): boolean {
    const { width, height, data } = image;
    const margin = Math.max(width, height) * .075;
    const probe = Math.max(4, Math.round(Math.min(width, height) * .012));
    const channel = (x: number, y: number, c: number) =>
        data[(Math.round(y) * width + Math.round(x)) * 4 + c];
    for (let side = 0; side < 4; side++) {
        const a = quad[side], b = quad[(side + 1) % 4];
        const ax = a.x * (width - 1), ay = a.y * (height - 1);
        const dx = (b.x - a.x) * (width - 1), dy = (b.y - a.y) * (height - 1);
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;
        const nx = dy / len, ny = -dx / len;
        let samples = 0, supported = 0;
        for (let i = 0; i < 24; i++) {
            const t = .12 + .76 * (i + .5) / 24;
            const x = ax + t * dx, y = ay + t * dy;
            const inside = (d: number) => x + nx * d >= 0 && x + nx * d < width - 1 &&
                y + ny * d >= 0 && y + ny * d < height - 1;
            if (!inside(margin) || !inside(-2 * probe)) continue;
            samples++;
            let near = 0, far = 0, agreement = 0;
            for (let c = 0; c < 3; c++) {
                const delta = channel(x + nx * probe, y + ny * probe, c) -
                    channel(x - nx * probe, y - ny * probe, c);
                const wide = channel(x + nx * 2 * probe, y + ny * 2 * probe, c) -
                    channel(x - nx * 2 * probe, y - ny * 2 * probe, c);
                near += delta * delta;
                far += wide * wide;
                agreement += delta * wide;
            }
            if (near >= 3 * 9 ** 2 && far >= 3 * 9 ** 2 && agreement > 0) supported++;
        }
        // An endpoint at the frame leaves fewer usable samples on this side.
        const touchesFrame = [a, b].some(p => p.x <= .02 || p.x >= .98 || p.y <= .02 || p.y >= .98);
        if (samples >= (touchesFrame ? 8 : 18) && supported < samples * .5) return true;
    }
    return false;
}

/** Recover a visible left edge when a frame-clipped candidate substitutes
 * the image border for the paper. Keep the visible top and bottom limits. */
export function recoverVisibleLeftEdge(image: RGBAImage, quad: Quad): Quad {
    const { width, height, data } = image;
    const [tl, tr, br, bl] = quad;
    if (tl.x > .02 || tl.y > .02 || tr.y > .02 || tr.x < .97 ||
        br.x < .97 || bl.x > .15 || bl.y < .7 || br.y < .7) return quad;

    const step = Math.max(3, Math.round(width * .006));
    const points: Pt[] = [];
    const luma = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    };
    for (let i = 0; i < 32; i++) {
        const y = Math.round(height * (.05 + .79 * i / 31));
        let best = 18, edge = 0;
        for (let x = 2 * step; x < width * .25; x++) {
            const near = luma(x + step, y) - luma(x - step, y);
            const far = luma(x + 2 * step, y) - luma(x - 2 * step, y);
            const score = Math.min(near, far);
            if (score > best && luma(x + step, y) > 145) {
                best = score;
                edge = x;
            }
        }
        if (edge) points.push({ x: edge / width, y: y / height });
    }
    let consensus: Pt[] = [];
    for (const a of points) for (const b of points) {
        if (b.y - a.y < .35) continue;
        const slope = (b.x - a.x) / (b.y - a.y);
        if (Math.abs(slope) > .28) continue;
        const inliers = points.filter(p => Math.abs(p.x - a.x - slope * (p.y - a.y)) < .009);
        if (inliers.length > consensus.length) consensus = inliers;
    }
    if (consensus.length < 17 || consensus.at(-1)!.y - consensus[0].y < .5) return quad;
    const line = fit(consensus);
    if (Math.abs(line.nx) < .9) return quad;
    const topX = (line.c - line.ny * tl.y) / line.nx;
    const bottomSlope = (br.y - bl.y) / (br.x - bl.x);
    const bottomX = (line.c - line.ny * (bl.y - bottomSlope * bl.x)) /
        (line.nx + line.ny * bottomSlope);
    if (!(topX > .05 && topX < .25 && bottomX >= 0 && bottomX < .25)) return quad;
    const recovered: Quad = [
        { x: topX, y: tl.y }, tr, br,
        { x: bottomX, y: bl.y + bottomSlope * (bottomX - bl.x) },
    ];
    return isConvex(recovered) ? recovered : quad;
}

/** Find real paper edges when a near-full landscape candidate has borrowed
 * two image borders. Search only the outer bands, away from printed content. */
export function recoverLandscapePaperEdges(image: RGBAImage, quad: Quad): Quad {
    const { width, height, data } = image;
    const [tl, tr, br, bl] = quad;
    if (width < height * 1.12 || polygonArea(quad) < .68 ||
        Math.max(tl.x, bl.x) > .025 || Math.min(bl.y, br.y) < .975 ||
        Math.max(tl.y, tr.y) > .12 || Math.min(tr.x, br.x) < .78) return quad;

    const lum = (x: number, y: number) => {
        const i = (y * width + x) * 4;
        return .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    };
    const rows = 36;
    function edge(horizontal: boolean, farSide: boolean): Line | null {
        const across = horizontal ? height : width;
        const along = horizontal ? width : height;
        const probe = Math.max(2, Math.round(across * .003));
        const scan: { point: Pt; weight: number }[][] = [];
        for (let row = 0; row < rows; row++) {
            const at = Math.round(along * (.12 + .76 * (row + .5) / rows));
            const get = (p: number) => horizontal ? lum(at, p) : lum(p, at);
            const limit = Math.round(across * .135);
            const start = farSide ? across - limit : probe * 3;
            const end = farSide ? across - probe * 3 : limit;
            const choices: { point: Pt; weight: number }[] = [];
            for (let p = start; p < end; p++) {
                const near = get(p + probe) - get(p - probe);
                const wide = get(p + probe * 3) - get(p - probe * 3);
                if (near * wide <= 0 || Math.abs(near) < 6 || Math.abs(wide) < 10) continue;
                choices.push({ point: { x: at / along, y: p / across }, weight: Math.min(near * near, wide * wide, 2500) ** .5 });
            }
            choices.sort((a, b) => b.weight - a.weight);
            const peaks: typeof choices = [];
            for (const choice of choices) {
                if (peaks.every(p => Math.abs(p.point.y - choice.point.y) > probe * 2 / across)) peaks.push(choice);
                if (peaks.length === 4) break;
            }
            scan.push(peaks);
        }
        let best: Pt[] = [], bestScore = 0;
        for (let i = 0; i < rows; i += 2) for (let j = i + 15; j < rows; j += 2) {
            for (const a of scan[i]) for (const b of scan[j]) {
                const slope = (b.point.y - a.point.y) / (b.point.x - a.point.x);
                if (Math.abs(slope) > .18) continue;
                const intercept = a.point.y - slope * a.point.x;
                const inliers: Pt[] = [];
                let score = 0;
                for (const row of scan) {
                    const match = row.find(p => Math.abs(p.point.y - intercept - slope * p.point.x) < .008);
                    if (match) {
                        inliers.push(match.point);
                        score += 1 + Math.min(1, match.weight / 35);
                    }
                }
                if (inliers.length >= 18 && inliers.at(-1)!.x - inliers[0].x > .43 && score > bestScore) {
                    best = inliers;
                    bestScore = score;
                }
            }
        }
        if (!best.length) return null;
        return fit(best.map(p => horizontal ? p : { x: p.y, y: p.x }));
    }
    const left = edge(false, false), right = edge(false, true), bottom = edge(true, true);
    if (!left || !right || !bottom) return quad;
    const top = edge(true, false) ?? fit([tl, tr]);
    const intersect = (a: Line, b: Line): Pt => {
        const d = a.nx * b.ny - a.ny * b.nx;
        return { x: (a.c * b.ny - a.ny * b.c) / d, y: (a.nx * b.c - a.c * b.nx) / d };
    };
    const points = [intersect(left, top), intersect(top, right), intersect(right, bottom), intersect(bottom, left)];
    if (points.some(p => !Number.isFinite(p.x + p.y) || p.x < -.025 || p.x > 1.025 || p.y < -.025 || p.y > 1.025)) return quad;
    // A fold or a printed rule near the top can appear stronger than the
    // physical edge. Do not move either recovered top corner into the page.
    for (const corner of points.slice(0, 2)) {
        const previousY = tl.y + (tr.y - tl.y) * (corner.x - tl.x) / (tr.x - tl.x);
        corner.y = Math.min(corner.y, previousY);
    }
    const result = points.map(p => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) })) as Quad;
    return isConvex(result) && polygonArea(result) >= .68 ? result : quad;
}
