/**
 * Renders a scannable EAN-13 barcode as SVG (so the phone can be scanned at an
 * in-store price checker / self-checkout). Returns null for anything that isn't
 * a 13-digit numeric code — the caller shows the number itself in that case.
 */

// Left digits use an L or G pattern chosen by the first digit; right digits use R.
const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
]
const G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
]
const R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
]
// Which of the 6 left digits use G (vs L), by the first digit.
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
]

function ean13Bits(code: string): string | null {
  if (!/^\d{13}$/.test(code)) return null
  const d = [...code].map(Number)
  const parity = PARITY[d[0]]
  let bits = '101' // start guard
  for (let i = 1; i <= 6; i++) {
    bits += parity[i - 1] === 'L' ? L[d[i]] : G[d[i]]
  }
  bits += '01010' // center guard
  for (let i = 7; i <= 12; i++) bits += R[d[i]]
  bits += '101' // end guard
  return bits
}

interface Props {
  code: string
  height?: number
  className?: string
}

export function Barcode({ code, height = 48, className }: Props) {
  const bits = ean13Bits(code)
  if (!bits) return null

  const unit = 2
  const quiet = 6
  const width = bits.length * unit + quiet * 2 * unit

  const bars: { x: number; w: number }[] = []
  let run = 0
  for (let i = 0; i <= bits.length; i++) {
    if (bits[i] === '1') {
      run++
    } else if (run > 0) {
      bars.push({ x: (quiet + i - run) * unit, w: run * unit })
      run = 0
    }
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`ברקוד ${code}`}
    >
      <rect width={width} height={height} fill="#fff" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
    </svg>
  )
}
