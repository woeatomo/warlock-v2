import { createCanvas, registerFont } from 'canvas';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
for (const [file, family, weight] of [['Sora-600.ttf', 'Sora', '600'], ['Sora-700.ttf', 'Sora', '700'], ['Sora-800.ttf', 'Sora', '800'], ['Inter-400.ttf', 'Inter', '400'], ['Inter-600.ttf', 'Inter', '600'], ['Inter-700.ttf', 'Inter', '700'], ['IBMPlexMono-Medium.ttf', 'Plex Mono', '500'], ['IBMPlexMono-SemiBold.ttf', 'Plex Mono', '600']]) {
  const f = path.join(dir, file); if (existsSync(f)) { try { registerFont(f, { family, weight }); } catch { /* DejaVu fallback */ } }
}
const { drawTradeCard, CARD_W, CARD_H } = await import('./tradeCard.js');
const { drawPeriodCard } = await import('./periodCard.js');
const { prepareImages } = await import('./kit.js');

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
await prepareImages(data);   // token logos (bytes passed in by the parent; the child never fetches)
const canvas = createCanvas(CARD_W, CARD_H);
(data.cardKind === 'period' ? drawPeriodCard : drawTradeCard)(canvas.getContext('2d'), data);
process.stdout.write(canvas.toBuffer('image/png'));
