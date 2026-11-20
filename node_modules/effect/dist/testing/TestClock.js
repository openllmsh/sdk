/**
 * Controllable `Clock` service for tests.
 *
 * Instead of waiting for real time to pass, effects that use `Effect.sleep`,
 * timeouts, schedules, retries, and other time-based operators can be driven by
 * advancing the test clock. This makes time-based tests deterministic and fast.
 * The module also includes helpers for moving test time, temporarily using the
 * live clock, and warning when a test appears to be waiting on time without
 * advancing it.
 *
 * @stability stable
 * @since 2.0.0
 */
import * as Arr from "../Array.js";
import * as Clock from "../Clock.js";
import * as Console from "../Console.js";
import * as Context from "../Context.js";
import * as Data from "../Data.js";
import * as Duration from "../Duration.js";
import * as Effect from "../Effect.js";
import * as Fiber from "../Fiber.js";
import * as Latch from "../Latch.js";
import * as Layer from "../Layer.js";
import * as Scheduler from "../Scheduler.js";
import * as Semaphore from "../Semaphore.js";
/**
 * The warning message that will be displayed if a test is using time but is
 * not advancing the `TestClock`.
 */
const warningMessage = "A test is using time, but is not advancing the test " + "clock, which may result in the test hanging. Use TestClock.adjust to " + "manually advance the time.";
/**
 * The warning message that will be displayed if a fiber woken by the
 * `TestClock` does not suspend within the warning delay.
 */
const busyWarningMessage = "A fiber woken by the test clock is still running " + "without suspending, so the test clock stopped waiting for it. Sleeps it " + "starts later may be scheduled relative to a later time.";
/**
 * The live clock of each `TestClock`, so a `TestClock` constructed while
 * another one is the current clock uses the outer clock's live clock instead
 * of the outer `TestClock`, which only advances when adjusted.
 */
const liveClocks = /*#__PURE__*/new WeakMap();
const defaultOptions = {
  warningDelay: "1 second"
};
const nanosPerMilli = /*#__PURE__*/BigInt(1_000_000);
const millisToNanos = millis => {
  const wholeMillis = Math.floor(millis);
  const fractionalNanos = Math.floor((millis - wholeMillis) * 1_000_000);
  return BigInt(wholeMillis) * nanosPerMilli + BigInt(fractionalNanos);
};
/**
 * Creates a `TestClock` with optional configuration.
 *
 * **Gotchas**
 *
 * The guarantee that sleeps registered after multiple scheduler hops run in
 * order applies only to fibers running under {@link layer}, which
 * `@effect/vitest`'s `it.effect` uses. Providing a clock from `make` by hand
 * waits only one scheduler turn after each woken sleep. Prefer `layer` when
 * forked fibers sleep.
 *
 * **Example** (Creating a test clock)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { TestClock } from "effect/testing"
 *
 * const program = Effect.gen(function*() {
 *   // Create a TestClock with default settings
 *   const testClock = yield* TestClock.make()
 *
 *   // Create a TestClock with custom warning delay
 *   const customTestClock = yield* TestClock.make({
 *     warningDelay: "10 seconds"
 *   })
 *
 *   // Use the TestClock to control time in tests
 *   yield* testClock.adjust("1 hour")
 *   const currentTime = testClock.currentTimeMillisUnsafe()
 *   currentTime // => 3_600_000
 * })
 *
 * await Effect.runPromise(Effect.scoped(program))
 * ```
 *
 * @stability stable
 * @category constructors
 * @since 4.0.0
 */
