// Simula una tecla multimedia del teclado: mediakey playpause|next|previous
import AppKit

let keys: [String: Int32] = ["playpause": 16, "next": 17, "previous": 18]
guard CommandLine.arguments.count > 1, let key = keys[CommandLine.arguments[1]] else {
  FileHandle.standardError.write("uso: mediakey playpause|next|previous\n".data(using: .utf8)!)
  exit(2)
}

for down in [true, false] {
  let event = NSEvent.otherEvent(
    with: .systemDefined, location: .zero,
    modifierFlags: NSEvent.ModifierFlags(rawValue: down ? 0xa00 : 0xb00),
    timestamp: 0, windowNumber: 0, context: nil, subtype: 8,
    data1: Int((key << 16) | ((down ? 0xa : 0xb) << 8)), data2: -1)
  event?.cgEvent?.post(tap: .cghidEventTap)
}
