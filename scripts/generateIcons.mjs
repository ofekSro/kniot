/**
 * Generates the PWA icon set from a single inline SVG.
 *
 *   npm run icons
 *
 * To change the artwork, edit the svg() template below and re-run.
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(root, 'public')

const GREEN = '#16a34a'
const GREEN_DARK = '#15803d'

/**
 * @param {number} scale Glyph size relative to the canvas. Maskable icons need a
 *   smaller glyph so nothing important falls outside the platform's safe zone.
 * @param {boolean} rounded Rounded corners for the standard icon; maskable and
 *   apple-touch stay square because the platform applies its own mask.
 */
function svg(scale, rounded) {
  const S = 512
  const inset = (S * (1 - scale)) / 2
  const radius = rounded ? 112 : 0

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GREEN}"/>
      <stop offset="1" stop-color="${GREEN_DARK}"/>
    </linearGradient>
  </defs>
  <rect width="${S}" height="${S}" rx="${radius}" ry="${radius}" fill="url(#bg)"/>
  <g transform="translate(${inset} ${inset}) scale(${scale})">
    <g fill="none" stroke="#ffffff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
      <path d="M92 112h56l54 214h196"/>
      <path d="M170 180h268l-28 110H198"/>
    </g>
    <circle cx="224" cy="392" r="27" fill="#ffffff"/>
    <circle cx="392" cy="392" r="27" fill="#ffffff"/>
  </g>
</svg>`
}

async function render(source, size, file) {
  await sharp(Buffer.from(source)).resize(size, size).png().toFile(resolve(publicDir, file))
  console.log(`  ✓ public/${file}  (${size}x${size})`)
}

await mkdir(publicDir, { recursive: true })

const standard = svg(1, true)
const maskable = svg(0.68, false)
const appleTouch = svg(0.86, false)

await writeFile(resolve(publicDir, 'favicon.svg'), standard, 'utf-8')
console.log('  ✓ public/favicon.svg')

await render(standard, 192, 'icon-192.png')
await render(standard, 512, 'icon-512.png')
await render(maskable, 512, 'icon-maskable-512.png')
await render(appleTouch, 180, 'apple-touch-icon.png')

console.log('')
