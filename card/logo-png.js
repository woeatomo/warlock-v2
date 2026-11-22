import { createCanvas } from 'canvas';
import { logoMark, backdrop } from './wl.js';
const size = Number(process.argv[2]) || 512;
const dark = process.argv[3] === 'dark';
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');
if (dark) { ctx.fillStyle = '#0b0b0f'; ctx.fillRect(0, 0, size, size); }
logoMark(ctx, size * 0.08, size * 0.08, size * 0.84);
process.stdout.write(canvas.toBuffer('image/png'));
