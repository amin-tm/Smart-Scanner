import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import jpeg from 'jpeg-js';
import { detectWithCV } from '../../src/lib/cvDetect';
import { detectDocument } from '../../src/lib/detect';
import { fixtures } from './fixtures';
import type { Quad } from '../../src/lib/types';
const require = createRequire(import.meta.url);
const cv = await require('@techstark/opencv-js');
const fallback = process.argv.includes('--fallback');
const report = [];
await fs.mkdir('.test-output', { recursive: true });
const cases = fixtures().filter(f => !process.env.CASE || f.name === process.env.CASE);
if (process.argv.includes('--real')) {
    cases.length = 0;
    const labels = JSON.parse(await fs.readFile('tests/detection/real-labels.json', 'utf8'));
    for (const name of await fs.readdir('.test-output/reference/sample_images')) {
        const decoded = jpeg.decode(await fs.readFile(`.test-output/reference/sample_images/${name}`), { useTArray: true, maxMemoryUsageInMB: 512 });
        const mat = cv.matFromImageData(decoded), small = new cv.Mat();
        const scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height));
        cv.resize(mat, small, new cv.Size(Math.round(decoded.width * scale), Math.round(decoded.height * scale)), 0, 0, cv.INTER_AREA);
        cases.push({ name: 'real-' + name, image: { data: new Uint8ClampedArray(small.data), width: small.cols, height: small.rows }, quad: labels[name].map(([x, y]: number[]) => ({ x, y })), document: true });
        mat.delete();
        small.delete();
    }
}
for (const f of cases) {
    const start = performance.now();
    // Match the worker: the fallback searches a <=640px copy and refines
    // against the original test image; OpenCV receives the high-res image.
    let result;
    if (fallback) {
        const source = cv.matFromImageData(f.image), small = new cv.Mat();
        const scale = Math.min(1, 640 / Math.max(f.image.width, f.image.height));
        cv.resize(source, small, new cv.Size(Math.round(f.image.width * scale), Math.round(f.image.height * scale)), 0, 0, cv.INTER_AREA);
        result = detectDocument({ data: new Uint8ClampedArray(small.data), width: small.cols, height: small.rows }, f.image);
        source.delete();
        small.delete();
    }
    else
        result = detectWithCV(cv, f.image);
    // Cyclic point matching permits landscape/diamond documents without hiding
    // any misplaced corner. Error is measured against the image diagonal.
    const { width: W, height: H } = f.image;
    const error = Math.min(...[0, 1, 2, 3].map(offset => Math.max(...f.quad.map((p, i) => Math.hypot((p.x - result.quad[(i + offset) % 4].x) * W, (p.y - result.quad[(i + offset) % 4].y) * H) / Math.hypot(W, H))))) * 100;
    const pass = f.document ? result.found && error < 2 : !result.found;
    report.push({ name: f.name, found: result.found, score: +result.score.toFixed(3), error: f.document ? +error.toFixed(3) : null, pass, ms: Math.round(performance.now() - start) });
    const out = new Uint8ClampedArray(f.image.data);
    function draw(q: Quad, color: number[]) {
        for (let s = 0; s < 4; s++) {
            const a = q[s], b = q[(s + 1) % 4], n = Math.ceil(Math.hypot((a.x - b.x) * W, (a.y - b.y) * H));
            for (let k = 0; k <= n; k++)
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        const x = Math.round((a.x + (b.x - a.x) * k / n) * W) + dx, y = Math.round((a.y + (b.y - a.y) * k / n) * H) + dy;
                        if (x < 0 || x >= W || y < 0 || y >= H)
                            continue;
                        out.set(color, (y * W + x) * 4);
                    }
        }
    }
    draw(f.quad, [0, 220, 0, 255]);
    draw(result.quad, [255, 30, 40, 255]);
    await fs.writeFile(`.test-output/${fallback ? 'fallback-' : ''}${f.name}.jpg`, jpeg.encode({ data: out, width: W, height: H }, 85).data);
}
console.table(report);
await fs.writeFile(`.test-output/${process.argv.includes('--real') ? 'real-' : ''}${fallback ? 'fallback' : 'opencv'}-report.json`, JSON.stringify(report, null, 2));
if (report.some(r => !r.pass))
    process.exitCode = 1;
