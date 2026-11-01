> **Status note (2026-11):** the setting and art direction in this brief are superseded by [VISION.md](VISION.md). The game is now a witch (Ao) riding a broom through a seaside town, working title "Witch Broom". The movement, controls, input, camera-readability, level-design and failure sections below remain canonical. Where this brief says "board", read "broom".

# Build Icarus’s Ascent from scratch: a controls-first game brief

Build **Icarus’s Ascent**, a momentum-driven skating game about travelling through a mythical Greek world above the clouds.

Start from scratch if that produces a cleaner game. Preserve the lessons below rather than carrying forward implementation decisions simply because they already exist.

This brief focuses on **controls, movement, level design, feedback and flow**. Art direction is a separate task. Use simple placeholder geometry until the game feels excellent.

## 1. The north star

**Make moving so satisfying that the player wants to continue before they care about unlocking anything.**

The core experience is:

**Push → build momentum → read the terrain → commit to a jump or ride → land cleanly → carry that energy forward.**

The player should feel responsible for their speed and expressive in how they use it. They should recognise when they have executed something well through the movement itself.

The game should feel peaceful in atmosphere and demanding in execution. Calm does not mean empty or slow. Challenge should come from rhythm, timing and managing momentum.

A successful run feels like connecting a sequence of physical gestures into one continuous movement.

Do not build a game whose main appeal depends on coins, upgrades, daily rewards or a score multiplier. Those cannot compensate for movement that feels dull.

## 2. Inspirations and what to learn from them

### Alto’s Adventure and Alto’s Odyssey

Learn from their economy of interaction, anticipation, terrain rhythm and clear silhouettes.

Their terrain continually changes what a simple input means. A slope creates speed, a crest creates an opportunity, and a landing sets up the next action. Movement and level design support each other.

Apply that thinking to every section of this game. The route must create a rhythm rather than serve as a conveyor belt carrying obstacles.

Preserve room to look ahead. A beautiful scene fails as a game if the player cannot read their next decision.

### OlliOlli and OlliOlli World

Learn from their precise inputs, meaningful landings, committed tricks and satisfaction of linking actions.

A grind must change the player’s physical state. A trick must take time and create a timing decision. A clean landing must preserve the feeling of a well-executed sequence.

Do not copy their full control vocabulary. Translate their precision and expressiveness into a smaller set of gestures.

### Journey and Flower

Learn from their sense of passage, environmental response and emotional continuity.

The world should make movement feel meaningful. Wind, sound and environmental motion should respond to the player’s energy.

Avoid interrupting a good run with excessive interface, announcements or reward effects.

### What this game must avoid

Do not drift into Temple Run or Subway Surfers.

There are no three lanes, constant sideways dodges or repeated binary obstacles on a flat treadmill. The interesting decisions concern **speed, trajectory, timing and contact with surfaces**.

## 3. The player’s relationship with movement

The character rides a simple board.

The player does not fly freely or steer around an open environment. They travel along a route with a fixed forward direction.

The route can rise, fall, curve visually, contain gaps, offer elevated grinds and meet walls. The player controls how they travel through those features.

At rest, the character should move very slowly or remain nearly still. The player earns meaningful speed through pushing, descending and successfully using movement features.

One good push must make an immediate, noticeable difference. Repeated pushes should let the player feel fast without requiring frantic input.

The player must also have time to enjoy the momentum they have built. Avoid making them constantly push simply to prevent the game from feeling sluggish.

## 4. Camera and route readability

Use one fixed oblique camera angle, with the route travelling from the lower-right foreground towards the upper-left distance.

The camera follows progress but does not orbit, repeatedly change angle or rotate to introduce features.

This is a two-dimensional control scheme presented with depth. The route has forward distance and meaningful surface height; there is no free lateral steering.

Keep the rider low enough in the frame to reveal upcoming terrain. Frame the route so that the player can see:

- The approaching takeoff.
- The gap or obstacle.
- The rail or wall they could catch.
- The surface on which they are expected to land.

The vertical format creates a real visibility constraint. Solve it through camera framing, route spacing and speed limits together.

At maximum normal speed, every compulsory feature must still have enough visible approach time to understand and act. Do not make the player compensate for the camera by memorising unseen hazards.

Optional elevated routes sit to the right of the ordinary route where practical. The ordinary route remains visible alongside them. Taking an elevated route is determined by jumping and catching it, without introducing a steering system.

