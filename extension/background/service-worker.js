if (typeof importScripts === "function") {
  importScripts(
    "../../dom-clipper-core.js",
    "../shared/logger.js",
    "../shared/export-utils.js",
    "../shared/zip-writer.js"
  );
}

(function initDomClipperBackground(root) {
  const IMAGE_FETCH_TIMEOUT_MS = 15 * 1000;
  const IMAGE_FETCH_CONCURRENCY = 4;
  const IMAGE_LOCALIZATION_DEADLINE_MS = 210 * 1000;
  const BINARY_TYPE_BY_CONTENT_TYPE = {
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif"
  };
  const BINARY_TYPE_BY_EXTENSION = {
    ".jpg": "jpeg",
    ".png": "png",
    ".gif": "gif",
    ".webp": "webp",
    ".avif": "avif"
  };

  function errorMessage(error) {
    return error && error.message ? error.message : String(error);
  }

  function isPrivateIpv4(hostname) {
    const parts = String(hostname || "").split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false;
    }

    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }

  function parseIpv6Words(hostname) {
    const value = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (!value.includes(":")) {
      return null;
    }

    const halves = value.split("::");
    if (halves.length > 2) {
      return null;
    }

    function parseHalf(half) {
      if (!half) {
        return [];
      }
      const words = half.split(":");
      if (words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) {
        return null;
      }
      return words.map((word) => Number.parseInt(word, 16));
    }

    const left = parseHalf(halves[0]);
    const right = parseHalf(halves[1] || "");
    if (!left || !right) {
      return null;
    }
    if (halves.length === 1) {
      return left.length === 8 ? left : null;
    }

    const missingWords = 8 - left.length - right.length;
    if (missingWords < 1) {
      return null;
    }
    return left.concat(Array(missingWords).fill(0), right);
  }

  function isPrivateIpv6(hostname) {
    const words = parseIpv6Words(hostname);
    if (!words) {
      return false;
    }

    const isUnspecifiedOrLoopback = words.slice(0, 7).every((word) => word === 0) && words[7] <= 1;
    const isMappedIpv4 = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
    const mappedIpv4 = isMappedIpv4
      ? `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`
      : "";

    return (
      isUnspecifiedOrLoopback ||
      (words[0] & 0xffc0) === 0xfe80 ||
      (words[0] & 0xfe00) === 0xfc00 ||
      (isMappedIpv4 && isPrivateIpv4(mappedIpv4))
    );
  }

  function validateImageRequest(src, pageUrl) {
    let url;
    try {
      url = pageUrl ? new URL(src, pageUrl) : new URL(src);
    } catch (_error) {
      return { ok: false, reason: "unsafe image URL: invalid URL" };
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, reason: "unsafe image URL: unsupported protocol" };
    }
    if (url.username || url.password) {
      return { ok: false, reason: "unsafe image URL: embedded credentials" };
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      isPrivateIpv4(hostname) ||
      isPrivateIpv6(hostname)
    ) {
      return { ok: false, reason: "unsafe image URL: local or private destination" };
    }

    let credentials = "omit";
    try {
      const page = new URL(pageUrl);
      if (page.origin === url.origin || isSameFeishuSite(page, url)) {
        credentials = "include";
      }
    } catch (_error) {
      // Missing or malformed page origins default to the least-privileged request mode.
    }

    return { ok: true, url, credentials };
  }

  function isSameFeishuSite(pageUrl, imageUrl) {
    const pageHostname = String(pageUrl && pageUrl.hostname || "").toLowerCase().replace(/\.$/, "");
    const imageHostname = String(imageUrl && imageUrl.hostname || "").toLowerCase().replace(/\.$/, "");
    return isFeishuHostname(pageHostname) && isFeishuHostname(imageHostname);
  }

  function isFeishuHostname(hostname) {
    return hostname === "feishu.cn" || hostname.endsWith(".feishu.cn");
  }

  function bytesMatch(data, offset, expected) {
    return expected.every((byte, index) => data[offset + index] === byte);
  }

  function matchesImageSignature(type, data) {
    if (type === "jpeg") {
      return data.length >= 3 && bytesMatch(data, 0, [0xff, 0xd8, 0xff]);
    }
    if (type === "png") {
      return data.length >= 8 && bytesMatch(data, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    if (type === "gif") {
      return (
        data.length >= 6 &&
        bytesMatch(data, 0, [0x47, 0x49, 0x46, 0x38]) &&
        (data[4] === 0x37 || data[4] === 0x39) &&
        data[5] === 0x61
      );
    }
    if (type === "webp") {
      return (
        data.length >= 12 &&
        bytesMatch(data, 0, [0x52, 0x49, 0x46, 0x46]) &&
        bytesMatch(data, 8, [0x57, 0x45, 0x42, 0x50])
      );
    }
    if (type === "avif") {
      if (data.length < 12 || !bytesMatch(data, 4, [0x66, 0x74, 0x79, 0x70])) {
        return false;
      }
      for (let offset = 8; offset + 3 < data.length; offset += 4) {
        if (
          bytesMatch(data, offset, [0x61, 0x76, 0x69, 0x66]) ||
          bytesMatch(data, offset, [0x61, 0x76, 0x69, 0x73])
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function decodeBase64ToBytes(base64) {
    const binary = root.atob(String(base64 || ""));
    const data = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      data[index] = binary.charCodeAt(index);
    }
    return data;
  }

  function parseEmbeddedImageDataUrl(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/);
    if (!match) {
      return { ok: false, reason: "invalid embedded image data" };
    }

    const normalizedContentType = match[1].trim().toLowerCase();
    if (!normalizedContentType.startsWith("image/")) {
      return { ok: false, reason: `unexpected content-type=${normalizedContentType || "empty"}` };
    }

    const expectedType = BINARY_TYPE_BY_CONTENT_TYPE[normalizedContentType] || "";
    if (!expectedType) {
      return { ok: false, reason: `unsupported image type=${normalizedContentType}` };
    }

    let data;
    try {
      data = decodeBase64ToBytes(match[2].replace(/\s/g, ""));
    } catch (error) {
      return { ok: false, reason: `invalid embedded image data: ${errorMessage(error)}` };
    }

    if (!matchesImageSignature(expectedType, data)) {
      return { ok: false, reason: `image signature mismatch expected=${expectedType}` };
    }

    return {
      ok: true,
      data,
      extension: expectedType === "jpeg" ? ".jpg" : `.${expectedType}`
    };
  }

  function localizeEmbeddedImage(image, index, logger, utils) {
    const originalSrc = image && image.src ? image.src : "";
    const parsed = parseEmbeddedImageDataUrl(image && image.embeddedDataUrl);
    if (!parsed.ok) {
      logger.warn("image", "failed", { index: index + 1, reason: parsed.reason, url: originalSrc });
      return { originalSrc, ok: false, reason: parsed.reason };
    }

    const fileName = utils.imageFileName(index, parsed.extension);
    logger.info("image", "success", {
      index: index + 1,
      fileName,
      bytes: parsed.data.length,
      url: originalSrc
    });
    return { originalSrc, ok: true, fileName, data: parsed.data };
  }

  function bytesToDataUrl(bytes, mimeType = "application/zip") {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const chunkSize = 0x8000;
    let binary = "";

    for (let offset = 0; offset < input.length; offset += chunkSize) {
      const chunk = input.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return `data:${mimeType};base64,${root.btoa(binary)}`;
  }

  function hasExportableContent(blocks) {
    return (blocks || []).some((block) => {
      if (!block || typeof block !== "object") {
        return false;
      }

      if (block.type === "image" || block.type === "video") {
        return Boolean(block.src);
      }

      if (block.type === "link") {
        return Boolean(block.href || String(block.text || "").trim());
      }

      if (block.type === "table") {
        return (block.rows || []).some(
          (row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim())
        );
      }

      return Boolean(String(block.text || "").trim());
    });
  }

  function isInlineSvgDataImage(src) {
    return /^data:image\/svg\+xml(?:[;,]|$)/i.test(String(src || "").trim());
  }

  function removeSkippedImageBlocks(blocks, logger) {
    let skippedInlineSvgCount = 0;
    const keptBlocks = [];

    for (const block of blocks || []) {
      if (block && block.type === "image" && isInlineSvgDataImage(block.src)) {
        skippedInlineSvgCount += 1;
        continue;
      }

      keptBlocks.push(block);
    }

    if (skippedInlineSvgCount > 0) {
      logger.info("image", "skipped", {
        count: skippedInlineSvgCount,
        reason: "inline SVG data URL"
      });
    }

    return keptBlocks;
  }

  function getDeps(deps) {
    return {
      core: deps && deps.core ? deps.core : root.DOMClipperCore,
      deadlineReason: deps && deps.deadlineReason ? deps.deadlineReason : "",
      deadlineSignal: deps && deps.deadlineSignal ? deps.deadlineSignal : null,
      logger: deps && deps.logger ? deps.logger : root.DOMClipperLogger.createLogger(),
      pageUrl: deps && deps.pageUrl ? deps.pageUrl : "",
      timing: deps && deps.timing
        ? deps.timing
        : { setTimeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root) },
      utils: deps && deps.utils ? deps.utils : root.DOMClipperExportUtils,
      zipWriter: deps && deps.zipWriter ? deps.zipWriter : root.DOMClipperZipWriter
    };
  }

  async function injectContentScripts(tab) {
    if (!tab || !tab.id || !root.chrome || !root.chrome.scripting) {
      return;
    }

    await root.chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "dom-clipper-core.js",
        "extension/shared/logger.js",
        "extension/vendor/turndown.js",
        "extension/vendor/turndown-plugin-gfm.js",
        "extension/content/wechat-extractor.js",
        "extension/content/scys-article-extractor.js",
        "extension/content/scys-extractor.js",
        "extension/content/feishu-extractor.js",
        "extension/content/area-selector.js",
        "extension/content/collector.js",
        "extension/content/panel.js",
        "extension/content/content-script.js"
      ]
    });
  }

  async function clearActionFeedback(tabId) {
    const action = root.chrome && root.chrome.action;
    if (action && typeof action.setBadgeText === "function") {
      await action.setBadgeText({ tabId, text: "" });
    }
    if (action && typeof action.setTitle === "function") {
      await action.setTitle({ tabId, title: "Local Markdown Clipper" });
    }
  }

  async function showInjectionFailure(tabId) {
    const action = root.chrome && root.chrome.action;
    if (action && typeof action.setBadgeBackgroundColor === "function") {
      await action.setBadgeBackgroundColor({ tabId, color: "#b91c1c" });
    }
    if (action && typeof action.setBadgeText === "function") {
      await action.setBadgeText({ tabId, text: "!" });
    }
    if (action && typeof action.setTitle === "function") {
      await action.setTitle({
        tabId,
        title: "Cannot run on this page. Open a normal readable webpage."
      });
    }
  }

  async function fetchImage(image, index, deps) {
    const { deadlineReason, deadlineSignal, logger, pageUrl, timing, utils } = getDeps(deps);
    const originalSrc = image && image.src ? image.src : "";

    if (image && image.embeddedDataUrl) {
      return localizeEmbeddedImage(image, index, logger, utils);
    }

    const request = validateImageRequest(originalSrc, pageUrl);

    if (!request.ok) {
      logger.warn("image", "failed", { index: index + 1, reason: request.reason, url: originalSrc });
      return { originalSrc, ok: false, reason: request.reason };
    }

    if (deadlineSignal && deadlineSignal.aborted) {
      logger.warn("image", "failed", { index: index + 1, reason: deadlineReason, url: originalSrc });
      return { originalSrc, ok: false, reason: deadlineReason };
    }

    const controller = new root.AbortController();
    let abortReason = "";
    const abortForDeadline = () => {
      abortReason = deadlineReason;
      controller.abort();
    };
    if (deadlineSignal) {
      deadlineSignal.addEventListener("abort", abortForDeadline, { once: true });
    }
    const timeoutId = timing.setTimeout(() => {
      abortReason = `timeout after ${IMAGE_FETCH_TIMEOUT_MS}ms`;
      controller.abort();
    }, IMAGE_FETCH_TIMEOUT_MS);

    try {
      const response = await root.fetch(request.url.href, {
        credentials: request.credentials,
        redirect: "error",
        signal: controller.signal
      });
      if (!response.ok) {
        const reason = `status=${response.status}`;
        logger.warn("image", "failed", { index: index + 1, reason, url: originalSrc });
        return { originalSrc, ok: false, reason };
      }

      const contentType = response.headers && response.headers.get
        ? response.headers.get("content-type") || ""
        : "";
      const normalizedContentType = String(contentType).split(";")[0].trim().toLowerCase();
      const urlExtension = utils.extensionFromUrl(request.url.href);
      let extension = "";
      let expectedType = "";

      if (normalizedContentType.startsWith("image/")) {
        expectedType = BINARY_TYPE_BY_CONTENT_TYPE[normalizedContentType] || "";
        if (!expectedType) {
          const reason = `unsupported image type=${normalizedContentType}`;
          logger.warn("image", "failed", { index: index + 1, reason, url: originalSrc });
          return { originalSrc, ok: false, reason };
        }
        extension = expectedType === "jpeg" ? ".jpg" : `.${expectedType}`;
      } else if (
        normalizedContentType === "" ||
        normalizedContentType === "application/octet-stream"
      ) {
        expectedType = BINARY_TYPE_BY_EXTENSION[urlExtension] || "";
        if (!expectedType) {
          const reason = `unsupported binary image extension=${urlExtension || "none"}`;
          logger.warn("image", "failed", { index: index + 1, reason, url: originalSrc });
          return { originalSrc, ok: false, reason };
        }
        extension = urlExtension;
      } else {
        const reason = `unexpected content-type=${normalizedContentType || "empty"}`;
        logger.warn("image", "failed", { index: index + 1, reason, url: originalSrc });
        return { originalSrc, ok: false, reason };
      }

      const fileName = utils.imageFileName(index, extension);
      const buffer = await response.arrayBuffer();
      const data = new Uint8Array(buffer);

      if (!matchesImageSignature(expectedType, data)) {
        const reason = `image signature mismatch expected=${expectedType}`;
        logger.warn("image", "failed", { index: index + 1, reason, url: originalSrc });
        return { originalSrc, ok: false, reason };
      }

      logger.info("image", "success", {
        index: index + 1,
        fileName,
        bytes: data.length,
        url: originalSrc
      });
      return { originalSrc, ok: true, fileName, data };
    } catch (error) {
      const reason = abortReason || errorMessage(error);
      logger.warn("image", "failed", { index: index + 1, reason, url: originalSrc });
      return { originalSrc, ok: false, reason };
    } finally {
      timing.clearTimeout(timeoutId);
      if (deadlineSignal) {
        deadlineSignal.removeEventListener("abort", abortForDeadline);
      }
    }
  }

  async function buildExportZip(payload, deps) {
    const resolvedDeps = getDeps(deps);
    const { core, logger, utils, zipWriter } = resolvedDeps;
    const data = payload || {};
    const names = utils.createExportNames({ title: data.title });
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const exportBlocks = removeSkippedImageBlocks(blocks, logger);
    const images = exportBlocks.filter((block) => block && block.type === "image" && block.src);
    const localizedImages = new Array(images.length);

    if (!hasExportableContent(exportBlocks)) {
      logger.warn("extract", "empty content");
      throw new Error("No exportable content. Select a readable content area before exporting ZIP.");
    }

    logger.info("image", "start", { total: images.length });

    const deadlineController = new root.AbortController();
    const deadlineReason = `export deadline after ${IMAGE_LOCALIZATION_DEADLINE_MS}ms`;
    const localizationDeps = Object.assign({}, resolvedDeps, {
      deadlineReason,
      deadlineSignal: deadlineController.signal,
      pageUrl: data.url
    });
    const deadlineTimerId = resolvedDeps.timing.setTimeout(
      () => deadlineController.abort(),
      IMAGE_LOCALIZATION_DEADLINE_MS
    );
    let nextImageIndex = 0;
    async function localizeNextImage() {
      while (nextImageIndex < images.length) {
        const index = nextImageIndex;
        nextImageIndex += 1;
        localizedImages[index] = await fetchImage(images[index], index, localizationDeps);
      }
    }

    const workerCount = Math.min(IMAGE_FETCH_CONCURRENCY, images.length);
    try {
      await Promise.all(Array.from({ length: workerCount }, () => localizeNextImage()));
    } finally {
      resolvedDeps.timing.clearTimeout(deadlineTimerId);
    }

    const successfulImages = localizedImages.filter((image) => image.ok === true);
    const failedImages = localizedImages.filter((image) => image.ok !== true);
    logger.info("image", "complete", {
      total: localizedImages.length,
      success: successfulImages.length,
      failed: failedImages.length
    });

    const rewrittenBlocks = utils.rewriteImageBlocks(exportBlocks, {
      assetsDir: names.assetsDir,
      localizedImages
    });
    const markdown = core.toMarkdown({
      title: data.title,
      url: data.url,
      capturedAt: data.capturedAt,
      blocks: rewrittenBlocks
    });
    logger.info("zip", "markdown generated", { bytes: new TextEncoder().encode(markdown).length });

    const entries = [
      {
        path: `${names.folderName}/${names.markdownName}`,
        data: markdown
      }
    ];

    for (const image of successfulImages) {
      entries.push({
        path: `${names.folderName}/${names.assetsDir}/${image.fileName}`,
        data: image.data
      });
    }

    const zipBytes = zipWriter.createZip(entries);
    logger.info("zip", "success", {
      filename: names.zipName,
      entries: entries.length,
      bytes: zipBytes.length,
      failedImages: failedImages.length
    });

    return { names, zipBytes, localizedImages, logText: logger.toText() };
  }

  function responseSafeImages(localizedImages) {
    return localizedImages.map((image) => {
      const copy = Object.assign({}, image);
      delete copy.data;
      return copy;
    });
  }

  function validateExportSender(message, sender) {
    const runtimeId = root.chrome && root.chrome.runtime ? root.chrome.runtime.id : "";
    if (
      !sender ||
      !runtimeId ||
      sender.id !== runtimeId ||
      !sender.tab ||
      !Number.isInteger(sender.tab.id) ||
      typeof sender.tab.url !== "string" ||
      typeof sender.url !== "string"
    ) {
      return "Untrusted export request: invalid sender";
    }

    let tabUrl;
    let frameUrl;
    let payloadUrl;
    try {
      tabUrl = new URL(sender.tab.url);
      frameUrl = new URL(sender.url);
      payloadUrl = new URL(message && message.payload && message.payload.url);
    } catch (_error) {
      return "Untrusted export request: invalid sender or payload URL";
    }

    if (
      ![tabUrl, frameUrl, payloadUrl].every(
        (url) => url.protocol === "http:" || url.protocol === "https:"
      )
    ) {
      return "Untrusted export request: invalid sender or payload URL";
    }

    if (tabUrl.origin !== payloadUrl.origin || frameUrl.origin !== payloadUrl.origin) {
      return "Untrusted export request: sender origin does not match payload URL";
    }

    return "";
  }

  function rejectExportMessage(reason, sendResponse) {
    const logger = root.DOMClipperLogger.createLogger();
    logger.error("security", "export rejected", { reason });
    sendResponse({ ok: false, error: reason, logText: logger.toText() });
  }

  function handleExportMessage(message, sendResponse) {
    const logger = root.DOMClipperLogger.createLogger();

    buildExportZip(message.payload, { logger })
      .then((result) => {
        const downloadDetails = {
          url: bytesToDataUrl(result.zipBytes),
          filename: result.names.zipName,
          saveAs: false
        };

        root.chrome.downloads.download(downloadDetails, () => {
          const lastError = root.chrome.runtime && root.chrome.runtime.lastError;
          if (lastError) {
            logger.error("zip", "download failed", { reason: lastError.message || String(lastError) });
            sendResponse({
              ok: false,
              error: lastError.message || String(lastError),
              logText: logger.toText()
            });
            return;
          }

          logger.info("zip", "download triggered", { filename: result.names.zipName });
          sendResponse({
            ok: true,
            filename: result.names.zipName,
            localizedImages: responseSafeImages(result.localizedImages),
            logText: logger.toText()
          });
        });
      })
      .catch((error) => {
        logger.error("zip", "failed", { reason: errorMessage(error) });
        sendResponse({ ok: false, error: errorMessage(error), logText: logger.toText() });
      });
  }

  if (root.chrome && root.chrome.runtime && root.chrome.runtime.onMessage) {
    root.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || message.type !== "DOM_CLIPPER_EXPORT_ZIP") {
        return false;
      }

      const senderError = validateExportSender(message, sender);
      if (senderError) {
        rejectExportMessage(senderError, sendResponse);
        return false;
      }

      handleExportMessage(message, sendResponse);
      return true;
    });
  }

  if (root.chrome && root.chrome.action && root.chrome.scripting) {
    root.chrome.action.onClicked.addListener(async (tab) => {
      try {
        await clearActionFeedback(tab && tab.id);
        await injectContentScripts(tab);
        await clearActionFeedback(tab && tab.id);
      } catch (error) {
        await showInjectionFailure(tab && tab.id);
        if (root.console && typeof root.console.error === "function") {
          root.console.error("[DOMClipperBackground] injection failed", error);
        }
      }
    });
  }

  root.DOMClipperBackground = {
    version: "0.2.0",
    injectContentScripts,
    fetchImage,
    buildExportZip,
    bytesToDataUrl,
    hasExportableContent
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