export const make = options => Effect.map(makeWithScheduler(options), ([testClock]) => testClock);
const makeWithScheduler = /*#__PURE__*/Effect.fnUntraced(function* (options) {
  const config = {
    ...defaultOptions,
    ...options
  };
  // Sorted by descending timestamp, so `pop` wakes the earliest sleep first
  const sleeps = [];
  const currentClock = yield* Clock.clockWith(Effect.succeed);
  const liveClock = liveClocks.get(currentClock) ?? currentClock;
  const liveConsole = yield* Console.Console;
  const warningSemaphore = yield* Semaphore.make(1);
  const parentScheduler = yield* Scheduler.Scheduler;
  let currentTimestamp = new Date(0).getTime();
  let currentWallNanos = BigInt(0);
  let currentMonotonicNanos = BigInt(0);
  let warningState = WarningState.Start();
  function currentTimeMillisUnsafe() {
    return currentTimestamp;
  }
  function currentTimeNanosUnsafe() {
    return currentWallNanos;
  }
  function monotonicTimeNanosUnsafe() {
    return currentMonotonicNanos;
  }
  const currentTimeMillis = Effect.sync(currentTimeMillisUnsafe);
  const currentTimeNanos = Effect.sync(currentTimeNanosUnsafe);
  const monotonicTimeNanos = Effect.sync(monotonicTimeNanosUnsafe);
  function withLive(effect) {
    return Effect.provideService(effect, Clock.Clock, liveClock);
  }
  /**
   * Forks a fiber that will display a warning message if a test is using time
   * but is not advancing the `TestClock`.
   */
  const warningStart = warningSemaphore.withPermits(1)(Effect.suspend(() => {
    if (warningState._tag === "Start") {
      return Effect.logWarning(warningMessage).pipe(Effect.provideService(Console.Console, liveConsole), Effect.delay(config.warningDelay), withLive, Effect.forkChild, Effect.interruptible, Effect.flatMap(fiber => Effect.sync(() => {
        warningState = WarningState.Pending({
          fiber
        });
      })));
    }
    return Effect.void;
  }));
  /**
   * Cancels the warning message that is displayed if a test is using time but
   * is not advancing the `TestClock`.
   */
  const warningDone = warningSemaphore.withPermits(1)(Effect.suspend(() => {
    switch (warningState._tag) {
      case "Pending":
        {
          return Fiber.interrupt(warningState.fiber).pipe(Effect.andThen(Effect.sync(() => {
            warningState = WarningState.Done();
          })));
        }
      case "Start":
      case "Done":
        {
          warningState = WarningState.Done();
          return Effect.void;
        }
    }
  }));
  const sleep = Effect.fnUntraced(function* (duration) {
    const millis = Duration.toMillis(duration);
    const end = currentTimestamp + millis;
    if (end <= currentTimestamp) return;
    yield* Effect.acquireUseRelease(Effect.sync(() => {
      const entry = {
        timestamp: end,
        latch: Latch.makeUnsafe()
      };
      // Insert before entries with an equal timestamp, so they wake in
      // registration order
      let low = 0;
      let high = sleeps.length;
      while (low < high) {
        const mid = low + high >>> 1;
        if (sleeps[mid].timestamp > end) low = mid + 1;else high = mid;
      }
      sleeps.splice(low, 0, entry);
      return entry;
    }), entry => Effect.andThen(warningStart, entry.latch.await), entry => Effect.sync(() => {
      // The entry is already gone if `run` popped it
      const index = sleeps.indexOf(entry);
      if (index !== -1) sleeps.splice(index, 1);
    }));
  });
  /**
   * Tasks scheduled while waking a sleeper, and tasks scheduled by those tasks,
   * are counted by that wake's tracker so `run` can wait for the woken fiber,
   * and any fibers it resumes or forks, to suspend before checking the next
   * sleep.
   */
  let currentTracker = undefined;
  function runTracked(tracker, f) {
    const previous = currentTracker;
    currentTracker = tracker;
    try {
      f();
    } finally {
      currentTracker = previous;
    }
  }
  const scheduler = {
    executionMode: parentScheduler.executionMode,
    shouldYield: fiber => parentScheduler.shouldYield(fiber),
    makeDispatcher() {
      const dispatcher = parentScheduler.makeDispatcher();
      return {
        scheduleTask(task, priority) {
          const tracker = currentTracker;
          if (tracker === undefined) {
            return dispatcher.scheduleTask(task, priority);
          }
          tracker.pending++;
          dispatcher.scheduleTask(() => {
            try {
              runTracked(tracker, task);
            } finally {
              if (--tracker.pending === 0) tracker.onIdle?.();
            }
          }, priority);
        },
        flush() {
          dispatcher.flush();
        }
      };
    }
  };
  const wake = latch => Effect.suspend(() => {
    const tracker = {
      pending: 0,
      onIdle: undefined
    };
    runTracked(tracker, () => latch.openUnsafe());
    if (tracker.pending === 0) return Effect.yieldNow;
    return Effect.callback(resume => {
      if (tracker.pending === 0) return resume(Effect.void);
      tracker.onIdle = () => resume(Effect.void);
      return Effect.sync(() => {
        tracker.onIdle = undefined;
      });
    }).pipe(Effect.timeoutOrElse({
      duration: config.warningDelay,
      orElse: () => Effect.provideService(Effect.logWarning(busyWarningMessage), Console.Console, liveConsole)
    }), withLive, Effect.andThen(Effect.yieldNow));
  });
  const runSemaphore = yield* Semaphore.make(1);
  const run = Effect.fnUntraced(function* (step, adjustmentNanos) {
    yield* Fiber.await(yield* Effect.forkChild(Effect.yieldNow));
    const initialWallNanos = currentWallNanos;
    const initialMonotonicNanos = currentMonotonicNanos;
    const endTimestamp = step(currentTimestamp);
    const advanceTo = timestamp => {
      const deltaMillis = timestamp - currentTimestamp;
      if (deltaMillis > 0 && Number.isFinite(deltaMillis)) {
        currentMonotonicNanos += BigInt(Math.round(deltaMillis * 1_000_000));
      }
      if (Number.isFinite(timestamp)) {
        currentWallNanos = millisToNanos(timestamp);
      }
      currentTimestamp = timestamp;
    };
    while (Arr.isArrayNonEmpty(sleeps)) {
      if (Arr.lastNonEmpty(sleeps).timestamp > endTimestamp) break;
      const entry = sleeps.pop();
      advanceTo(entry.timestamp);
      yield* wake(entry.latch);
    }
    advanceTo(endTimestamp);
    if (adjustmentNanos !== undefined && Number.isFinite(endTimestamp)) {
      currentWallNanos = initialWallNanos + adjustmentNanos;
      if (adjustmentNanos > BigInt(0)) {
        currentMonotonicNanos = initialMonotonicNanos + adjustmentNanos;
      }
    }
  }, runSemaphore.withPermits(1));
  function adjust(input) {
    const duration = Duration.fromInputUnsafe(input);
    const millis = Duration.toMillis(duration);
    const nanos = Number.isFinite(millis) ? Duration.toNanosUnsafe(duration) : undefined;
    return warningDone.pipe(Effect.andThen(run(timestamp => timestamp + millis, nanos)));
  }
  function setTime(timestamp) {
    return warningDone.pipe(Effect.andThen(run(() => timestamp)));
  }
  yield* Effect.addFinalizer(() => warningDone);
  const testClock = {
    currentTimeMillisUnsafe,
    currentTimeNanosUnsafe,
    monotonicTimeNanosUnsafe,
    currentTimeMillis,
    currentTimeNanos,
    monotonicTimeNanos,
    adjust,
    setTime,
    sleep,
    withLive
  };
  liveClocks.set(testClock, liveClock);
  return [testClock, scheduler];
});
/**
 * Creates a `Layer` which constructs a `TestClock`.
 *
 * **Example** (Providing a test clock layer)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { TestClock } from "effect/testing"
 *
 * // Create a TestClock layer
 * const testClockLayer = TestClock.layer()
 *
 * // Create a TestClock layer with custom options
 * const customTestClockLayer = TestClock.layer({
 *   warningDelay: "5 seconds"
 * })
 *
 * const program = Effect.gen(function*() {
 *   // Use the layer in your program
 *   yield* TestClock.adjust("1 hour")
 *   return yield* TestClock.testClockWith((testClock) =>
 *     Effect.succeed(testClock.currentTimeMillisUnsafe())
 *   )
 * })
 *
 * await Effect.runPromise(Effect.provide(program, testClockLayer)) // => 3_600_000
 * await Effect.runPromise(Effect.provide(program, customTestClockLayer)) // => 3_600_000
 * ```
 *
 * @stability stable
 * @category layers
 * @since 4.0.0
 */
