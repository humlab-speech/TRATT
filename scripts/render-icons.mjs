// Renders the PNG app icons from the SVG mark. Run: node scripts/render-icons.mjs
import sharp from 'sharp';
const src = 'apps/tratt/src/assets/img/tratt/tratt-mark.svg';
const out = 'apps/tratt/src/assets/img/tratt/icons';
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  // Maskable icons need a safe zone: pad the mark to 80 % on white.
  const inner = Math.round(size * 0.8);
  const mark = await sharp(src, { density: 384 })
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: '#ffffff' },
  })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(`${out}/${size}x${size}.png`);
}
