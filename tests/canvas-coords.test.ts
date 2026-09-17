import { describe, expect, it } from "vitest";

import {
  MAX_MASK_CANVAS_LONG_EDGE,
  canvasPointToNatural,
  clientPointToCanvas,
  computeMaskCanvasDimensions,
} from "@/lib/canvas-coords";

// A 448x336 display rect (4:3) mapped onto a 1024x768 canvas: both scale by 16/7.
const rect = { left: 100, top: 50, width: 448, height: 336 };

describe("clientPointToCanvas", () => {
  it("maps the top-left corner of the rect to the canvas origin", () => {
    expect(clientPointToCanvas(100, 50, rect, 1024, 768)).toEqual({ x: 0, y: 0 });
  });

  it("maps the center of the rect to the canvas center", () => {
    expect(clientPointToCanvas(324, 218, rect, 1024, 768)).toEqual({ x: 512, y: 384 });
  });

  it("maps the bottom-right corner of the rect to the canvas dimensions", () => {
    expect(clientPointToCanvas(548, 386, rect, 1024, 768)).toEqual({ x: 1024, y: 768 });
  });

  it("clamps points slightly out of bounds to the canvas edges", () => {
    expect(clientPointToCanvas(90, 40, rect, 1024, 768)).toEqual({ x: 0, y: 0 });
    expect(clientPointToCanvas(560, 400, rect, 1024, 768)).toEqual({ x: 1024, y: 768 });
    expect(clientPointToCanvas(548, 30, rect, 1024, 768)).toEqual({ x: 1024, y: 0 });
    expect(clientPointToCanvas(80, 396, rect, 1024, 768)).toEqual({ x: 0, y: 768 });
  });

  it("scales uniformly when the rect matches the canvas aspect ratio", () => {
    expect(clientPointToCanvas(212, 134, rect, 1024, 768)).toEqual({ x: 256, y: 192 });
    expect(clientPointToCanvas(436, 302, rect, 1024, 768)).toEqual({ x: 768, y: 576 });
  });

  it("handles non-uniform scaling for mismatched aspect ratios", () => {
    const squareRect = { left: 0, top: 0, width: 512, height: 512 };
    expect(clientPointToCanvas(128, 128, squareRect, 1024, 768)).toEqual({ x: 256, y: 192 });
  });

  it("offsets the rect from the viewport origin", () => {
    const offsetRect = { left: 500, top: 800, width: 448, height: 336 };
    expect(clientPointToCanvas(612, 884, offsetRect, 1024, 768)).toEqual({ x: 256, y: 192 });
  });

  it("returns the origin for a degenerate zero-sized rect", () => {
    const zeroRect = { left: 10, top: 10, width: 0, height: 0 };
    expect(clientPointToCanvas(50, 60, zeroRect, 1024, 768)).toEqual({ x: 0, y: 0 });
  });
});

describe("computeMaskCanvasDimensions", () => {
  it("keeps square images at the max long edge", () => {
    expect(computeMaskCanvasDimensions(1)).toEqual({
      width: MAX_MASK_CANVAS_LONG_EDGE,
      height: MAX_MASK_CANVAS_LONG_EDGE,
    });
  });

  it("sizes landscape canvases by the aspect ratio", () => {
    expect(computeMaskCanvasDimensions(4 / 3)).toEqual({ width: 1024, height: 768 });
    expect(computeMaskCanvasDimensions(16 / 9)).toEqual({ width: 1024, height: 576 });
  });

  it("sizes portrait canvases by the aspect ratio", () => {
    expect(computeMaskCanvasDimensions(3 / 4)).toEqual({ width: 768, height: 1024 });
    expect(computeMaskCanvasDimensions(9 / 16)).toEqual({ width: 576, height: 1024 });
  });

  it("rounds non-integer edges but never below one pixel", () => {
    expect(computeMaskCanvasDimensions(10)).toEqual({ width: 1024, height: 102 });
    expect(computeMaskCanvasDimensions(1 / 10)).toEqual({ width: 102, height: 1024 });
    expect(computeMaskCanvasDimensions(0.001)).toEqual({ width: 1, height: 1024 });
  });

  it("falls back to a square for invalid aspect ratios", () => {
    const fallback = {
      width: MAX_MASK_CANVAS_LONG_EDGE,
      height: MAX_MASK_CANVAS_LONG_EDGE,
    };
    expect(computeMaskCanvasDimensions(0)).toEqual(fallback);
    expect(computeMaskCanvasDimensions(-2)).toEqual(fallback);
    expect(computeMaskCanvasDimensions(Number.NaN)).toEqual(fallback);
    expect(computeMaskCanvasDimensions(Number.POSITIVE_INFINITY)).toEqual(fallback);
  });

  it("honors a custom max long edge", () => {
    expect(computeMaskCanvasDimensions(4 / 3, 512)).toEqual({ width: 512, height: 384 });
    expect(computeMaskCanvasDimensions(3 / 4, 512)).toEqual({ width: 384, height: 512 });
  });
});

describe("canvasPointToNatural", () => {
  it("scales canvas pixels up to the photo's natural resolution", () => {
    // 1024x768 canvas for a 4096x3072 photo: 4x per axis.
    expect(canvasPointToNatural({ x: 512, y: 384 }, 1024, 768, 4096, 3072)).toEqual({
      x: 2048,
      y: 1536,
    });
  });

  it("scales canvas pixels down for canvases larger than the photo", () => {
    // 1024-wide canvas for an 800-wide photo.
    expect(canvasPointToNatural({ x: 512, y: 384 }, 1024, 768, 800, 600)).toEqual({
      x: 400,
      y: 300,
    });
  });

  it("rounds fractional results to integer natural pixels", () => {
    expect(canvasPointToNatural({ x: 333, y: 111 }, 1000, 1000, 1000, 1000)).toEqual({
      x: 333,
      y: 111,
    });
    expect(canvasPointToNatural({ x: 512, y: 256 }, 1024, 768, 4096, 3072)).toEqual({
      x: 2048,
      y: 1024,
    });
    // 1/3 scale: 100 -> 33.333 -> 33.
    expect(canvasPointToNatural({ x: 100, y: 0 }, 1023, 1023, 341, 341)).toEqual({ x: 33, y: 0 });
  });

  it("clamps to the natural bounds on every edge", () => {
    expect(canvasPointToNatural({ x: 0, y: 0 }, 1024, 768, 4096, 3072)).toEqual({ x: 0, y: 0 });
    expect(canvasPointToNatural({ x: 1024, y: 768 }, 1024, 768, 4096, 3072)).toEqual({
      x: 4096,
      y: 3072,
    });
    expect(canvasPointToNatural({ x: 1100, y: -10 }, 1024, 768, 4096, 3072)).toEqual({
      x: 4096,
      y: 0,
    });
  });

  it("returns the origin when the canvas is degenerate", () => {
    expect(canvasPointToNatural({ x: 50, y: 50 }, 0, 0, 4096, 3072)).toEqual({ x: 0, y: 0 });
  });
});