## 5. The final control vocabulary

Support touch gestures and keyboard controls from the beginning. Both must feed the same gameplay actions.

### Push: downward stroke / Down arrow

A downward stroke pushes the rider forward.

The amount of deliberate downward travel influences the impulse. A longer pull should generally produce more momentum than a short pull, within sensible limits.

Repeated strokes add speed up to a readable, controllable maximum.

Use a forgiving response curve. Short intentional strokes must still work. Long strokes should feel powerful without launching the player beyond the camera’s ability to show upcoming hazards.

Holding Down must not produce unlimited automatic pushes. Keyboard pushes occur on fresh presses, so keyboard repeat settings do not determine the game’s balance.

### Jump: upward stroke / Up arrow

A fresh upward stroke while grounded triggers a jump immediately.

The jump inherits forward momentum. Speed, terrain and takeoff shape determine how far the player travels.

Do not make a jump wait for a push animation to finish. A player who pushes repeatedly and then reverses into an upward gesture must still get their jump.

Jumping repeatedly on an uphill surface must never make the rider fall through the route.

### Backflip: a second upward stroke / another Up press while airborne

A second deliberate upward stroke while airborne starts a backflip.

The flip takes time and must complete before landing.

One long upward swipe must never be counted as both the jump and the flip. A second action requires a genuinely new stroke or a clearly detected reversal followed by another upward stroke.

Do not trigger flips from diagonal gestures intended for wall riding or grabbing.

Initially allow one committed backflip per jump. Add multiple rotations only after the basic timing is consistently readable and fair.

### Heel skim: jump, then downward stroke near landing / airborne Down

A downward action during the landing approach prepares a heel-first contact.

On an ordinary surface, a correctly timed contact becomes a heel skim: the front of the board lifts and the rider slows progressively while the action remains held.

The heel skim persists until the player releases it or makes a fresh push. It must not end after an arbitrary short animation.

A fresh push returns the rider to normal movement immediately.

An early airborne downward action may arm the landing intention, but it must not freeze the rider or force an unexplained snap to the ground.

### Grinds: jump, then downward action to catch

Use the same landing preparation to catch a grind rail.

The player jumps towards a rail and commits downward as they reach its catch area. A successful catch locks the board onto the rail.

The catch window should be generous enough for mobile play while still rewarding deliberate timing. Judge the board’s trajectory and proximity to the rail, rather than requiring one exact frame or one tiny point.

Once caught, the rail carries the rider along its shape, builds or sustains satisfying speed, and produces continuous contact feedback.

The end of a rail should release the rider cleanly into a readable trajectory.

Some grinds are optional alternatives. Others bridge a gap and are compulsory. The difference must be visible before commitment.

### Left and right grabs: airborne sideways stroke and hold / hold Left or Right

While airborne, a deliberate left or right action starts the corresponding board grab.

On mobile, the player swipes sideways and maintains contact to hold the grab. Lifting the finger releases it.

On keyboard, holding the arrow holds the grab and releasing it ends the grab.

The player must release before landing. Landing while still holding the board causes failure.

A brief sideways movement must not cause an accidental persistent grab.

### Wall ride: jump and hold right beside a rideable wall

A right action near a valid right-hand wall engages a wall ride instead of an ordinary right grab.

Wall contact requires a plausible approach, suitable height and sufficient momentum. Do not teleport the rider across a large distance to make a catch happen.

A clean wall catch should feel energetic and useful. Rideable walls can sustain or build speed within the normal safety limits, with consistent friction and slope effects.

Low-speed entry must still matter. The player should not receive an arbitrary speed refill that guarantees every wall can be completed.

Make required wall sections long enough to test the mechanic. Their gaps must require the wall route rather than being trivially cleared with an ordinary jump.

Leaving the wall must create a predictable transition to the receiving surface.

## 6. Mobile input is a core system

Do not implement touch as a rough imitation of keyboard events.

Build an explicit gesture recogniser that understands strokes, direction changes, holds and releases.

It must work across different phone sizes and frame rates. Measure gesture distances in logical screen units or a proportion of the viewport.

Use separate stages for:

1. Detecting intentional movement.
2. Choosing a direction.
3. Firing the action.
4. Maintaining a hold where relevant.
5. Recognising release or a genuinely new stroke.

