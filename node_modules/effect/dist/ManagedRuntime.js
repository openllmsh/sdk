/// <reference lib="esnext.disposable" preserve="true" />
/**
 * Runs many effects against services built once from a `Layer`.
 *
 * A `ManagedRuntime` builds the services from a layer, keeps those services
 * available for repeated effect runs, and releases acquired resources when it
 * is disposed. This module includes the runtime type, a constructor, a guard,
 * and runners for connecting Effect programs to JavaScript entry points such as
 * promises, callbacks, and synchronous code.
 *
 * @stability stable
 * @since 2.0.0
 */
import * as Context from "./Context.js";
import * as Deferred from "./Deferred.js";
import * as Effect from "./Effect.js";
import * as Exit from "./Exit.js";
import * as Fiber from "./Fiber.js";
import { fiberEnterUninterruptibleUnsafe, scopeRemoveFinalizerUnsafe } from "./internal/effect.js";
import * as Layer from "./Layer.js";
import { hasProperty } from "./Predicate.js";
import * as Scope from "./Scope.js";
const TypeId = "~effect/ManagedRuntime";
/**
 * Checks whether the provided argument is a `ManagedRuntime`.
 *
 * **When to use**
 *
 * Use to narrow an unknown value before treating it as a `ManagedRuntime`.
 *
 * **Details**
 *
 * The guard checks the internal `ManagedRuntime` marker property. It does not
 * build the layer or inspect the runtime's services.
 *
 * **Gotchas**
 *
 * Disposed runtimes still carry the marker, so this guard does not prove the
 * runtime is still usable.
 *
 * @see {@link make} for creating managed runtimes this guard recognizes
 *
 * @stability stable
 * @category guards
 * @since 3.9.0
 */
export const isManagedRuntime = input => hasProperty(input, TypeId);
// The runtimes whose disposal the current fiber is running. A disposal adds its
// runtime to the set it inherits, so a finalizer that disposes another runtime
// still belongs to the outer disposals. Finalizers and their parallel fibers
// inherit the set from the disposing fiber. It is not provided to the layer
// build, because finalizers of layers shared through a MemoMap run with the
// build context of the runtime that built them, which may not be the runtime
// disposing them.
const DisposingRuntimes = /*#__PURE__*/Context.Reference("effect/ManagedRuntime/DisposingRuntimes", {
  defaultValue: () => new Set()
});
/**
 * Creates a `ManagedRuntime` from a layer.
 *
 * **When to use**
 *
 * Use to create a reusable runtime from a `Layer` for application entry points
 * or integration code that runs many effects without rebuilding services.
 *
 * **Details**
 *
 * The layer is built lazily on first use and its context is cached for
 * subsequent runs. Resources acquired by the layer are owned by the runtime and
 * are released when `dispose` or `disposeEffect` is run. `options.memoMap` can
 * be used to share layer memoization with other layer builds.
 *
 * **Gotchas**
 *
 * Dispose the runtime when it is no longer needed. A runtime cannot be reused
 * after disposal.
 *
 * A failed layer build is also cached: subsequent runs return the same build
 * failure without rebuilding the layer. For transient failures, retry inside
 * the layer before passing it to `make`, or dispose the runtime and create a
 * new one to attempt a fresh build.
 *
 * **Example** (Creating a managed runtime)
 *
 * ```ts import.meta.vitest
 * import { Context, Effect, Layer, ManagedRuntime } from "effect"
 *
 * const notifications: Array<string> = []
 *
 * class Notifications extends Context.Service<Notifications, {
 *   readonly notify: (message: string) => Effect.Effect<void>
 * }>()("Notifications") {
 *   static readonly layer = Layer.succeed(this)({
 *     notify: Effect.fn("Notifications.notify")((message) =>
 *       Effect.sync(() => notifications.push(message))
 *     )
 *   })
 * }
 *
 * const runtime = ManagedRuntime.make(Notifications.layer)
 *
 * const program = Effect.flatMap(
 *   Notifications,
 *   (_) => _.notify("Hello, world!")
 * ).pipe(Effect.ensuring(runtime.disposeEffect))
 *
 * await runtime.runPromise(program)
 * notifications // => ["Hello, world!"]
 * ```
 *
 * @see {@link ManagedRuntime} for the returned runtime interface
 * @see {@link Layer.MemoMap} for shared layer memoization
 * @see {@link Layer.build} for lower-level scoped layer construction
 *
 * @stability stable
 * @category constructors
 * @since 2.0.0
 */
