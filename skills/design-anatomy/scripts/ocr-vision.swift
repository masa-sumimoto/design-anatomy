// macOS Vision OCR -> JSON lines with pixel bboxes (top-left origin).
// usage: swift ocr-vision.swift <image>
// Good at Japanese out of the box (no language packs needed).
import Foundation
import Vision
import ImageIO

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("usage: swift ocr-vision.swift <image>\n".data(using: .utf8)!)
    exit(1)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    FileHandle.standardError.write("cannot read image\n".data(using: .utf8)!)
    exit(1)
}
let W = Double(image.width), H = Double(image.height)

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["ja-JP", "en-US"]

try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])

var lines: [[String: Any]] = []
for obs in request.results ?? [] {
    guard let cand = obs.topCandidates(1).first else { continue }
    let b = obs.boundingBox // normalized, origin bottom-left
    let x = (b.minX * W).rounded(), w = (b.width * W).rounded()
    let h = (b.height * H).rounded(), y = ((1 - b.maxY) * H).rounded()
    lines.append([
        "text": cand.string,
        "bbox": ["x": x, "y": y, "w": w, "h": h],
        "conf": (Double(cand.confidence) * 100).rounded() / 100,
    ])
}
let out: [String: Any] = ["engine": "vision", "lines": lines]
let data = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
print(String(data: data, encoding: .utf8)!)
