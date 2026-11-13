import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

// film-interp <in.mp4> <out.mov> [fps=60]
//
// Converts a clip to a higher frame rate with VideoToolbox's frame rate conversion (macOS 15.4
// or later, Apple silicon) and writes ProRes. Feed the result to scripts/film-encode.sh.
//
//   swiftc -O -o scripts/film-interp scripts/film-interp.swift
//   scripts/film-interp take.mp4 take-60.mov
//
// It needs the GPU, so run it from a normal terminal and not from a sandboxed shell.
// Use the completion-handler form of process(parameters:). The AsyncSequence form fails
// with VTFrameProcessorProcessingError (-19740) for frame rate conversion.

func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: film-interp <in> <out.mov> [fps]") }
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let outFps = args.count > 3 ? Int32(args[3]) ?? 60 : 60

let asset = AVURLAsset(url: inURL)
guard let track = try await asset.loadTracks(withMediaType: .video).first else { fail("no video track") }
let size = try await track.load(.naturalSize)
let srcFps = Double(try await track.load(.nominalFrameRate))
let width = Int(size.width), height = Int(size.height)

guard VTFrameRateConversionConfiguration.isSupported else { fail("frame rate conversion is not supported on this Mac") }
guard let config = VTFrameRateConversionConfiguration(frameWidth: width, frameHeight: height, usePrecomputedFlow: false,
                                                     qualityPrioritization: .quality, revision: VTFrameRateConversionConfiguration.defaultRevision)
else { fail("could not make a configuration for \(width)x\(height)") }
guard let fmt = config.supportedPixelFormats.first else { fail("no supported pixel format") }

let reader = try AVAssetReader(asset: asset)
var readSettings = config.sourcePixelBufferAttributes
readSettings[kCVPixelBufferPixelFormatTypeKey as String] = fmt
let output = AVAssetReaderTrackOutput(track: track, outputSettings: readSettings)
output.alwaysCopiesSampleData = true
reader.add(output)
guard reader.startReading() else { fail("reader: \(String(describing: reader.error))") }

try? FileManager.default.removeItem(at: outURL)
let writer = try AVAssetWriter(outputURL: outURL, fileType: .mov)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.proRes422HQ, AVVideoWidthKey: width, AVVideoHeightKey: height,
])
input.expectsMediaDataInRealTime = false
var destAttrs = config.destinationPixelBufferAttributes
destAttrs[kCVPixelBufferPixelFormatTypeKey as String] = fmt
destAttrs[kCVPixelBufferWidthKey as String] = width
destAttrs[kCVPixelBufferHeightKey as String] = height
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: destAttrs)
writer.add(input)
guard writer.startWriting() else { fail("writer: \(String(describing: writer.error))") }
writer.startSession(atSourceTime: .zero)

let processor = VTFrameProcessor()
do { try processor.startSession(configuration: config) } catch { fail("startSession: \(error)") }

func append(_ pb: CVPixelBuffer, _ k: Int) async {
  while !input.isReadyForMoreMediaData { try? await Task.sleep(nanoseconds: 2_000_000) }
  if !adaptor.append(pb, withPresentationTime: CMTime(value: CMTimeValue(k), timescale: outFps)) { fail("append failed: \(String(describing: writer.error))") }
}
func newBuffer() -> CVPixelBuffer {
  var pb: CVPixelBuffer?
  CVPixelBufferCreate(kCFAllocatorDefault, width, height, fmt, config.destinationPixelBufferAttributes as CFDictionary, &pb)
  guard let pb else { fail("could not make a pixel buffer") }
  return pb
}

var frames: [CVPixelBuffer] = []
while let sample = output.copyNextSampleBuffer() {
  if let pb = CMSampleBufferGetImageBuffer(sample) { frames.append(pb) }
}
guard frames.count > 1 else { fail("clip has fewer than 2 frames") }

let n = frames.count
let lastTime = Double(n - 1) / srcFps
var k = 0
var written = 0
for i in 0..<(n - 1) {
  let t0 = Double(i) / srcFps
  let t1 = Double(i + 1) / srcFps
  var phases: [Float] = []
  var slots: [Int] = []
  var exact: Int? = nil
  while Double(k) / Double(outFps) < t1 - 1e-9 {
    let t = Double(k) / Double(outFps)
    let ph = (t - t0) * srcFps
    if ph < 0.02 { exact = k } else if ph > 0.98 { break } else { phases.append(Float(ph)); slots.append(k) }
    k += 1
  }
  if let e = exact { await append(frames[i], e); written += 1 }
  if !phases.isEmpty {
    guard let src = VTFrameProcessorFrame(buffer: frames[i], presentationTimeStamp: CMTime(value: CMTimeValue((t0 * 6000).rounded()), timescale: 6000)),
          let nxt = VTFrameProcessorFrame(buffer: frames[i + 1], presentationTimeStamp: CMTime(value: CMTimeValue((t1 * 6000).rounded()), timescale: 6000)) else { fail("frame wrap failed") }
    let dests = slots.map { s in VTFrameProcessorFrame(buffer: newBuffer(), presentationTimeStamp: CMTime(value: CMTimeValue(s) * CMTimeValue(6000 / outFps), timescale: 6000))! }
    guard let params = VTFrameRateConversionParameters(sourceFrame: src, nextFrame: nxt, opticalFlow: nil, interpolationPhase: phases,
                                                      submissionMode: i == 0 ? .random : .sequential, destinationFrames: dests) else { fail("parameters failed at frame \(i)") }
    do {
      try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
        processor.process(parameters: params) { _, error in
          if let error { c.resume(throwing: error) } else { c.resume() }
        }
      }
    } catch {
      fail("process at frame \(i): \(error)")
    }
    for (j, s) in slots.enumerated() { await append(dests[j].buffer, s); written += 1 }
  }
}
// The last source frame closes the clip.
while Double(k) / Double(outFps) <= lastTime + 1e-9 { await append(frames[n - 1], k); written += 1; k += 1 }

processor.endSession()
input.markAsFinished()
await writer.finishWriting()
if writer.status != .completed { fail("writer ended: \(String(describing: writer.error))") }
print("\(n) frames at \(srcFps) fps -> \(written) frames at \(outFps) fps, \(width)x\(height)")
