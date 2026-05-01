// Pixel art pet renderer.
// The character is defined on a 32x32 grid, drawn inside a 48x48 canvas
// (8 character-pixel padding on each side) so trailing/overflow effects fit.
//
// Character layout (grid coords, 0-indexed):
//   Border   : 3px outer ring (x<3 or x>28, y<3 or y>28)
//   Left eye : x=7..11, y=10..14
//   Right eye: x=17..21, y=10..14
//
// Facing:
//   'left'  = normal orientation (no flip) — used when moving left
//   'right' = horizontally flipped          — used when moving right

const PET_CHAR_SIZE = 32;
const PET_PADDING = 8;
const PET_CANVAS_SIZE = PET_CHAR_SIZE + 2 * PET_PADDING; // 48

class PetRenderer {
    constructor(canvasId, initialScale = 8) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.scale = initialScale;
        this.facing = 'left';   // 'left'=no flip, 'right'=flip
        this.expression = 'normal';
        this.eyeOffsetY = 0;        // char-grid units: -2=up, 0=neutral, +2=down
        this.trailSide = 'none';   // 'none' | 'left' | 'right'
        this.shapeScaleX = 1;        // horizontal squash/stretch (1=normal)
        this.shapeScaleY = 1;        // vertical   squash/stretch (1=normal)
        this.rotation = 0;        // rotation in radians (0=upright)
        this.rotationPivotX = PET_PADDING + PET_CHAR_SIZE / 2; // 24 canvas char-px
        this.rotationPivotY = PET_PADDING + PET_CHAR_SIZE / 2; // 24 canvas char-px
        this.tailSwing = 0;     // 0=neutral, 1/2=small wag poses
        this.resetFx = null;    // mode reset cinematic overlay
        this.marqueeEnabled = false;
        this.marqueeText = '';
        this.marqueeOffset = 0; // char-px offset from marquee viewport left edge
        this.modes = {
            bodyColor: null,   // null = white; or CSS color string
            borderColor: null,   // null = black; or CSS color string
            rounded: false,  // round the outer corners
            eyeStyle: null,   // null | 'thin-v' | 'thin-h'
            eyeColor: null,   // null = black; or CSS color string
            bodyAlpha: 1,      // 1 = opaque, 0 = transparent
            hair: false,  // 3 hair strands above head
            antenna: false,  // signal-like 3 bars at top-right
            catEars: false,  // two triangle ears on head
            tail: false,  // tail from lower-right; wags with blink
            sunglasses8: false,  // "deal with it" style pixel shades
            sizeScale: 1,      // overall size multiplier (1 = normal, 0.667 = 2/3)
        };
        this._blinkTimer = null;
        this._isBusy = false;

