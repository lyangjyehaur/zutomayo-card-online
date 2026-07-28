#!/usr/bin/env swift

import AppKit
import Foundation
import Vision

struct SourceCard: Decodable {
    let candidateId: String
    let localImagePath: String
}

struct SourceManifest: Decodable {
    let cards: [SourceCard]
}

struct OCRCandidate: Encodable {
    let text: String
    let confidence: Float
}

struct OCRLine: Encodable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let alternatives: [OCRCandidate]
}

struct OCRCard: Encodable {
    let candidateId: String
    let imageWidth: Int
    let imageHeight: Int
    let lines: [OCRLine]
    let error: String?
}

struct OCROutput: Encodable {
    let schemaVersion: Int
    let generatedAt: String
    let recognitionLanguages: [String]
    let cards: [OCRCard]
}

let fileManager = FileManager.default
let scriptURL = URL(fileURLWithPath: #filePath)
let repositoryRoot = scriptURL.deletingLastPathComponent().deletingLastPathComponent()
let arguments = CommandLine.arguments

func argument(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

let manifestURL = URL(
    fileURLWithPath: argument("--manifest") ?? "data/card-unlisted-sources.json",
    relativeTo: repositoryRoot
).standardizedFileURL
let outputURL = URL(
    fileURLWithPath: argument("--output") ?? "data/card-unlisted-ocr.json",
    relativeTo: repositoryRoot
).standardizedFileURL
let manifestData = try Data(contentsOf: manifestURL)
let manifest = try JSONDecoder().decode(SourceManifest.self, from: manifestData)
let languages = ["ja-JP", "en-US"]

func dimensions(of imageURL: URL) -> (Int, Int) {
    guard
        let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = properties[kCGImagePropertyPixelWidth] as? Int,
        let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { return (0, 0) }
    return (width, height)
}

func recognize(_ card: SourceCard) -> OCRCard {
    let imageURL = repositoryRoot.appendingPathComponent(card.localImagePath).standardizedFileURL
    let (imageWidth, imageHeight) = dimensions(of: imageURL)
    guard fileManager.fileExists(atPath: imageURL.path) else {
        return OCRCard(
            candidateId: card.candidateId,
            imageWidth: imageWidth,
            imageHeight: imageHeight,
            lines: [],
            error: "Local image not found"
        )
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = languages
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 0.006

    do {
        let handler = VNImageRequestHandler(url: imageURL, options: [:])
        try handler.perform([request])
        let observations = (request.results ?? []).sorted { left, right in
            let verticalDelta = left.boundingBox.midY - right.boundingBox.midY
            if abs(verticalDelta) > 0.012 { return verticalDelta > 0 }
            return left.boundingBox.minX < right.boundingBox.minX
        }
        let lines = observations.compactMap { observation -> OCRLine? in
            guard let best = observation.topCandidates(1).first else { return nil }
            let alternatives = observation.topCandidates(3).dropFirst().map {
                OCRCandidate(text: $0.string, confidence: $0.confidence)
            }
            return OCRLine(
                text: best.string,
                confidence: best.confidence,
                x: observation.boundingBox.minX,
                y: observation.boundingBox.minY,
                width: observation.boundingBox.width,
                height: observation.boundingBox.height,
                alternatives: alternatives
            )
        }
        return OCRCard(
            candidateId: card.candidateId,
            imageWidth: imageWidth,
            imageHeight: imageHeight,
            lines: lines,
            error: nil
        )
    } catch {
        return OCRCard(
            candidateId: card.candidateId,
            imageWidth: imageWidth,
            imageHeight: imageHeight,
            lines: [],
            error: error.localizedDescription
        )
    }
}

var cards: [OCRCard] = []
for (index, card) in manifest.cards.enumerated() {
    autoreleasepool {
        cards.append(recognize(card))
    }
    let completed = index + 1
    if completed % 8 == 0 || completed == manifest.cards.count {
        FileHandle.standardError.write(Data("OCR \(completed)/\(manifest.cards.count)\n".utf8))
    }
}

let formatter = ISO8601DateFormatter()
let output = OCROutput(
    schemaVersion: 1,
    generatedAt: formatter.string(from: Date()),
    recognitionLanguages: languages,
    cards: cards
)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
let data = try encoder.encode(output)
try fileManager.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try data.write(to: outputURL, options: .atomic)
print("Wrote \(cards.count) OCR records to \(outputURL.path)")
