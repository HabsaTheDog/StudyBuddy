import { describe, expect, it } from "vitest";
import { normalizedCropToPixels } from "../assessmentSolutions.js";

describe("assessment visual crops", () => {
  it("maps normalized crop coordinates to bounded source pixels", () => {
    expect(normalizedCropToPixels(
      { x: 120, y: 90, width: 480, height: 350 },
      1075,
      1521,
    )).toEqual({
      x: 51,
      y: 136,
      width: 671,
      height: 533,
    });
  });

  it("clamps rounding at the image boundary", () => {
    expect(normalizedCropToPixels(
      { x: 950, y: 950, width: 50, height: 50 },
      101,
      99,
    )).toEqual({
      x: 95,
      y: 94,
      width: 6,
      height: 5,
    });
  });

  it("can add bounded vertical padding for standalone learning visuals", () => {
    expect(normalizedCropToPixels(
      { x: 100, y: 100, width: 300, height: 200 },
      1000,
      1000,
      { verticalPaddingRatio: 0.1 },
    )).toEqual({
      x: 100,
      y: 80,
      width: 300,
      height: 240,
    });
  });

  it("can preserve an exact reviewer crop without assessment-side padding", () => {
    expect(normalizedCropToPixels(
      { x: 120, y: 90, width: 480, height: 350 },
      1000,
      1000,
      { horizontalPaddingRatio: 0, verticalPaddingRatio: 0 },
    )).toEqual({
      x: 120,
      y: 90,
      width: 480,
      height: 350,
    });
  });
});
