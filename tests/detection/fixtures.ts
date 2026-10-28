import { homography, applyH, type RGBAImage } from '../../src/lib/imageproc';
import type { Quad } from '../../src/lib/types';
export interface Fixture {
    name: string;
    image: RGBAImage;
    quad: Quad;
    document: boolean;
}
// Deterministic rendered photographs. Labels are the four supplied physical
// page corners, independent of the detector's segmentation and line fitting.
export function fixture(name: string, q: Quad, options: {
    background?: number[];
    paper?: number[];
    shadow?: number;
    texture?: number;
    finger?: boolean;
    frame?: boolean;
    blank?: boolean;
    width?: number;
    height?: number;
} = {}): Fixture {
    const width = options.width ?? 960, height = options.height ?? 720;
    const data = new Uint8ClampedArray(width * height * 4);
    const bg = options.background ?? [68, 82, 94], paper = options.paper ?? [242, 240, 232];
    const quad = q.map(p => ({ x: p.x * width, y: p.y * height })) as Quad;
    const map = homography(quad, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])!;
    let seed = 1729;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const noise = ((seed / 4294967296) - 0.5) * 3;
            const uv = applyH(map, x + 0.5, y + 0.5);
            const inside = !options.blank && uv.x >= 0 && uv.x <= 1 && uv.y >= 0 && uv.y <= 1;
            let color = bg.map(v => v + (options.texture ?? 0) * (Math.sin(x / 8 + y / 110) + 0.35 * Math.cos(y / 19)));
            if (inside) {
                const shade = 1 - (options.shadow ?? 0) * (0.25 + 0.75 * uv.x) * (0.6 + 0.4 * uv.y);
                color = paper.map(v => v * shade);
                // Text with varying word lengths and a strong internal table border.
                const row = Math.floor(uv.y * 38), col = Math.floor(uv.x * 55);
                if (uv.x > .12 && uv.x < .87 && uv.y > .13 && uv.y < .88 &&
                    (uv.y * 38) % 1 < .21 && ((col + row * 3) % 11 < 8))
                    color = [35, 38, 42];
                if (options.frame && uv.x > .09 && uv.x < .91 && uv.y > .08 && uv.y < .92 &&
                    (uv.x < .096 || uv.x > .904 || uv.y < .086 || uv.y > .914))
                    color = [20, 22, 24];
                if (uv.x > .65 && uv.x < .84 && uv.y > .04 && uv.y < .09)
                    color = [35, 90, 160];
            }
            if (options.finger && ((x / width - q[1].x + .015) / .047) ** 2 + ((y / height - q[1].y - .1) / .15) ** 2 < 1)
                color = [186, 133, 103];
            const i = (y * width + x) * 4;
            for (let c = 0; c < 3; c++)
                data[i + c] = color[c] + noise;
            data[i + 3] = 255;
        }
    return { name, image: { data, width, height }, quad: q, document: !options.blank };
}
export function fixtures(): Fixture[] {
    const straight: Quad = [{ x: .18, y: .08 }, { x: .79, y: .08 }, { x: .79, y: .93 }, { x: .18, y: .93 }];
    const skew: Quad = [{ x: .23, y: .1 }, { x: .83, y: .19 }, { x: .73, y: .91 }, { x: .12, y: .78 }];
    const steep: Quad = [{ x: .34, y: .11 }, { x: .68, y: .24 }, { x: .9, y: .89 }, { x: .07, y: .8 }];
    const receipt: Quad = [{ x: .43, y: .06 }, { x: .61, y: .09 }, { x: .58, y: .95 }, { x: .35, y: .91 }];
    const cases = [
        fixture('straight', straight), fixture('perspective', skew),
        fixture('strong-perspective', steep), fixture('textured-desk', skew, { texture: 25, background: [114, 80, 51] }),
        fixture('shadow', skew, { shadow: .5 }), fixture('white-desk', skew, { background: [213, 214, 216] }),
        fixture('colored-paper', skew, { paper: [231, 207, 150] }),
        fixture('finger', skew, { finger: true }), fixture('internal-frame', skew, { frame: true }),
        fixture('receipt', receipt),
        fixture('landscape', [{ x: .09, y: .24 }, { x: .87, y: .12 }, { x: .92, y: .77 }, { x: .15, y: .87 }]),
        fixture('frame-edge-page', [{ x: 0, y: .13 }, { x: .8, y: .08 }, { x: .88, y: .94 }, { x: 0, y: .88 }]),
        fixture('full-page', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]),
        fixture('no-document', straight, { blank: true }),
    ];
    // Fixed hold-out variations: perspective, page colour, exposure, background
    // texture and input resolution vary independently of detector thresholds.
    for (let i = 0; i < 20; i++) {
        const q: Quad = [
            { x: .12 + (i % 5) * .028, y: .06 + (i % 3) * .027 },
            { x: .85 - (i % 4) * .035, y: .07 + (i % 5) * .022 },
            { x: .88 - (i % 3) * .035, y: .9 - (i % 4) * .018 },
            { x: .1 + (i % 4) * .025, y: .87 - (i % 5) * .023 },
        ];
        cases.push(fixture(`variation-${i + 1}`, q, {
            background: [45 + (i * 17) % 95, 45 + (i * 23) % 90, 45 + (i * 31) % 90],
            paper: [225 + (i % 4) * 5, 222 + (i % 3) * 8, 210 + (i % 5) * 7],
            shadow: (i % 4) * .1, texture: (i % 3) * 8, frame: i % 3 === 0,
            width: i % 2 ? 1200 : 800, height: i % 2 ? 900 : 1100,
        }));
    }
    return cases;
}