export const layer = options => Layer.effectContext(Effect.map(makeWithScheduler(options), ([testClock, scheduler]) => Context.make(Clock.Clock, testClock).pipe(Context.add(Scheduler.Scheduler, scheduler))));
/**
 * Retrieves the `TestClock` service for this test and uses it to run the
 * specified workflow.
 *
 * **Example** (Accessing the test clock)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { TestClock } from "effect/testing"
 *
 * const program = Effect.gen(function*() {
 *   // Use testClockWith to access the TestClock instance
 *   const currentTime = yield* TestClock.testClockWith((testClock) =>
 *     Effect.succeed(testClock.currentTimeMillisUnsafe())
 *   )
 *
 *   // Adjust time using the TestClock instance
 *   yield* TestClock.testClockWith((testClock) => testClock.adjust("2 hours"))
 *
 *   currentTime // => 0
 * })
 *
 * await Effect.runPromise(Effect.provide(program, TestClock.layer()))
 * ```
 *
 * @stability stable
 * @category testing
 * @since 2.0.0
 */
export const testClockWith = f => Effect.withFiber(fiber => f(fiber.getRef(Clock.Clock)));
/**
 * Accesses a `TestClock` instance in the context and increments the time
 * by the specified duration, running any actions scheduled for on or before
 * the new time in order.
 *
 * **Example** (Advancing the test clock)
 *
 * ```ts import.meta.vitest
 * import { Effect, Fiber } from "effect"
 * import { TestClock } from "effect/testing"
 *
 * const program = Effect.gen(function*() {
 *   let executed = false
 *
 *   // Fork an effect that sleeps for 30 minutes
 *   const fiber = yield* Effect.gen(function*() {
 *     yield* Effect.sleep("30 minutes")
 *     executed = true
 *   }).pipe(Effect.forkChild)
 *
 *   // Advance the clock by 30 minutes
 *   yield* TestClock.adjust("30 minutes")
 *   yield* Fiber.join(fiber)
 *
 *   // The effect should now be executed
 *   executed // => true
 * })
 *
 * await Effect.runPromise(Effect.provide(program, TestClock.layer()))
 * ```
 *
 * @stability stable
 * @category testing
 * @since 2.0.0
 */
