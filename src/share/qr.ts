import qrcode from '../vendor/qrcode.js'

/** Longest text that fits a QR code at the lowest error correction (version 40, byte mode: 2953). Scanners cope with far less. */
export const QR_MAX = 1200

/** The QR code of `text` as a grid of dark/light squares, or null when the text is too long to be scanned reliably. */
export function qrModules(text: string): boolean[][] | null {
  if (text.length > QR_MAX) return null
  try {
    const code = qrcode(0, 'L')
    code.addData(text)
    code.make()
    const n = code.getModuleCount()
    return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => code.isDark(y, x)))
  } catch {
    return null
  }
}

/** SVG markup with a quiet zone of 4 squares around the code (the standard asks for it). */
export function qrSvg(modules: boolean[][]): string {
  const n = modules.length
  const quiet = 4
  const size = n + quiet * 2
  let path = ''
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`
    }),
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}