Once a stroke has committed to a direction, minor diagonal wobble must not change its meaning.

Use direction hysteresis and a small movement dead zone. These should reject finger noise without making the game feel delayed.

Support reversing direction without requiring the player to lift their finger after every action. In particular, a downward push followed by a clear upward reversal must reliably jump.

However, do not split one continuous stroke into repeated actions. Repeated pushes and a second upward flip both require a distinct new gesture.

Resolve ambiguous airborne actions through context:

- A deliberate second upward stroke means backflip.
- A deliberate right hold near a catchable wall means wall ride.
- The same right hold away from a wall means right grab.
- A downward landing preparation catches a nearby valid rail or produces a heel skim on ordinary ground.

Use actual proximity and approach direction for context. The mere existence of a wall somewhere ahead must not change a grab into a wall ride.

Keep all thresholds in one tuning resource. Provide a development overlay showing detected gesture, committed action and rejected-input reason.

## 7. Momentum, slopes and jumping

Build the movement model before elaborate levels.

Represent the route as a continuous surface with explicit gaps, height and slope. Use consistent world units and a fixed physics timestep.

The grounded rider follows the actual surface. Descents accelerate them; climbs consume momentum. These effects should be easy to feel without making small uphill sections exhausting.

Give the route larger, more deliberate changes in height than a gently rippling road:

- Descents that build useful speed.
- Compressions that feel like loading the board.
- Crests that offer a natural takeoff.
- Ramps that support longer jumps and completed flips.
- Climbs that make the next push meaningful.

Preserve momentum through clean landings. A landing should not secretly reset the player to a default speed.

Use a soft approach to maximum speed so that pushes and favourable terrain still feel responsive near the cap. Enforce a firm safety ceiling above that.

For airborne collision, compare the rider’s movement against the surface where they actually arrive. Never assume the landing surface is at the height from which they jumped.

Use swept contact checks to avoid passing through rising ground or narrow rails between frames.

Include a small jump buffer and coyote window. Their purpose is to respect clear intent near an edge, without allowing visibly implausible jumps.

## 8. Failures and obstacles

This game has failure and immediate retry.

Failure occurs when the player:

- Misses a gap or required catch.
- Falls short of a compulsory wall route.
- Lands with an unfinished flip.
- Lands while holding a grab.
- Hits an obstacle without a valid way to clear or break it.

Do not add a health bar or complicated damage system.

Make failure readable. Show what happened, then allow a fast retry with minimal interruption.

Retry the same seed by default so the player can learn the section. Offer a separate new-run action for a new seed.

### Pots

Low pots can be jumped over or broken with the committed heel action.

Breaking one should produce a short impact, directional fragments and an immediate sense that the rider has carried through it.

### Pillars

Taller breakable pillars require an airborne trick: a completed flip or a valid grab that has been released safely.

Place them where the approach provides enough speed, space and airtime to execute the required action.

Do not demand an action the route has not enabled.

Successful breaks should preserve flow. They must not feel like the rider has collided, stopped and then been allowed to continue.

## 9. Tactile feedback

Every important action needs an immediate response, a sustained response where appropriate, and a clear exit.

### Pushing

Use a brief body compression, board response and backward tuft of wind to communicate the impulse.

At higher speed, add restrained forward air-cutting effects and stronger movement sound. Scale these with actual speed.

### Landing

Use a quick compression and recovery. The effect should emerge from the contact point.

Cloud-like surfaces produce a small fluff. Stone produces dust or smoke. Neither should hide the board or the next hazard.

### Grinding

Show a definite change in stance and contact position.

Use sparks at the actual board–rail contact, continuous friction sound and a clean release at the end. Avoid a generic particle emitter that appears unrelated to the rail.

### Wall riding

Show a clear board and body relationship to the wall, with friction smoke following the contact point.

Entry, sustained contact and exit should each read differently.

### Breaking objects

Use a short impact sound, fragments travelling with the collision and a small restrained camera response.

The action should feel decisive while leaving the player able to read the next feature.

Animations and effects must respond to gameplay immediately. They must not prevent a valid input because an earlier animation is unfinished.

Use procedural posing or animation blending where useful. A rendered character is acceptable, but asset complexity must not become a substitute for responsive movement.

## 10. Level design and endless progression

Start with a short authored course. Do not begin with an unrestricted procedural generator.

