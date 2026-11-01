# Star trail placement

Collectibles are short trails of dainty stars. Placement is a level-design pass, not a density quota.

## Purpose

Every gold trail teaches or rewards one line:

- **Jump arc** — ballistic samples of a real jump (`jumpVelocity` 9.2, air gravity 30) across a jump gap, so the stars draw the hop.
- **Rail** — evenly timed along a required or optional grind (never the risky high line; that line is purple).
- **Wall ride** — a flat line at 42% of the wall height, 0.35 m off the face, so holding the ride collects it. Short taps carry 4 stars; longer rides up to 9. The line stops before 78% when the wall is long or required, leaving the end clear.
- **Pot hop** — one jump over a compulsory pot row, clear of the props.
- **Safe street** — a grounded centre-line on an open phrase, only when nothing above applies. Skipped on connectors and wave breathers, and dropped if a star would sit inside a pot or pillar.

The highest-purpose line in the phrase wins. One trail only.

## Motion

Stars are spaced about **0.3 s** apart at the phrase cruise speed (5–8 stars, about 1.5–2.2 s of riding). The shape is a single smooth move: a parabola, a rail, or a straight street. No lateral zig-zags.

## Rhythm

After a trail ends, the next gold trail waits **36–58 m** (`rhythm.quietUntil`). That keeps a single trail ahead on the street and leaves a breather between lines. Two gold trails never share a phrase, and a line that would start inside the quiet window is not placed.

## Purple

A single purple star marks a mastery point and the next one waits **200–300 m**: the far end of a risky rail, **88% along a long or required wall** (same 42% ride height, just off the face), the apex of a long jump, or — if the route has gone quiet — the far end of the longest ordinary rail. The opening high line always carries its purple on the risky rail. It does not sit on top of a gold star. Not every wall gets a purple; the rhythm cursor decides when the next reward is due.

## Presentation

Stars stay the current small billboards (gold ~0.26 m, rare ~0.39 m) with twinkle. Pickup bursts stay short. Nothing in this pass changes size or the HUD star.
