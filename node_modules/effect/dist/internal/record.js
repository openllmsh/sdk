/** @internal */
export function assignProperty(self, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(self, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  } else {
    ;
    self[key] = value;
  }
}
/** @internal */
export function assignProperties(self, source) {
  // Object.assign would fire the inherited __proto__ setter for an own __proto__ key,
  // so use the safe per-property loop in that case.
  if (!Object.hasOwn(source, "__proto__")) {
    Object.assign(self, source);
    return;
  }
  for (const key of Reflect.ownKeys(source)) {
    if (Object.prototype.propertyIsEnumerable.call(source, key)) {
      assignProperty(self, key, source[key]);
    }
  }
}
//# sourceMappingURL=record.js.map