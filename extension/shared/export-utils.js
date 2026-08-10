(function initDomClipperExportUtils(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else if (root) {
    root.DOMClipperExportUtils = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : null, function createExportUtils() {
  const imageContentTypeExtensions = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif"
  };
  const knownImageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]);
  const safeFileExtensions = new Set(["jpg", "png", "gif", "webp", "svg", "avif", "img"]);

  function pad(value, size = 2) {
    return String(value).padStart(size, "0");
  }

  function normalizeExtension(extension) {
    const rawValue = String(extension || "");
    if (/[\u0000-\u001f\u007f]/.test(rawValue)) {
      return ".img";
    }

    const value = rawValue.trim().toLowerCase();
    if (!/^\.[a-z0-9]+$|^[a-z0-9]+$/.test(value)) {
      return ".img";
    }

    const normalized = value.startsWith(".") ? value.slice(1) : value;
    if (normalized === "jpeg") {
      return ".jpg";
    }

    return safeFileExtensions.has(normalized) ? `.${normalized}` : ".img";
  }

  function sanitizeTitle(value) {
    const normalized = String(value || "")
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+/g, " ")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/[-\s.]+$/g, "");

    return normalized || "web-clip";
  }

  function formatTimestamp(date = new Date()) {
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "-",
      pad(date.getHours()),
      pad(date.getMinutes())
    ].join("");
  }

  function createExportNames({ title, date = new Date() } = {}) {
    const safeTitle = sanitizeTitle(title);
    const timestamp = formatTimestamp(date);
    const baseName = `${safeTitle}__${timestamp}`;

    return {
      safeTitle,
      timestamp,
      baseName,
      zipName: `${baseName}.zip`,
      folderName: baseName,
      markdownName: `${safeTitle}.md`,
      assetsDir: `${safeTitle}.assets`
    };
  }

  function extensionFromContentType(contentType) {
    const value = String(contentType || "").split(";")[0].trim().toLowerCase();
    return imageContentTypeExtensions[value] || "";
  }

  function extensionFromUrl(url) {
    try {
      const pathname = new URL(url).pathname;
      const lastSegment = pathname.split("/").pop() || "";
      const match = lastSegment.match(/\.([^.]+)$/);
      if (!match) {
        return "";
      }

      const extension = match[1].toLowerCase();
      if (!knownImageExtensions.has(extension)) {
        return "";
      }

      return `.${extension === "jpeg" ? "jpg" : extension}`;
    } catch (_error) {
      return "";
    }
  }

  function imageFileName(index, extension) {
    return `image-${pad(index + 1, 3)}${normalizeExtension(extension)}`;
  }

  function videoFileName(index) {
    return `video-${pad(index + 1, 3)}.mp4`;
  }

  function rewriteImageBlocks(blocks, { assetsDir, localizedImages } = {}) {
    const queueBySource = new Map();
    for (const image of localizedImages || []) {
      if (image && image.originalSrc) {
        const queue = queueBySource.get(image.originalSrc) || [];
        queue.push(image);
        queueBySource.set(image.originalSrc, queue);
      }
    }

    return (blocks || []).map((block) => {
      const copy = Object.assign({}, block);
      if (!block || block.type !== "image") {
        return copy;
      }

      const queue = queueBySource.get(block.src) || [];
      const localized = queue.shift();
      if (!localized || localized.ok !== true || !localized.fileName) {
        return copy;
      }

      copy.src = `./${assetsDir}/${localized.fileName}`;
      return copy;
    });
  }

  function rewriteVideoBlocks(blocks, { assetsDir, localizedVideos } = {}) {
    const queueBySource = new Map();
    for (const video of localizedVideos || []) {
      if (video && video.originalSrc) {
        const queue = queueBySource.get(video.originalSrc) || [];
        queue.push(video);
        queueBySource.set(video.originalSrc, queue);
      }
    }

    return (blocks || []).map((block) => {
      const copy = Object.assign({}, block);
      if (!block || block.type !== "video") {
        return copy;
      }

      const queue = queueBySource.get(block.src) || [];
      const localized = queue.shift();
      if (!localized || localized.ok !== true || !localized.fileName) {
        return copy;
      }

      copy.src = `./${assetsDir}/${localized.fileName}`;
      return copy;
    });
  }

  return {
    sanitizeTitle,
    formatTimestamp,
    createExportNames,
    extensionFromContentType,
    extensionFromUrl,
    imageFileName,
    videoFileName,
    rewriteImageBlocks,
    rewriteVideoBlocks
  };
});