export const make = (layer, options) => {
  const memoMap = options?.memoMap ?? Layer.makeMemoMapUnsafe();
  const scope = Scope.makeUnsafe("sequential");
  const layerScope = Scope.forkUnsafe(scope, "sequential");
  const fiberScope = Scope.forkUnsafe(scope, "parallel");
  // Fibers started by the runtime, including the layer build, are interrupted
  // and awaited by its disposal, so they and their child fibers must not wait
  // for it.
  const managedFibers = new WeakSet();
  const disposingFibers = new WeakSet();
  const defaultRunOptions = {
    onFiberStart(fiber) {
      managedFibers.add(fiber);
      if (disposingFibers.has(fiber)) return;
      Fiber.runIn(fiber, fiberScope);
    }
  };
  const mergeRunOptions = options => options ? {
    ...options,
    onFiberStart: options.onFiberStart ? fiber => {
      defaultRunOptions.onFiberStart(fiber);
      options.onFiberStart(fiber);
    } : defaultRunOptions.onFiberStart
  } : defaultRunOptions;
  let buildFiber;
  let disposed;
  const contextEffect = Effect.withFiber(fiber => {
    if (!buildFiber) {
      buildFiber = Effect.runFork(Effect.tap(Layer.buildWithMemoMap(layer, memoMap, layerScope), context => Effect.sync(() => {
        self.cachedContext = context;
      })), {
        scheduler: fiber.cache.scheduler,
        // Unlike requests, the build joins fiberScope even if it disposed the
        // runtime, so disposal still interrupts it.
        onFiberStart(fiber) {
          managedFibers.add(fiber);
          Fiber.runIn(fiber, fiberScope);
        }
      });
    }
    return Effect.flatten(Fiber.await(buildFiber));
  });
  const self = {
    [TypeId]: TypeId,
    memoMap,
    scope,
    contextEffect: contextEffect,
    cachedContext: undefined,
    context() {
      return self.cachedContext === undefined ? Effect.runPromise(self.contextEffect) : Promise.resolve(self.cachedContext);
    },
    dispose() {
      return Effect.runPromise(self.disposeEffect);
    },
    [Symbol.asyncDispose]() {
      return self.dispose();
    },
    disposeEffect: Effect.withFiber(fiber => {
      if (disposed !== undefined) {
        if (fiber.getRef(DisposingRuntimes).has(self)) return Effect.void;
        for (let current = fiber; current; current = current._parent) {
          if (managedFibers.has(current)) return Effect.void;
        }
        return Deferred.await(disposed);
      }
      // Once `disposed` is set the close must run, or later calls would wait forever.
      fiberEnterUninterruptibleUnsafe(fiber);
      const done = disposed = Deferred.makeUnsafe();
      // Closing fiberScope interrupts and awaits every managed fiber. Exempt the
      // disposing fiber and its ancestors, which would otherwise await themselves.
      for (let current = fiber; current; current = current._parent) {
        disposingFibers.add(current);
        scopeRemoveFinalizerUnsafe(fiberScope, current);
      }
      ;
      self.contextEffect = Effect.die("ManagedRuntime disposed");
      self.cachedContext = undefined;
      return Scope.close(self.scope, Exit.void).pipe(Effect.provideService(DisposingRuntimes, new Set(fiber.getRef(DisposingRuntimes)).add(self)), Effect.ensuring(Deferred.done(done, Exit.void)));
    }),
    runFork(effect, options) {
      return self.cachedContext === undefined ? Effect.runFork(provide(self, effect), mergeRunOptions(options)) : Effect.runForkWith(self.cachedContext)(effect, mergeRunOptions(options));
    },
    runCallback(effect, options) {
      return self.cachedContext === undefined ? Effect.runCallback(provide(self, effect), mergeRunOptions(options)) : Effect.runCallbackWith(self.cachedContext)(effect, mergeRunOptions(options));
    },
    runSyncExit(effect) {
      return self.cachedContext === undefined ? Effect.runSyncExit(provide(self, effect)) : Effect.runSyncExitWith(self.cachedContext)(effect);
    },
    runSync(effect) {
      return self.cachedContext === undefined ? Effect.runSync(provide(self, effect)) : Effect.runSyncWith(self.cachedContext)(effect);
    },
    runPromiseExit(effect, options) {
      return self.cachedContext === undefined ? Effect.runPromiseExit(provide(self, effect), mergeRunOptions(options)) : Effect.runPromiseExitWith(self.cachedContext)(effect, mergeRunOptions(options));
    },
    runPromise(effect, options) {
      return self.cachedContext === undefined ? Effect.runPromise(provide(self, effect), mergeRunOptions(options)) : Effect.runPromiseWith(self.cachedContext)(effect, mergeRunOptions(options));
    }
  };
  return self;
};
function provide(managed, effect) {
  return Effect.flatMap(managed.contextEffect, context => Effect.provideContext(effect, context));
}
//# sourceMappingURL=ManagedRuntime.js.map