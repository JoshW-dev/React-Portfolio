/*
  How the film's opening shot looks at Earth. The live planet (orbitScene.ts) and the lines
  drawn while it loads (earthLines.ts) both read these, so their horizons line up exactly.
  Plain numbers only: this file must stay free of three.js, so the lines can start at once.
*/

/** Camera altitude in Earth radii: about 1,800 km. */
export const ALT = 0.28;
/** Sun azimuth (degrees from north, toward east) and elevation at the start point. */
export const SUN_AZ = 281;
export const SUN_EL = 6;
/** Where the top of the horizon sits, in normalised device coordinates (0.2 = 40% down). */
export const HORIZON_Y = 0.2;
/**
 * How the still and clip 0 were made from this scene. The still is the top 810 rows of a
 * 1440 x 900 frame (vertical field of view 46 degrees); the clip keeps its full height and
 * crops its sides to the clip's 1920 x 1088 shape. Measured by fitting the still to frames
 * rendered here and the clip's first frame to the still.
 */
export const CAPTURE = { width: 1440, height: 900, fov: 46, clipRows: 810, clipAspect: 1920 / 1088 };

/**
 * The part of the capture frame a screen of this shape shows: the capture frame cut to the
 * clip's shape, then cropped the way object-fit: cover crops the video. Also the camera's
 * downward pitch (radians) that puts the horizon at HORIZON_Y.
 */
export function captureView(aspect: number) {
  const clipW = CAPTURE.clipRows * CAPTURE.clipAspect;
  let viewW: number;
  let viewH: number;
  if (aspect <= CAPTURE.clipAspect) {
    viewH = CAPTURE.clipRows;
    viewW = viewH * aspect;
  } else {
    viewW = clipW;
    viewH = viewW / aspect;
  }
  const pitch = Math.acos(1 / (1 + ALT)) + Math.atan(HORIZON_Y * Math.tan((CAPTURE.fov * Math.PI) / 360));
  return { viewW, viewH, pitch };
}
