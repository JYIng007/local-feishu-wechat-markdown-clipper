(function initDomClipperLogger(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else if (root) {
    root.DOMClipperLogger = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : null, function createLoggerApi() {
  function safeString(value) {
    try {
      return String(value);
    } catch (_error) {
      return "[unserializable]";
    }
  }

  function escapeControls(value) {
    return safeString(value)
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
  }

  function formatDetailValue(value) {
    if (value !== null && typeof value === "object") {
      try {
        const serialized = JSON.stringify(value);
        if (serialized !== undefined) {
          return escapeControls(serialized);
        }
      } catch (_error) {
        // Fall through to safe primitive-style conversion.
      }
    }

    return escapeControls(value);
  }

  function formatDetails(details) {
    return Object.entries(details || {})
      .map(([key, value]) => `${escapeControls(key)}=${formatDetailValue(value)}`)
      .join(" ");
  }

  function isPlainObject(value) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) {
      return true;
    }

    if (Object.prototype.toString.call(value) !== "[object Object]") {
      return false;
    }

    const constructor = Object.prototype.hasOwnProperty.call(prototype, "constructor")
      ? prototype.constructor
      : null;
    return (
      typeof constructor === "function" &&
      Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object)
    );
  }

  function snapshotDetailValue(value, seen) {
    if (value === null || typeof value !== "object") {
      return typeof value === "function" ? safeString(value) : value;
    }

    if (Object.prototype.toString.call(value) === "[object Date]") {
      return Number.isNaN(value.getTime()) ? safeString(value) : value.toISOString();
    }

    if (seen.has(value)) {
      return "[Circular]";
    }

    if (!Array.isArray(value) && !isPlainObject(value)) {
      return safeString(value);
    }

    try {
      seen.add(value);

      if (Array.isArray(value)) {
        return value.map((item) => snapshotDetailValue(item, seen));
      }

      const snapshot = {};
      for (const [key, item] of Object.entries(value)) {
        snapshot[key] = snapshotDetailValue(item, seen);
      }
      return snapshot;
    } catch (_error) {
      return safeString(value);
    } finally {
      seen.delete(value);
    }
  }

  function deepFreeze(value, seen) {
    if (value === null || typeof value !== "object" || seen.has(value)) {
      return value;
    }

    seen.add(value);

    for (const item of Object.values(value)) {
      deepFreeze(item, seen);
    }

    return Object.freeze(value);
  }

  function snapshotDetails(details) {
    const snapshot = {};

    for (const [key, value] of Object.entries(details || {})) {
      snapshot[key] = snapshotDetailValue(value, new WeakSet());
    }

    return deepFreeze(snapshot, new WeakSet());
  }

  function createLogger() {
    const entries = [];
    const renderedDetails = new WeakMap();

    function add(level, moduleName, message, details) {
      const detailsSnapshot = snapshotDetails(details);
      const entry = Object.freeze({
        time: new Date().toISOString(),
        level,
        module: moduleName,
        message,
        details: detailsSnapshot
      });
      entries.push(entry);
      renderedDetails.set(entry, formatDetails(detailsSnapshot));
      return entry;
    }

    return {
      get entries() {
        return entries.slice();
      },
      info(moduleName, message, details) {
        return add("info", moduleName, message, details);
      },
      warn(moduleName, message, details) {
        return add("warn", moduleName, message, details);
      },
      error(moduleName, message, details) {
        return add("error", moduleName, message, details);
      },
      clear() {
        entries.length = 0;
      },
      toText() {
        return entries
          .map((entry) => {
            const details = renderedDetails.get(entry);
            return `[${escapeControls(entry.module)}] ${escapeControls(entry.message)}${details ? ` ${details}` : ""}`;
          })
          .join("\n");
      }
    };
  }

  return {
    createLogger,
    formatDetails
  };
});
