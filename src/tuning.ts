/**
 * THE single tuning resource for Icarus's Ascent.
 *
 * Every gameplay threshold lives here: gesture distances, timing windows,
 * movement constants. Nothing else in the codebase should hard-code a feel value.
 *
 * Units
 *  - World: metres (m), seconds (s). x = distance along the route, y = height.
 *  - Gesture distances: fraction of the viewport's SHORT side ("vu"), so a
 *    stroke means the same thing on a 360px phone and a 1440px monitor.
 *  - Gesture times: milliseconds.
 */
export const TUNING = {
  sim: {
    /** Fixed physics step. 120 Hz keeps swept contact cheap and accurate. */
    dt: 1 / 120,
    /** Max sub-steps per rendered frame before we drop time (spiral-of-death guard). */
    maxStepsPerFrame: 12,
  },

  movement: {
    /** Gravity used for airborne motion (game-feel gravity, snappier than 9.81). */
    airGravity: 30,
    /** Gravity component used along slopes. Lower than airGravity so a 10 m descent
     *  adds useful speed (~+15 m/s from rest) without blowing past the cap. */
    slopeGravity: 11,
    /** Constant rolling resistance while grounded (m/s^2). Small: the player should
     *  be able to enjoy a line without constant pushing. */
    rollingFriction: 0.22,
    /** Quadratic air drag coefficient (a = k v^2). ~0.6 m/s^2 at soft cap. */
    airDrag: 0.0024,
    /** Readable "normal maximum" speed. Pushes approach it asymptotically. */
    softCap: 16,
    /** Above softCap (from slopes), extra drag proportional to the excess, per second. */
    overCapDrag: 1.4,
    /** Firm safety ceiling. Never exceeded, by anything. Sized to the camera's
     *  visibility budget (see camera.lookAheadMin/PerSpeed). */
    hardCap: 22,
    /** Slowest crawl when standing still (brief: "very slowly or nearly still"). */
    restCreep: 0,

    // --- Push ---
    /** Impulse for the shortest accepted stroke (and the floor of the curve). */
    pushImpulseMin: 2.6,
    /** Impulse for a full-length stroke. Must stay <= softCap/2 so the
     *  (1 - (v/cap)^2) falloff can never overshoot the cap. */
    pushImpulseMax: 6.0,
    /** Response-curve exponent applied to stroke strength (0..1). <1 = forgiving:
     *  a half-length stroke already gives ~71% of the extra impulse. */
    pushCurveExponent: 0.5,
    /** Keyboard has no stroke length: a fresh Down press counts as this strength. */
    keyboardPushStrength: 0.65,
    /** Pushes only work on the ground, and only up to this uphill angle (deg)
     *  before effectiveness tapers (still works, just weaker). */
    pushUphillTaperDeg: 30,

    // --- Jump ---
    /** Vertical takeoff velocity added on top of the surface-tangent velocity. */
    jumpVelocity: 9.2,
    /** Seconds after leaving a ledge (not by jumping) during which Up still jumps. */
    coyoteTime: 0.09,
    /** An airborne Up pressed at most this long (s) before predicted touchdown is
     *  remembered and fires on contact. Earlier presses are rejected (and in M2
     *  become the backflip), so a mid-air press never turns into a surprise jump. */
    jumpBufferTime: 0.12,

    // --- Landing ---
    /** Landing keeps the surface-tangent component of velocity, but never less than
     *  this fraction of the pre-landing horizontal speed. Clean landings don't
     *  secretly reset speed. */
    landingRetention: 0.9,
    /** If the rider is below the surface by less than this while within a surface's
     *  x-range and moving *away* from it, we snap up instead of falling through. */
    surfaceSnapTolerance: 0.6,
    /** Falling this far below the lowest nearby surface means the gap was missed.
     *  Small, so the failure is declared while the miss is still on screen. */
    failDepth: 4,
  },

  gesture: {
    /** Movement below this (vu) from the touch-down point is finger noise. */
    deadZone: 0.022,
    /** A stroke fires once it has travelled this far (vu) along its committed direction. */
    fireDistance: { up: 0.04, down: 0.035, side: 0.06 },
    /** Vertical wins when |dy| >= |dx| * verticalBias (≈ within 40° of vertical). */
    verticalBias: 1.15,
    /** Horizontal wins only when |dx| >= |dy| * horizontalBias (≈ within 35° of horizontal):
     *  sideways is harder to trigger by accident than up/down. */
    horizontalBias: 1.4,
    /** If the direction is still ambiguous after this much travel, pick the dominant axis. */
    ambiguityLimit: 0.09,
    /** Moving back against the committed direction by this much (vu) from the stroke's
     *  furthest point ends the stroke and starts a new one (direction hysteresis). */
    reversalDistance: 0.03,
    /** Push strength 0..1 maps linearly from fireDistance.down to this stroke length (vu). */
    pushFullLength: 0.22,
    /** Push strength stops growing after this long (ms) into a stroke, so a slow drag
     *  can't be "milked" for a bigger push. */
    pushGrowWindowMs: 260,
    /** A touch that moves less than deadZone and lifts within this time is a tap. */
    tapMaxMs: 220,
  },

  camera: {
    /** Chase camera: fixed angle behind the rider, looking ahead down the route
     *  (route runs away from the camera, up the screen). Never orbits or rotates;
     *  it only translates to follow progress.
     *  Chosen with scripts/camera-search-chase.mjs + scripts/camera-visibility.mjs
     *  for a 390x844 portrait screen: rider ~108 px tall (12.7%) with feet at
     *  ~77% of screen height; a 7 m gap stays >= 10 px tall out to ~44 m ahead
     *  (2.0 s at the 22 m/s hard cap, 2.8 s at the 16 m/s soft cap); 1 m
     *  obstacles stay >= 10 px out to ~76 m. */
    /** Vertical field of view (deg). */
    fov: 52,
    /** Route yaw in the scene (deg). 90 = route runs straight away from the camera. */
    routeYawDeg: 90,
    /** Camera distance behind the rider, and height above the rider (m). */
    behind: 12,
    height: 6,
    /** Fixed downward pitch (deg). */
    pitchDeg: 12,
    /** Gentle pull-back with speed so faster = slightly more visible approach (m per m/s). */
    behindPerSpeed: 0.06,
    heightPerSpeed: 0.02,
    /** Look over crests: the camera's height target is raised so it stays at least
     *  lookOverClearance above the highest ground in the next lookOverRange metres,
     *  so a landing beyond a ramp lip or crest is visible before takeoff.
     *  (Translation only; the angle never changes.) */
    lookOverRange: 30,
    lookOverClearance: 6.5,
    /** ...but never lift more than this (m) above the normal follow height, so the rider stays in frame. */
    lookOverMaxLift: 2.5,
    /** Landscape screens: same angle, a touch closer since width is plentiful. */
    landscapeScale: 0.9,
    /** Smoothing time constants (s). Height lags more so jumps don't bob the view. */
    followLag: 0.06,
    heightLag: 0.3,
    pullLag: 0.8,
  },

  feedback: {
    pushSquash: 0.22,
    landSquash: 0.3,
    squashRecover: 10,
  },

  failure: {
    /** Retry input is ignored for this long after failing so a panicked swipe
     *  doesn't skip the explanation. */
    retryLockout: 0.35,
  },
} as const;

export type Tuning = typeof TUNING;