Teach, in order:

1. A push that clearly creates speed.
2. A descent that increases momentum.
3. A forgiving jump and landing.
4. A low obstacle with two valid solutions.
5. A heel skim.
6. An optional grind.
7. A required grind.
8. A larger jump that supports a flip or grab.
9. A wall ride with an obvious approach and receiver.
10. A short sequence combining familiar actions.

Introduce one idea at a time, then connect it to earlier ideas.

After the opening works, extend the game with authored procedural phrases. Each phrase should contain a purposeful movement sequence, not a random scattering of objects.

Examples include:

- Push → descent → ramp → flip → broad landing.
- Jump → optional rail → launch → ordinary route.
- Compression → takeoff → wall ride → receiving climb.
- Pot break → short recovery → pillar trick.

Track each phrase’s required entry speed, likely exit speed, airtime and receiving surface. Validate neighbouring phrases together.

Difficulty should increase through tighter timing, longer combinations and more demanding momentum management. Keep viable approaches and readable receivers.

Do not increase difficulty by hiding hazards, shrinking catch windows below mobile precision or raising speed beyond the camera’s visibility budget.

Alternate concentrated sequences with short recovery moments. Avoid long empty stretches, but also avoid constant input with no opportunity to enjoy a clean line.

## 11. Implementation structure

Use Godot 4, targeting desktop and mobile browser play.

Keep these systems separate:

- **Input recognition:** converts touch and keyboard input into shared actions.
- **Movement simulation:** owns speed, jumping, contact, tricks and failure.
- **Course representation:** describes surfaces, gaps, rails, walls and obstacles.
- **Course assembly:** selects and validates authored phrases.
- **Presentation:** camera, character posing, sound and effects.
- **Diagnostics:** input traces, movement state, collision reasons and replay data.

Use explicit movement states and transitions. Avoid a growing collection of booleans that permits contradictory conditions.

Keep movement rules independent of rendering. Effects observe the simulation; they do not decide whether a catch, landing or trick succeeded.

Use deterministic seeds and record input actions so difficult bugs can be replayed.

Pool upcoming course content. Recycle sections only after they are safely behind the player and have no active contacts.

Support long runs without coordinate drift or growing memory use.

## 12. Build order and acceptance criteria

### First: the movement laboratory

Build a plain test route containing a descent, climb, ramp, gap, rail and wall.

Tune push strength, jump responsiveness, slope momentum and landing contact before expanding the game.

Pass criteria:

- One downward stroke makes a satisfying difference.
- Repeated pushes build controllable speed.
- Switching from pushing to jumping works immediately.
- Uphill jumping cannot cause a false fall.
- The player can understand why a catch succeeded or failed.

### Second: tricks and contact

Add heel skims, grabs, flips, grinds, wall rides and breakable obstacles.

Pass criteria:

- Every action has a distinct physical consequence.
- Mobile wall gestures do not accidentally trigger flips.
- Rails are reliably catchable from valid approaches.
- Heel skims persist and slow progressively.
- Clean landings preserve momentum.
- Failures correspond to visible mistakes.

### Third: the authored opening

Build the teaching sequence and tune it through actual play.

Pass criteria:

- A new player understands push and jump without a long tutorial.
- Compulsory features are readable before commitment.
- The course provides enough momentum for every required action.
- Good sequences feel connected rather than like separate minigames.

### Fourth: endless assembly

Add seeded phrase selection, gradual difficulty and safe recycling.

Pass criteria:

- Many seeds remain physically completable.
- Adjacent phrases work across their intended speed ranges.
- Required actions receive enough approach and recovery space.
- Long runs contain varied decisions without extended inactivity.

### Fifth: independent quality review

Assign a critical reviewer to challenge the controls, fairness and flow.

They should actively look for accidental actions, uncatchable routes, excessive effort to maintain speed, unclear failures and sections that become boring.

Use automated tests for movement invariants, input sequences, collision and procedural compatibility.

Also test real play on a phone and keyboard. Browser automation and screenshots cannot establish tactile quality.

## Final standard

The game is ready to grow when a player can push, jump, catch, trick and land without thinking about the input system.

They should feel that speed came from their actions, terrain created opportunities, and clean execution carried them into the next decision.

**Build the smallest version that makes connecting those actions feel excellent. Expand only after that foundation holds.**