        this._updateCanvasSize();
        this.render();
        this._scheduleBlink();
    }

    // ── public API ──────────────────────────────────────────────

    setScale(scale) {
        this.scale = Math.max(1, scale);
        this._updateCanvasSize();
        this.render();
    }

    setFacing(dir) {
        this.facing = dir;
        this.render();
    }

    setExpression(expr) {
        this.expression = expr;
        this.render();
    }

    setEyeOffsetY(offset) {
        this.eyeOffsetY = offset;
        this.render();
    }

    setTrailSide(side) {
        this.trailSide = side;
        this.render();
    }

    // sx/sy: scale factors relative to normal 32x32.
    // Squash: (1.25, 0.75)  Stretch: (0.75, 1.0)  Normal: (1, 1)
    // Pivot is the bottom-center of the character so squash presses into the ground.
    setShape(sx, sy) {
        this.shapeScaleX = sx;
        this.shapeScaleY = sy;
        this.render();
    }

    // Setting rotation to 0 also resets the pivot to center.
    setRotation(angle) {
        this.rotation = angle;
        if (angle === 0) {
            this.rotationPivotX = PET_PADDING + PET_CHAR_SIZE / 2;
            this.rotationPivotY = PET_PADDING + PET_CHAR_SIZE / 2;
        }
        this.render();
    }

    // px, py: pivot in canvas char-px (e.g. 40,40 = bottom-right corner).
    setPivot(px, py) {
        this.rotationPivotX = px;
        this.rotationPivotY = py;
    }

    // Set a single mode property. Repeated calls stack (different keys) or replace (same key).
    setMode(key, value) {
        this.modes[key] = value;
        this.render();
    }

    setMarquee(text, offset, enabled = true) {
        this.marqueeText = text || '';
        this.marqueeOffset = offset || 0;
        this.marqueeEnabled = enabled;
        this.render();
    }

    clearMarquee() {
        this.marqueeEnabled = false;
        this.marqueeText = '';
        this.marqueeOffset = 0;
        this.render();
    }

    setResetFx(fx) {
        this.resetFx = fx;
        this.render();
    }

    clearResetFx() {
        this.resetFx = null;
        this.render();
    }

    resetModes() {
        this.modes = {
            bodyColor: null, borderColor: null, rounded: false,
            eyeStyle: null, eyeColor: null, bodyAlpha: 1,
            hair: false, antenna: false, catEars: false, tail: false,
            sunglasses8: false, sizeScale: 1,
        };
        this.tailSwing = 0;
        this.render();
    }

    destroy() {
        if (this._blinkTimer) clearTimeout(this._blinkTimer);
    }

    // ── rendering ───────────────────────────────────────────────

    render() {
        const ctx = this.ctx;
        const s = this.scale;
        const canvasPx = PET_CANVAS_SIZE * s;

        ctx.clearRect(0, 0, canvasPx, canvasPx);

        // Trail is drawn with no transform so it stays fixed in canvas coords.
        this._drawTrail(s);

        if (this.resetFx && this.resetFx.active) {
            this._drawResetFx(s);
            return;
        }

        ctx.save();

        // Combined scale: animation squash/stretch × persistent size mode.
        // Pivot = bottom-center of character so squash presses into the ground.
        const totalSX = this.shapeScaleX * this.modes.sizeScale;
        const totalSY = this.shapeScaleY * this.modes.sizeScale;
        if (totalSX !== 1 || totalSY !== 1) {
            const px = (PET_PADDING + PET_CHAR_SIZE / 2) * s;
            const py = (PET_PADDING + PET_CHAR_SIZE) * s;
            ctx.translate(px, py);
            ctx.scale(totalSX, totalSY);
            ctx.translate(-px, -py);
        }

        // Rotation — pivot is configurable (default center, corner for rolling).
        if (this.rotation !== 0) {
            const cx = this.rotationPivotX * s;
            const cy = this.rotationPivotY * s;
            ctx.translate(cx, cy);
            ctx.rotate(this.rotation);
            ctx.translate(-cx, -cy);
        }

        // Horizontal flip for rightward movement.
        if (this.facing === 'right') {
            ctx.translate(canvasPx, 0);
            ctx.scale(-1, 1);
        }

        this._drawBody(s);
        this._drawTailMode(s);
        this._drawEyes(s);
        this._drawSunglasses8(s);
        this._drawMarquee(s);
        this._drawHair(s);
        this._drawAntenna(s);
        this._drawCatEars(s);

        ctx.restore();
    }

    _drawBody(s) {
        const P = PET_PADDING;
        const bc = this.modes.borderColor || '#000000';
        const fc = this.modes.bodyColor || '#FFFFFF';
        const ctx = this.ctx;

        const alpha = this.modes.bodyAlpha ?? 1;
        if (alpha !== 1) ctx.globalAlpha = alpha;

        if (this.modes.rounded) this._drawBodyRounded(s, P, bc, fc);
        else this._drawBodyNormal(s, P, bc, fc);

        if (alpha !== 1) ctx.globalAlpha = 1;
    }

    // Normal: rectangular body with 3px border.
    _drawBodyNormal(s, P, bc, fc) {
        const ctx = this.ctx;
        // Draw border as one solid rect first, then punch inner fill.
        // This avoids seam artifacts at border joins under transformed scaling.
        ctx.fillStyle = bc;
        ctx.fillRect(P * s, P * s, 32 * s, 32 * s);
        ctx.fillStyle = fc;
        ctx.fillRect((P + 3) * s, (P + 3) * s, 26 * s, 26 * s);
    }

    // Rounded: outer corners use roundRect with radius = border thickness.
    _drawBodyRounded(s, P, bc, fc) {
        const ctx = this.ctx;
        const radius = 3 * s;
        ctx.beginPath();
        ctx.roundRect(P * s, P * s, 32 * s, 32 * s, radius);
        ctx.fillStyle = bc;
        ctx.fill();
        ctx.fillStyle = fc;
        ctx.fillRect((P + 3) * s, (P + 3) * s, 26 * s, 26 * s);
    }

    _drawEyes(s) {
        const ctx = this.ctx;
        const P = PET_PADDING;
        const ex = P * s;
        const ey = (P + 10 + this.eyeOffsetY) * s;
        const style = this.modes.eyeStyle; // null | 'thin-v' | 'thin-h'

        ctx.fillStyle = this.modes.eyeColor || '#000000';

        const extendTopRight2 = (leftX, topY, width, height, rightX, topY2, width2, height2) => {
            // Extend by 1px to the right for the top 2 pixels (rows), attached to eye blocks.
            ctx.fillRect(ex + (leftX + width) * s, ey + topY * s, s, s);
            ctx.fillRect(ex + (rightX + width2) * s, ey + topY2 * s, s, s);
            if (height >= 2) ctx.fillRect(ex + (leftX + width) * s, ey + (topY + 1) * s, s, s);
            if (height2 >= 2) ctx.fillRect(ex + (rightX + width2) * s, ey + (topY2 + 1) * s, s, s);
        };

        switch (this.expression) {
            case 'blink_half':
                if (style === 'thin-v') {
                    ctx.fillRect(ex + 7 * s, ey + 1 * s, 5 * s, s);
                    ctx.fillRect(ex + 17 * s, ey + 1 * s, 5 * s, s);
                    extendTopRight2(7, 1, 5, 1, 17, 1, 5, 1);
                } else if (style === 'thin-h') {
                    ctx.fillRect(ex + 8 * s, ey, 2 * s, 3 * s);
                    ctx.fillRect(ex + 18 * s, ey, 2 * s, 3 * s);
                    extendTopRight2(8, 0, 2, 3, 18, 0, 2, 3);
                } else {
                    ctx.fillRect(ex + 7 * s, ey, 5 * s, 3 * s);
                    ctx.fillRect(ex + 17 * s, ey, 5 * s, 3 * s);
                    extendTopRight2(7, 0, 5, 3, 17, 0, 5, 3);
                }
                break;

            case 'blink_closed':
                if (style === 'thin-h') {
                    ctx.fillRect(ex + 8 * s, ey + 2 * s, 2 * s, s);
                    ctx.fillRect(ex + 18 * s, ey + 2 * s, 2 * s, s);
                    extendTopRight2(8, 2, 2, 1, 18, 2, 2, 1);
                } else {
                    ctx.fillRect(ex + 7 * s, ey + 2 * s, 5 * s, s);
                    ctx.fillRect(ex + 17 * s, ey + 2 * s, 5 * s, s);
                    extendTopRight2(7, 2, 5, 1, 17, 2, 5, 1);
                }
                break;

            case 'drag':
                for (let i = 0; i < 5; i++) {
                    ctx.fillRect(ex + (7 + i) * s, ey + i * s, s, s);
                    ctx.fillRect(ex + (11 - i) * s, ey + i * s, s, s);
                    ctx.fillRect(ex + (17 + i) * s, ey + i * s, s, s);
                    ctx.fillRect(ex + (21 - i) * s, ey + i * s, s, s);
                }
                break;

            default: // 'normal'
                if (style === 'thin-v') {
                    ctx.fillRect(ex + 7 * s, ey + 2 * s, 5 * s, 2 * s);
                    ctx.fillRect(ex + 17 * s, ey + 2 * s, 5 * s, 2 * s);
                    extendTopRight2(7, 2, 5, 2, 17, 2, 5, 2);
                } else if (style === 'thin-h') {
                    ctx.fillRect(ex + 8 * s, ey, 2 * s, 5 * s);
                    ctx.fillRect(ex + 18 * s, ey, 2 * s, 5 * s);
                    extendTopRight2(8, 0, 2, 5, 18, 0, 2, 5);
                } else {
                    ctx.fillRect(ex + 7 * s, ey, 5 * s, 5 * s);
                    ctx.fillRect(ex + 17 * s, ey, 5 * s, 5 * s);
                    extendTopRight2(7, 0, 5, 5, 17, 0, 5, 5);
                }
        }
    }

    // 1 hair set at the top-center of the character's head.
    // Shape: short down-arrow-like "v + l" made by 3 strands.
    _drawHair(s) {
        if (!this.modes.hair) return;
        const ctx = this.ctx;
        const alpha = this.modes.bodyAlpha ?? 1;
        if (alpha !== 1) { ctx.save(); ctx.globalAlpha = alpha; }
        ctx.fillStyle = this.modes.borderColor || '#000000';
        const cx = PET_PADDING + PET_CHAR_SIZE / 2; // 24 — horizontal center
        // Left strand "\".
        ctx.fillRect((cx - 2) * s, 5 * s, s, s);
        ctx.fillRect((cx - 1) * s, 6 * s, s, s);
        // Center strand "|".
        ctx.fillRect(cx * s, 5 * s, s, s);
        ctx.fillRect(cx * s, 6 * s, s, s);
        ctx.fillRect(cx * s, 7 * s, s, s);
        // Right strand "/".
        ctx.fillRect((cx + 2) * s, 5 * s, s, s);
        ctx.fillRect((cx + 1) * s, 6 * s, s, s);
        if (alpha !== 1) ctx.restore();
    }

    _drawAntenna(s) {
        if (!this.modes.antenna) return;
        const ctx = this.ctx;
        const alpha = this.modes.bodyAlpha ?? 1;
        if (alpha !== 1) { ctx.save(); ctx.globalAlpha = alpha; }
        ctx.fillStyle = this.modes.borderColor || '#000000';

        // Top-right signal bars: small / medium / large.
        ctx.fillRect(41 * s, 6 * s, s, 2 * s);
        ctx.fillRect(43 * s, 4 * s, s, 4 * s);
        ctx.fillRect(45 * s, 2 * s, s, 6 * s);

        if (alpha !== 1) ctx.restore();
    }

    _drawCatEars(s) {
        if (!this.modes.catEars) return;
        const ctx = this.ctx;
        const alpha = this.modes.bodyAlpha ?? 1;
        if (alpha !== 1) { ctx.save(); ctx.globalAlpha = alpha; }
        ctx.fillStyle = this.modes.borderColor || '#000000';

        // Right-angle ear pair with right-angle corners facing inward.
        // Left ear: rows widen to the left (inner corner on right side).
        const lx = 15, y0 = 3;
        ctx.fillRect((lx + 0) * s, (y0 + 0) * s, 1 * s, s);
        ctx.fillRect((lx - 1) * s, (y0 + 1) * s, 2 * s, s);
        ctx.fillRect((lx - 2) * s, (y0 + 2) * s, 3 * s, s);
        ctx.fillRect((lx - 3) * s, (y0 + 3) * s, 4 * s, s);
        ctx.fillRect((lx - 4) * s, (y0 + 4) * s, 5 * s, s);

        // Right ear: rows widen to the right (inner corner on left side).
        const rx = 33;
        ctx.fillRect((rx + 0) * s, (y0 + 0) * s, 1 * s, s);
        ctx.fillRect((rx + 0) * s, (y0 + 1) * s, 2 * s, s);
        ctx.fillRect((rx + 0) * s, (y0 + 2) * s, 3 * s, s);
        ctx.fillRect((rx + 0) * s, (y0 + 3) * s, 4 * s, s);
        ctx.fillRect((rx + 0) * s, (y0 + 4) * s, 5 * s, s);

        if (alpha !== 1) ctx.restore();
    }

    _drawSunglasses8(s) {
        if (!this.modes.sunglasses8) return;
        const ctx = this.ctx;
        const bc = '#000000';
        const hi = '#FFFFFF';

        ctx.fillStyle = bc;
        // left lens (aligned over left eye x=7..11, y=10..14)
        ctx.fillRect(14 * s, 18 * s, 8 * s, 4 * s);
        ctx.fillRect(15 * s, 22 * s, 6 * s, s);
        // right lens (aligned over right eye x=17..21, y=10..14)
        ctx.fillRect(24 * s, 18 * s, 8 * s, 4 * s);
        ctx.fillRect(25 * s, 22 * s, 6 * s, s);
        // bridge
        ctx.fillRect(22 * s, 20 * s, 2 * s, s);
        // highlights
        ctx.fillStyle = hi;
        ctx.fillRect(15 * s, 18 * s, s, s);
        ctx.fillRect(16 * s, 19 * s, s, s);
        ctx.fillRect(17 * s, 20 * s, s, s);
        ctx.fillRect(25 * s, 18 * s, s, s);
        ctx.fillRect(26 * s, 19 * s, s, s);
        ctx.fillRect(27 * s, 20 * s, s, s);
    }

    _drawTailMode(s) {
        if (!this.modes.tail) return;
        const ctx = this.ctx;
        const alpha = this.modes.bodyAlpha ?? 1;
        if (alpha !== 1) { ctx.save(); ctx.globalAlpha = alpha; }

        const bc = this.modes.borderColor || '#000000';
        const fc = this.modes.bodyColor || '#FFFFFF';
        const k = this.tailSwing === 1 ? -1 : this.tailSwing === 2 ? 1 : 0;
        const ox = k > 0 ? 1 : 0;
        const oy = k < 0 ? 1 : 0;

        // Border silhouette (attached near lower-right of body).
        const bpts = [
            [40 + ox, 33 + oy], [41 + ox, 34 + oy], [42 + ox, 35 + oy],
            [43 + ox, 36 + oy], [44 + ox, 37 + oy], [45 + ox, 38 + oy],
            [46 + ox, 39 + oy], [45 + ox, 40 + oy], [44 + ox, 40 + oy],
            [43 + ox, 39 + oy], [42 + ox, 38 + oy], [41 + ox, 37 + oy]
        ];
        ctx.fillStyle = bc;
        for (const [x, y] of bpts) ctx.fillRect(x * s, y * s, s, s);

        // Inner fill.
        const fpts = [
            [42 + ox, 36 + oy], [43 + ox, 37 + oy], [44 + ox, 38 + oy], [43 + ox, 38 + oy]
        ];
        ctx.fillStyle = fc;
        for (const [x, y] of fpts) ctx.fillRect(x * s, y * s, s, s);

        if (alpha !== 1) ctx.restore();
    }

    _drawResetFx(s) {
        const fx = this.resetFx;
        if (!fx) return;
        const ctx = this.ctx;
        const bc = '#000000';
        const fc = '#FFFFFF';
        const P = PET_PADDING;

        if (fx.phase === 'scatter') {
            for (const p of fx.pieces || []) {
                ctx.fillStyle = p.c;
                ctx.fillRect(Math.round(p.x * s), Math.round(p.y * s), p.sz * s, p.sz * s);
            }
            return;
        }

        if (fx.phase === 'seed') {
            ctx.fillStyle = bc;
            ctx.fillRect(23 * s, 37 * s, 3 * s, 3 * s);
            return;
        }

        if (fx.phase === 'growV') {
            const h = Math.max(3, Math.min(32, fx.h || 3));
            const x = 23;
            const y = 40 - h;
            ctx.fillStyle = bc;
            ctx.fillRect(x * s, y * s, 3 * s, h * s);
            if (h > 6) {
                ctx.fillStyle = fc;
                ctx.fillRect((x + 1) * s, (y + 3) * s, s, (h - 6) * s);
            }
            return;
        }

        if (fx.phase === 'growH') {
            const w = Math.max(3, Math.min(32, fx.w || 3));
            const x = 24 - Math.floor(w / 2);
            const y = 8;
            ctx.fillStyle = bc;
            ctx.fillRect(x * s, y * s, w * s, 32 * s);
            if (w > 6) {
                ctx.fillStyle = fc;
                ctx.fillRect((x + 3) * s, (y + 3) * s, (w - 6) * s, 26 * s);
            }
            return;
        }

        if (fx.phase === 'blink') {
            ctx.fillStyle = bc;
            ctx.fillRect(P * s, P * s, 32 * s, 32 * s);
            ctx.fillStyle = fc;
            ctx.fillRect((P + 3) * s, (P + 3) * s, 26 * s, 26 * s);

            if (fx.eyes === 'normal') {
                ctx.fillStyle = bc;
                ctx.fillRect((P + 7) * s, (P + 10) * s, 5 * s, 5 * s);
                ctx.fillRect((P + 17) * s, (P + 10) * s, 5 * s, 5 * s);
                // right-side extension (top 2 pixels), same as regular eyes
                ctx.fillRect((P + 12) * s, (P + 10) * s, s, s);
                ctx.fillRect((P + 12) * s, (P + 11) * s, s, s);
                ctx.fillRect((P + 22) * s, (P + 10) * s, s, s);
                ctx.fillRect((P + 22) * s, (P + 11) * s, s, s);
            } else if (fx.eyes === 'closed') {
                ctx.fillStyle = bc;
                ctx.fillRect((P + 7) * s, (P + 12) * s, 5 * s, s);
                ctx.fillRect((P + 17) * s, (P + 12) * s, 5 * s, s);
                // closed line also keeps 1px right extension
                ctx.fillRect((P + 12) * s, (P + 12) * s, s, s);
                ctx.fillRect((P + 22) * s, (P + 12) * s, s, s);
            }
        }
    }

    _drawMarquee(s) {
        if (!this.marqueeEnabled || !this.marqueeText) return;

        const ctx = this.ctx;
        const alpha = this.modes.bodyAlpha ?? 1;
        if (alpha !== 1) { ctx.save(); ctx.globalAlpha = alpha; }

        // Display area: body interior below eyes.
        const vx = PET_PADDING + 4;
        const vy = PET_PADDING + 16;
        const vw = 24;
        const vh = 10;

        const bg = this.modes.bodyColor || '#FFFFFF';
        const fg = this.modes.borderColor || '#000000';

        ctx.fillStyle = bg;
        ctx.fillRect(vx * s, vy * s, vw * s, vh * s);

        ctx.save();
        ctx.beginPath();
        ctx.rect(vx * s, vy * s, vw * s, vh * s);
        ctx.clip();

        ctx.fillStyle = fg;
        this._drawDotText(this.marqueeText, vx + this.marqueeOffset, vy + 1, s);
        ctx.restore();

        if (alpha !== 1) ctx.restore();
    }

    _drawDotText(text, startX, startY, s) {
        const glyphs = {
            '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
            '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
            '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
            '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
            '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
            '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
            '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
            '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
            '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
            '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
            'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
            'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
            'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
            ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
            ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
            ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
            '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
            '\'': ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
            '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
            'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
            'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
            'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
            'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
            'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
            'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
            'J': ['00001', '00001', '00001', '00001', '10001', '10001', '01110'],
            'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
            'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
            'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
            'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
            'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
            'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
            '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
            'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
            'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
            'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
            'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
            'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
            'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
            'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
            'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
            'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
            'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
        };

        const upper = (text || '')
            .normalize('NFKD')
            .replace(/…/g, '...')
            .toUpperCase();
        let x = startX;
        for (const ch of upper) {
            const g = glyphs[ch] || glyphs[' '];
            for (let gy = 0; gy < g.length; gy++) {
                const row = g[gy];
                for (let gx = 0; gx < row.length; gx++) {
                    if (row[gx] === '1') this.ctx.fillRect((x + gx) * s, (startY + gy) * s, s, s);
                }
            }
            x += 6; // 5px glyph + 1px spacing
        }
    }

    // Piece size/color/position inherit body modes.
    // tx derivation (sc = sizeScale, body visual edges at (24±16*sc) char-px):
    //   right: body_right_edge + 1 gap = (25 + 16*sc)
    //   left:  body_left_edge - 1 gap - piece_size = (23 - 23*sc)
    _drawTrail(s) {
        if (this.trailSide === 'none') return;

        const ctx = this.ctx;
        const alpha = this.modes.bodyAlpha ?? 1;
        if (alpha !== 1) { ctx.save(); ctx.globalAlpha = alpha; }
        const sc = this.modes.sizeScale;
        const bc = this.modes.borderColor || '#000000';
        const fc = this.modes.bodyColor || '#FFFFFF';

        const ts = 7 * sc;
        const ty = (PET_PADDING + PET_CHAR_SIZE - ts) * s;
        const tx = this.trailSide === 'left'
            ? (23 - 23 * sc) * s
            : (25 + 16 * sc) * s;

        ctx.fillStyle = bc;
        ctx.fillRect(tx, ty, ts * s, ts * s);
        ctx.fillStyle = fc;
        ctx.fillRect(tx + 2 * sc * s, ty + 2 * sc * s, 3 * sc * s, 3 * sc * s);
        if (alpha !== 1) ctx.restore();
    }

    // ── blink loop ───────────────────────────────────────────────

    _scheduleBlink() {
        const delay = 3000 + Math.random() * 5000;
        this._blinkTimer = setTimeout(() => this._doBlink(), delay);
    }

    async _doBlink() {
        // Skip blink during drag, mid-blink, vertical movement, or shape deformation.
        if (this.expression === 'drag' || this._isBusy || this.eyeOffsetY !== 0
            || this.shapeScaleX !== 1 || this.shapeScaleY !== 1 || this.rotation !== 0) {
            this._scheduleBlink();
            return;
        }
        this._isBusy = true;
        const prev = this.expression;

        if (this.modes.tail) this.tailSwing = 1;
        this.setExpression('blink_half');
        await this._sleep(80);
        if (this.modes.tail) this.tailSwing = 2;
        this.setExpression('blink_closed');
        await this._sleep(100);
        if (this.modes.tail) this.tailSwing = 1;
        this.setExpression('blink_half');
        await this._sleep(80);
        if (this.modes.tail) this.tailSwing = 0;
        this.setExpression(prev);

        this._isBusy = false;
        this._scheduleBlink();
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    _updateCanvasSize() {
        const px = PET_CANVAS_SIZE * this.scale;
        this.canvas.width = px;
        this.canvas.height = px;
        this.canvas.style.width = px + 'px';
        this.canvas.style.height = px + 'px';
    }
}
