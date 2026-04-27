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

const PET_CHAR_SIZE  = 32;
const PET_PADDING    = 8;
const PET_CANVAS_SIZE = PET_CHAR_SIZE + 2 * PET_PADDING; // 48

class PetRenderer {
    constructor(canvasId, initialScale = 8) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.scale       = initialScale;
        this.facing      = 'left';   // 'left'=no flip, 'right'=flip
        this.expression  = 'normal';
        this.eyeOffsetY  = 0;        // char-grid units: -2=up, 0=neutral, +2=down
        this.trailSide   = 'none';   // 'none' | 'left' | 'right'
        this.shapeScaleX = 1;        // horizontal squash/stretch (1=normal)
        this.shapeScaleY = 1;        // vertical   squash/stretch (1=normal)
        this.rotation    = 0;        // rotation in radians (0=upright)
        this.modes = {
            bodyColor:   null,   // null = white; or CSS color string
            borderColor: null,   // null = black; or CSS color string
            rounded:     false,  // round the outer corners
            melted:      false,  // widen the lower body (trapezoid)
            eyeStyle:    null,   // null | 'thin-v' | 'thin-h'
            sizeScale:   1,      // overall size multiplier (1 = normal, 0.667 = 2/3)
        };
        this._blinkTimer = null;
        this._isBusy     = false;

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

    setRotation(angle) {
        this.rotation = angle;
        this.render();
    }

    // Set a single mode property. Repeated calls stack (different keys) or replace (same key).
    setMode(key, value) {
        this.modes[key] = value;
        this.render();
    }

    resetModes() {
        this.modes = { bodyColor: null, borderColor: null, rounded: false, melted: false, eyeStyle: null, sizeScale: 1 };
        this.render();
    }

    destroy() {
        if (this._blinkTimer) clearTimeout(this._blinkTimer);
    }

    // ── rendering ───────────────────────────────────────────────

