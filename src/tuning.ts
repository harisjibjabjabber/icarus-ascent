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
    /** Downhill pull is stronger than the uphill cost (style: big descents feed big air). */
    slopeGravityDown: 15.5,
    slopeGravityUp: 10,
    /** On a descent steeper than descentGrade (sin θ) the soft-cap drag is scaled by this,
     *  so descents can run past the soft cap; the hard cap still holds. */
    descentGrade: 0.03,
    descentOverCapScale: 0.3,
    /** Crest separation: leave the ground when the surface curves away faster than the
     *  rider's ballistic path, i.e. v^2 * curvature > airGravity * cos(θ) * crestStick.
     *  crestMinTurn (rad) ignores sampling noise; crestMinSpeed (m/s) avoids crawl-pops. */
    crestStick: 1.0,
    crestMinTurn: 0.05,
    crestMinSpeed: 6,
    /** Constant rolling resistance while grounded (m/s^2). Small: the player should
     *  be able to enjoy a line without constant pushing. */
    rollingFriction: 0.22,
    /** Quadratic air drag coefficient (a = k v^2). ~0.75 m/s^2 at soft cap. */
    airDrag: 0.0018,
    /** Readable "normal maximum" speed. Pushes approach it asymptotically. */
    softCap: 20.5,
    /** Above softCap (from slopes), extra drag proportional to the excess, per second. */
    overCapDrag: 1.4,
    /** Firm safety ceiling. Never exceeded, by anything. Sized to the camera's
     *  visibility budget (see camera.lookAheadMin/PerSpeed). */
    hardCap: 27.5,
    /** Slowest crawl when standing still (brief: "very slowly or nearly still"). */
    restCreep: 0,

    // --- Push ---
    /** Impulse for the shortest accepted stroke (and the floor of the curve). */
    pushImpulseMin: 3.0,
    /** Impulse for a full-length stroke. Must stay <= softCap/2 so the
     *  (1 - (v/cap)^2) falloff can never overshoot the cap. */
    pushImpulseMax: 7.0,
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

  /** Milestone 2: tricks and contact. */
  tricks: {
    // --- Backflip (second fresh Up while airborne) ---
    /** Time for one full backflip (s). Flat-ground jumps (~0.6 s air) barely fit;
     *  ramps and crests make it comfortable — the route decides when flips are on. */
    flipDuration: 0.46,
    /** Landing with at least this much of the rotation done counts as complete
     *  (last ~36 deg is absorbed by the landing). Less = "landed mid-flip" failure. */
    flipLandTolerance: 0.9,
    /** One committed flip per jump (brief: add multiple rotations later). */
    maxFlipsPerJump: 1,

    // --- Landing preparation (airborne Down): rail catch / heel skim ---
    /** A fresh airborne Down keeps the catch armed for this long (s) even after the
     *  finger lifts; holding keeps it armed indefinitely. */
    prepArmWindow: 0.4,

    // --- Rail catch & grind ---
    /** Vertical catch band around the rail (m): rider feet up to railCatchAbove
     *  above the rail, or railCatchBelow below it (lifted on), count as a catch. */
    railCatchAbove: 1.2,
    railCatchBelow: 0.55,
    /** Catching from below the rail is only plausible while not still rising fast (m/s). */
    railCatchMaxRise: 2.5,
    /** Catch area starts this far before the rail's first point (m). */
    railCatchBefore: 0.6,
    /** Along-rail friction (m/s^2), much lower than rolling: grinds carry speed. */
    grindFriction: 0.12,
    /** Below this speed a grind gently builds speed back up (m/s and m/s^2). Not a refill. */
    grindSustainSpeed: 12,
    grindSustainAccel: 1.2,
    /** Small upward pop when a grind runs off the rail's end (m/s): readable release arc. */
    grindExitPop: 2.2,
    /** Jumping off a rail uses this fraction of the normal jump velocity. */
    grindJumpScale: 0.9,

    // --- Wall ride (airborne Right held beside a valid right-hand wall) ---
    /** Minimum forward speed to stick to a wall (m/s). */
    wallMinSpeed: 7,
    /** Feet must be at least this far above the wall's bottom and this far below its top (m). */
    wallBandBottom: 0.3,
    wallBandTop: 0.6,
    /** Catch area: within the wall's span, entering no later than this before its end (m). */
    wallCatchEndMargin: 3,
    /** Reduced gravity on the wall: the ride slowly sinks, so entry speed and height matter. */
    wallGravity: 2,
    /** Along-wall friction (m/s^2). Consistent; no speed refill. */
    wallFriction: 0.45,
    /** Entry vertical velocity is scaled and clamped so a wall never flings you upward. */
    wallEntryVyScale: 0.35,
    wallEntryVyMax: 3,
    /** Upward pop when the wall ends (m/s), and when letting go early (kick off). */
    wallExitPop: 2.6,
    wallKickOff: 1.6,

    // --- Heel skim (manual) ---
    /** Deceleration while skimming grows the longer it is held: base + ramp * t, capped (m/s^2). */
    heelDecelBase: 0.8,
    heelDecelRamp: 1.8,
    heelDecelMax: 6,
  },

  /** Breakable obstacles (brief §8). */
  obstacles: {
    potHeight: 0.85,
    potHalfWidth: 0.42,
    pillarHeight: 3.6,
    pillarHalfWidth: 0.55,
    /** Speed kept through a break (flow: nearly all). */
    potBreakRetention: 0.985,
    pillarBreakRetention: 0.97,
    /** After landing, an airborne trick still powers a pillar break for this much ground travel (m). */
    pillarCreditDistance: 26,
    /** Forgiving pillar hitbox. With a valid trick the break triggers this far early (m) and this much higher (m). */
    pillarBreakReach: 0.8,
    pillarBreakTopExtra: 0.6,
    /** Without one, a plain hit needs a solid overlap: narrower footprint and a grace off the top (m). */
    pillarFailWidthScale: 0.7,
    pillarFailTopGrace: 0.3,
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
    /** Chase camera: fixed pitch behind the rider, looking ahead down the route
     *  (route runs away from the camera, up the screen). Never orbits or rotates;
     *  it only translates (and widens FOV a little with speed).
     *  Chosen with scripts/camera-visibility.mjs for a 390x844 portrait screen.
     *  At rest: rider ~103 px tall, feet at ~76% of screen height.
     *  At the 27.5 m/s ceiling (pulled back to 13.5 m / 9.5 m, FOV 57): a 7 m gap
     *  stays >= 10 px tall out to ~55 m = 2.0 s of approach; gap edge posts and
     *  1 m obstacles stay readable further (~65 m). */
    /** Vertical field of view at rest (deg). */
    fov: 52,
    /** Extra FOV (deg) at the hard cap; scales linearly with speed. Speed sensation. */
    fovAtCap: 5,
    /** Route yaw in the scene (deg). 90 = route runs straight away from the camera. */
    routeYawDeg: 90,
    /** Camera distance behind the rider, and height above the rider (m), at rest. */
    behind: 11.5,
    height: 7,
    /** Fixed downward pitch (deg). Never changes. */
    pitchDeg: 17,
    /** Pull-back with speed (m per m/s): at the 27.5 m/s cap the camera sits at
     *  13.5 m behind / 9.5 m up, buying look-ahead and a sense of speed. */
    behindPerSpeed: 0.073,
    heightPerSpeed: 0.091,
    /** Look over crests: the camera's height target is raised so it stays at least
     *  lookOverClearance above the highest ground in the next lookOverRange metres,
     *  so a landing beyond a ramp lip or crest is visible before takeoff.
     *  (Translation only; the angle never changes.) */
    lookOverRange: 34,
    lookOverClearance: 7.5,
    /** ...but never lift more than this (m) above the normal follow height, so the rider stays in frame. */
    lookOverMaxLift: 2.5,
    /** Landscape screens: same angle, a touch closer since width is plentiful. */
    landscapeScale: 0.9,
    /** Smoothing time constants (s). Height lags more so jumps don't bob the view. */
    followLag: 0.06,
    heightLag: 0.3,
    pullLag: 0.8,
  },

  /** Speed sensation (presentation only). */
  speedFx: {
    /** Speed lines start at this fraction of the soft cap and are full at the hard cap. */
    linesStart: 0.55,
    /** Max opacity of a speed line (restrained so the route stays readable). */
    linesMaxOpacity: 0.32,
    /** Lines live outside the route: |lateral| from linesInner to linesOuter (m). */
    linesInner: 3.2,
    linesOuter: 8,
    /** Line length per m/s (m). */
    linesLengthPerSpeed: 0.14,
    /** Lines spawned per second at the hard cap. */
    linesRate: 40,
  },

  feedback: {
    /** Break response: small camera jolt (m) decaying over breakShakeTime, plus an FOV punch (deg). */
    breakShakePot: 0.08,
    breakShakePillar: 0.18,
    breakShakeTime: 0.22,
    breakFovPunch: 1.6,
    /** Fragments thrown per break. */
    potFragments: 14,
    pillarFragments: 26,
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