export const adjust = duration => testClockWith(testClock => testClock.adjust(duration));
/**
 * Sets the current clock time to the specified `timestamp`. Any effects that
 * were scheduled to occur on or before the new time will be run in order.
 *
 * **Example** (Setting the test clock time)
 *
 * ```ts import.meta.vitest
 * import { Duration, Effect, Fiber } from "effect"
 * import { TestClock } from "effect/testing"
 *
 * const program = Effect.gen(function*() {
 *   let executed = false
 *
 *   // Fork an effect that sleeps for 2 hours
 *   const fiber = yield* Effect.gen(function*() {
 *     yield* Effect.sleep("2 hours")
 *     executed = true
 *   }).pipe(Effect.forkChild)
 *
 *   // Set the clock to a specific timestamp (2 hours from epoch)
 *   const targetTime = Duration.toMillis(Duration.hours(2))
 *   yield* TestClock.setTime(targetTime)
 *   yield* Fiber.join(fiber)
 *
 *   // The effect should now be executed
 *   executed // => true
 * })
 *
 * await Effect.runPromise(Effect.provide(program, TestClock.layer()))
 * ```
 *
 * @stability stable
 * @category testing
 * @since 2.0.0
 */
export const setTime = timestamp => testClockWith(testClock => testClock.setTime(timestamp));
/**
 * Executes the specified effect with the live `Clock` instead of the
 * `TestClock`.
 *
 * **Example** (Running with the live clock)
 *
 * ```ts import.meta.vitest
 * import { Clock, Effect } from "effect"
 * import { TestClock } from "effect/testing"
 *
 * const program = Effect.gen(function*() {
 *   // Get the current test time (starts at epoch)
 *   const testTime = yield* Clock.currentTimeMillis
 *   testTime // => 0
 *
 *   // Get the actual system time using withLive
 *   const realTime = yield* TestClock.withLive(Clock.currentTimeMillis)
 *   Number.isFinite(realTime) // => true
 *
 *   // Advance test time
 *   yield* TestClock.adjust("1 hour")
 *
 *   // Test time is now 1 hour ahead
 *   const newTestTime = yield* Clock.currentTimeMillis
 *   newTestTime // => 3_600_000
 * })
 *
 * await Effect.runPromise(Effect.provide(program, TestClock.layer()))
 * ```
 *
 * @stability stable
 * @category testing
 * @since 4.0.0
 */
export const withLive = effect => testClockWith(testClock => testClock.withLive(effect));
const WarningState = /*#__PURE__*/Data.taggedEnum();
//# sourceMappingURL=TestClock.js.map