    render() {
        const ctx      = this.ctx;
        const s        = this.scale;
        const canvasPx = PET_CANVAS_SIZE * s;

        ctx.clearRect(0, 0, canvasPx, canvasPx);

        // Trail is drawn with no transform so it stays fixed in canvas coords.
        this._drawTrail(s);

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

        // Rotation (pivot = center of character).
        if (this.rotation !== 0) {
            const cx = (PET_PADDING + PET_CHAR_SIZE / 2) * s;
            const cy = (PET_PADDING + PET_CHAR_SIZE / 2) * s;
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
        this._drawEyes(s);

        ctx.restore();
    }

    _drawBody(s) {
        const P  = PET_PADDING;
        const bc = this.modes.borderColor || '#000000';
        const fc = this.modes.bodyColor   || '#FFFFFF';
        if      (this.modes.melted)  this._drawBodyMelted (s, P, bc, fc);
        else if (this.modes.rounded) this._drawBodyRounded(s, P, bc, fc);
        else                         this._drawBodyNormal (s, P, bc, fc);
    }

    // Normal: rectangular body with 3px border.
    _drawBodyNormal(s, P, bc, fc) {
        const ctx = this.ctx;
        ctx.fillStyle = fc;
        ctx.fillRect((P + 3) * s,  (P + 3) * s,  26 * s, 26 * s);
        ctx.fillStyle = bc;
        ctx.fillRect(P * s,        P * s,         32 * s, 3 * s);   // top
        ctx.fillRect(P * s,        (P + 29) * s,  32 * s, 3 * s);   // bottom
        ctx.fillRect(P * s,        (P + 3) * s,   3 * s,  26 * s);  // left
        ctx.fillRect((P + 29) * s, (P + 3) * s,   3 * s,  26 * s);  // right
    }

    // Rounded: outer corners use roundRect with radius = border thickness.
    _drawBodyRounded(s, P, bc, fc) {
        const ctx    = this.ctx;
        const radius = 3 * s;
        ctx.beginPath();
        ctx.roundRect(P * s, P * s, 32 * s, 32 * s, radius);
        ctx.fillStyle = bc;
        ctx.fill();
        ctx.fillStyle = fc;
        ctx.fillRect((P + 3) * s, (P + 3) * s, 26 * s, 26 * s);
    }

    // Melted: trapezoid body wider at the bottom (m char-px expansion each side).
    // Both outer and inner are trapezoids with uniform 3px border thickness.
    _drawBodyMelted(s, P, bc, fc) {
        const ctx = this.ctx;
        const m   = 3; // expansion in char-px at the bottom on each side
        const bt  = 3; // border thickness in char-px

        // Outer trapezoid (border color)
        ctx.beginPath();
        ctx.moveTo(P * s,              P * s);
        ctx.lineTo((P + 32) * s,       P * s);
        ctx.lineTo((P + 32 + m) * s,   (P + 32) * s);
        ctx.lineTo((P - m) * s,        (P + 32) * s);
        ctx.closePath();
        ctx.fillStyle = bc;
        ctx.fill();

        // Inner trapezoid (body color) — uniform bt inset on every side
        ctx.beginPath();
        ctx.moveTo((P + bt) * s,           (P + bt) * s);
        ctx.lineTo((P + 32 - bt) * s,      (P + bt) * s);
        ctx.lineTo((P + 32 + m - bt) * s,  (P + 32 - bt) * s);
        ctx.lineTo((P - m + bt) * s,       (P + 32 - bt) * s);
        ctx.closePath();
        ctx.fillStyle = fc;
        ctx.fill();
    }

    _drawEyes(s) {
        const ctx   = this.ctx;
        const P     = PET_PADDING;
        const ex    = P * s;
        const ey    = (P + 10 + this.eyeOffsetY) * s;
        const style = this.modes.eyeStyle; // null | 'thin-v' | 'thin-h'

        ctx.fillStyle = '#000000';

        switch (this.expression) {
            case 'blink_half':
                if (style === 'thin-v') {
                    // Already very thin; show a single-pixel row
                    ctx.fillRect(ex + 7  * s, ey + 1 * s, 5 * s, s);
                    ctx.fillRect(ex + 17 * s, ey + 1 * s, 5 * s, s);
                } else if (style === 'thin-h') {
                    ctx.fillRect(ex + 8  * s, ey, 2 * s, 3 * s);
                    ctx.fillRect(ex + 18 * s, ey, 2 * s, 3 * s);
                } else {
                    ctx.fillRect(ex + 7  * s, ey, 5 * s, 3 * s);
                    ctx.fillRect(ex + 17 * s, ey, 5 * s, 3 * s);
                }
                break;

            case 'blink_closed':
                if (style === 'thin-h') {
                    ctx.fillRect(ex + 8  * s, ey + 2 * s, 2 * s, s);
                    ctx.fillRect(ex + 18 * s, ey + 2 * s, 2 * s, s);
                } else {
                    ctx.fillRect(ex + 7  * s, ey + 2 * s, 5 * s, s);
                    ctx.fillRect(ex + 17 * s, ey + 2 * s, 5 * s, s);
                }
                break;

            case 'drag':
                for (let i = 0; i < 5; i++) {
                    ctx.fillRect(ex + (7  + i) * s, ey + i * s, s, s);
                    ctx.fillRect(ex + (11 - i) * s, ey + i * s, s, s);
                    ctx.fillRect(ex + (17 + i) * s, ey + i * s, s, s);
                    ctx.fillRect(ex + (21 - i) * s, ey + i * s, s, s);
                }
                break;

            default: // 'normal'
                if (style === 'thin-v') {
                    // Vertically thin: 5 wide × 2 tall, centered in the 5px eye area
                    ctx.fillRect(ex + 7  * s, ey + 2 * s, 5 * s, 2 * s);
                    ctx.fillRect(ex + 17 * s, ey + 2 * s, 5 * s, 2 * s);
                } else if (style === 'thin-h') {
                    // Horizontally thin: 2 wide × 5 tall, centered in the 5px eye area
                    ctx.fillRect(ex + 8  * s, ey, 2 * s, 5 * s);
                    ctx.fillRect(ex + 18 * s, ey, 2 * s, 5 * s);
                } else {
                    ctx.fillRect(ex + 7  * s, ey, 5 * s, 5 * s);
                    ctx.fillRect(ex + 17 * s, ey, 5 * s, 5 * s);
                }
        }
    }

    // Piece size/color/position inherit body modes.
    // tx derivation (sc = sizeScale, body visual edges at (24±16*sc) char-px):
    //   right: body_right_edge + 1 gap = (25 + 16*sc)
    //   left:  body_left_edge - 1 gap - piece_size = (23 - 23*sc)
    _drawTrail(s) {
        if (this.trailSide === 'none') return;

        const ctx = this.ctx;
        const sc  = this.modes.sizeScale;
        const bc  = this.modes.borderColor || '#000000';
        const fc  = this.modes.bodyColor   || '#FFFFFF';

        const ts  = 7 * sc;
        const ty  = (PET_PADDING + PET_CHAR_SIZE - ts) * s;
        const tx  = this.trailSide === 'left'
            ? (23 - 23 * sc) * s
            : (25 + 16 * sc) * s;

        ctx.fillStyle = bc;
        ctx.fillRect(tx, ty, ts * s, ts * s);
        ctx.fillStyle = fc;
        ctx.fillRect(tx + 2 * sc * s, ty + 2 * sc * s, 3 * sc * s, 3 * sc * s);
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

        this.setExpression('blink_half');
        await this._sleep(80);
        this.setExpression('blink_closed');
        await this._sleep(100);
        this.setExpression('blink_half');
        await this._sleep(80);
        this.setExpression(prev);

        this._isBusy = false;
        this._scheduleBlink();
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    _updateCanvasSize() {
        const px = PET_CANVAS_SIZE * this.scale;
        this.canvas.width  = px;
        this.canvas.height = px;
        this.canvas.style.width  = px + 'px';
        this.canvas.style.height = px + 'px';
    }
}
