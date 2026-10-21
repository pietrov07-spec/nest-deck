// Dibuja un emoji con la fuente de emojis de Apple y lo guarda como PNG: emoji2png <emoji> <salida.png> [tamaño]
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else {
  FileHandle.standardError.write("uso: emoji2png <emoji> <salida.png> [tamaño]\n".data(using: .utf8)!)
  exit(2)
}
let size = args.count > 3 ? Int(args[3]) ?? 160 : 160

guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                                 samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                 bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

let font = NSFont(name: "Apple Color Emoji", size: CGFloat(size) * 0.78) ?? NSFont.systemFont(ofSize: CGFloat(size) * 0.78)
let text = NSAttributedString(string: args[1], attributes: [.font: font])
let bounds = text.boundingRect(with: NSSize(width: size * 4, height: size * 4), options: [.usesLineFragmentOrigin])
text.draw(at: NSPoint(x: (CGFloat(size) - bounds.width) / 2 - bounds.minX, y: (CGFloat(size) - bounds.height) / 2 - bounds.minY))

NSGraphicsContext.restoreGraphicsState()
guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: args[2]))
