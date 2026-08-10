(function initDomClipperContent(root) {
  if (root.DOMClipperContent && root.DOMClipperContent.initialized) {
    const documentRef = root.document || null;
    if (
      typeof root.DOMClipperContent.showPanel === "function" &&
      documentRef &&
      typeof documentRef.querySelector === "function" &&
      !documentRef.querySelector("#dom-clipper-extension-panel")
    ) {
      root.DOMClipperContent.showPanel();
    }
    return;
  }

  const existingContent = root.DOMClipperContent || {};
  let selectedElement = null;
  let collecting = false;
  let lastResult = null;
  let stopRequested = true;
  let previousOutline = null;
  let previousOutlineOffset = null;
  let stopManualSelection = null;
  let exportingZip = false;
  let stoppedEarly = false;
  const panelViewState = {
    mode: "ready",
    status: "Ready.",
    logText: "",
    downloadEnabled: false
  };
  const logger = createLogger();

  function createLogger() {
    if (root.DOMClipperLogger && typeof root.DOMClipperLogger.createLogger === "function") {
      return root.DOMClipperLogger.createLogger();
    }

    return {
      entries: [],
      info() {},
      warn() {},
      error() {},
      clear() {
        this.entries.length = 0;
      },
      toText() {
        return "";
      }
    };
  }

  function getDocument() {
    return root.document || null;
  }

  function getMountedPanelApi(fallbackApi) {
    const documentRef = getDocument();
    const panel =
      documentRef && typeof documentRef.querySelector === "function"
        ? documentRef.querySelector("#dom-clipper-extension-panel")
        : null;
    return (panel && panel.__domClipperPanelApi) || fallbackApi || null;
  }

  function applyPanelView(panelApi) {
    if (!panelApi) {
      return;
    }
    panelApi.enableDownload(panelViewState.downloadEnabled);
    panelApi.setMode(panelViewState.mode);
    panelApi.setStatus(panelViewState.status);
    panelApi.setLog(panelViewState.logText);
  }

  function updatePanelView(panelApi, changes) {
    Object.assign(panelViewState, changes || {});
    applyPanelView(getMountedPanelApi(panelApi));
  }

  function getLocationHref() {
    const currentUrl = root.location && root.location.href ? root.location.href : "";
    const documentRef = getDocument();
    const referrer = documentRef && documentRef.referrer ? documentRef.referrer : "";

    try {
      const current = new URL(currentUrl);
      const visible = new URL(referrer);
      const currentHost = current.hostname.toLowerCase().replace(/\.$/, "");
      const visibleHost = visible.hostname.toLowerCase().replace(/\.$/, "");
      const isScysHost = (hostname) => hostname === "scys.com" || hostname.endsWith(".scys.com");
      const isEmbeddedCourse = /^\/course\/detail\/[^/]+\/?$/i.test(current.pathname);
      const isActivityCourse = /^\/activity\/[^/]+\/course\/[^/]+\/?$/i.test(visible.pathname);

      if (
        isScysHost(currentHost) &&
        isScysHost(visibleHost) &&
        isEmbeddedCourse &&
        isActivityCourse
      ) {
        return visible.href;
      }
    } catch (_error) {
      // Normal top-level pages have no referrer and use their current URL.
    }

    return currentUrl;
  }

  function combineLogText(...values) {
    return values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n");
  }

  function getReadableTitle(documentRef) {
    const adapters = [
      root.DOMClipperWechatExtractor,
      root.DOMClipperScysArticleExtractor,
      root.DOMClipperScysExtractor,
      root.DOMClipperFeishuExtractor
    ];
    for (const adapter of adapters) {
      if (
        adapter &&
        typeof adapter.supports === "function" &&
        typeof adapter.getDocumentTitle === "function" &&
        adapter.supports(selectedElement)
      ) {
        const title = adapter.getDocumentTitle(selectedElement);
        if (title) {
          return title;
        }
      }
    }
    return documentRef.title || "Web Clip";
  }

  function countBlocksForType(blocks, type) {
    return (blocks || []).filter((block) => block && block.type === type).length;
  }

  function isBlobImageSource(src) {
    return String(src || "").trim().startsWith("blob:");
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return root.btoa(binary);
  }

  async function embedBlobImageBlock(block, index) {
    if (!block || block.type !== "image" || !isBlobImageSource(block.src) || block.embeddedDataUrl) {
      return block;
    }

    if (typeof root.fetch !== "function" || typeof root.btoa !== "function") {
      logger.warn("image", "embedded blob failed", {
        index: index + 1,
        reason: "page fetch unavailable",
        url: block.src
      });
      return block;
    }

    try {
      const response = await root.fetch(block.src);
      if (!response || !response.ok) {
        const status = response && response.status ? response.status : 0;
        logger.warn("image", "embedded blob failed", {
          index: index + 1,
          reason: `status=${status}`,
          url: block.src
        });
        return block;
      }

      const contentType = response.headers && typeof response.headers.get === "function"
        ? String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()
        : "";
      if (!contentType.startsWith("image/")) {
        logger.warn("image", "embedded blob failed", {
          index: index + 1,
          reason: `unexpected content-type=${contentType || "empty"}`,
          url: block.src
        });
        return block;
      }

      const buffer = await response.arrayBuffer();
      const embeddedDataUrl = `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
      logger.info("image", "embedded blob success", {
        index: index + 1,
        bytes: new Uint8Array(buffer).length,
        url: block.src
      });
      return Object.assign({}, block, { embeddedDataUrl });
    } catch (error) {
      const reason = error && error.message ? error.message : String(error);
      logger.warn("image", "embedded blob failed", { index: index + 1, reason, url: block.src });
      return block;
    }
  }

  async function embedReadableBlobImages(result) {
    const blocks = Array.isArray(result && result.blocks) ? result.blocks : [];
    if (!blocks.some((block) => block && block.type === "image" && isBlobImageSource(block.src))) {
      return result;
    }

    const embeddedBlocks = [];
    for (let index = 0; index < blocks.length; index += 1) {
      embeddedBlocks.push(await embedBlobImageBlock(blocks[index], index));
    }
    return Object.assign({}, result, { blocks: embeddedBlocks });
  }

  function setSelectedElement(element) {
    if (selectedElement && selectedElement.style) {
      selectedElement.style.outline = previousOutline || "";
      selectedElement.style.outlineOffset = previousOutlineOffset || "";
    }

    selectedElement = element || null;
    if (selectedElement && selectedElement.style) {
      previousOutline = selectedElement.style.outline || "";
      previousOutlineOffset = selectedElement.style.outlineOffset || "";
      selectedElement.style.outline = "3px solid #2563eb";
      selectedElement.style.outlineOffset = "4px";
    } else {
      previousOutline = null;
      previousOutlineOffset = null;
    }
    return selectedElement;
  }

  function promoteSmallSelection(documentRef) {
    if (
      !selectedElement ||
      !root.DOMClipperCore ||
      typeof root.DOMClipperCore.extractBlocksFromElement !== "function" ||
      typeof root.DOMClipperCore.findBestContentElement !== "function"
    ) {
      return selectedElement;
    }

    const selectedBlocks = root.DOMClipperCore.extractBlocksFromElement(selectedElement);
    const bestElement = root.DOMClipperCore.findBestContentElement(documentRef);
    if (!bestElement || bestElement === selectedElement) {
      if (selectedBlocks.length <= 1) {
        logger.warn("area", "selected area too small", { switched: false, blocks: selectedBlocks.length });
      }
      return selectedElement;
    }

    const bestBlocks = root.DOMClipperCore.extractBlocksFromElement(bestElement);
    if (selectedBlocks.length <= 1 && bestBlocks.length > selectedBlocks.length + 2) {
      setSelectedElement(bestElement);
      logger.info("area", "selected area too small", {
        switched: true,
        selectedBlocks: selectedBlocks.length,
        bestBlocks: bestBlocks.length
      });
    }

    return selectedElement;
  }

  async function autoStart(callbacks) {
    if (collecting) {
      return { ok: false, message: "Collection is already running." };
    }

    const documentRef = getDocument();
    const best = root.DOMClipperAreaSelector.selectBestArea(documentRef, root.DOMClipperCore, logger);
    if (!best) {
      return { ok: false, message: "Auto Area failed. Use Select Area." };
    }

    setSelectedElement(best);
    return start(callbacks);
  }

  async function start(callbacks) {
    const documentRef = getDocument() || {};
    const sourceUrl = getLocationHref();
    if (collecting) {
      return { ok: false, message: "Collection is already running." };
    }

    if (!selectedElement) {
      return { ok: false, message: "Select a content area first." };
    }

    collecting = true;
    stopRequested = false;
    stoppedEarly = false;
    lastResult = null;

    try {
      promoteSmallSelection(documentRef);
      const merged = await root.DOMClipperCollector.collectFromElement(selectedElement, {
        core: root.DOMClipperCore,
        logger,
        onProgress:
          callbacks && typeof callbacks.onProgress === "function"
            ? callbacks.onProgress
            : null,
        shouldStop
      });

      const blocks = Array.isArray(merged && merged.blocks) ? merged.blocks : [];
      if (blocks.length === 0) {
        logger.warn("extract", "empty content");
        lastResult = null;
        return { ok: false, message: "Selected area has no readable content.", logText: logger.toText() };
      }

      lastResult = {
        title: getReadableTitle(documentRef),
        url: sourceUrl,
        capturedAt: root.DOMClipperCore.getTimestamp(),
        blocks
      };

      return { ok: true, result: lastResult, logText: logger.toText() };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      logger.error("collect", "failed", { reason: message });
      lastResult = null;
      return { ok: false, message, logText: logger.toText() };
    } finally {
      collecting = false;
      stopRequested = true;
    }
  }

  function stop() {
    if (collecting) {
      stoppedEarly = true;
    }
    stopRequested = true;
    return { ok: true };
  }

  function shouldStop() {
    return stopRequested || !collecting;
  }

  function getLastResult() {
    return lastResult;
  }

  async function exportZip(panelApi) {
    if (!lastResult) {
      updatePanelView(panelApi, {
        mode: "error",
        status: "Collect content before downloading ZIP."
      });
      return;
    }

    if (exportingZip) {
      updatePanelView(panelApi, { status: "ZIP export already running." });
      return;
    }

    const chromeRef = root.chrome || null;
    if (!chromeRef || !chromeRef.runtime || typeof chromeRef.runtime.sendMessage !== "function") {
      updatePanelView(panelApi, {
        mode: "error",
        status: "ZIP failed: extension runtime unavailable",
        logText: logger.toText()
      });
      return;
    }

    exportingZip = true;
    updatePanelView(panelApi, {
      downloadEnabled: false,
      mode: "exporting",
      status: "Preparing ZIP..."
    });
    try {
      const payload = await embedReadableBlobImages(lastResult);
      const response = await chromeRef.runtime.sendMessage({
        type: "DOM_CLIPPER_EXPORT_ZIP",
        payload
      });

      if (!response || !response.ok) {
        updatePanelView(panelApi, {
          mode: "error",
          status: `ZIP failed: ${(response && response.error) || "unknown error"}`,
          logText: combineLogText(logger.toText(), response && response.logText)
        });
        return;
      }

      updatePanelView(panelApi, {
        mode: "exported",
        status: `ZIP downloaded: ${response.filename}`,
        logText: combineLogText(logger.toText(), response.logText)
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      updatePanelView(panelApi, {
        mode: "error",
        status: `ZIP failed: ${message}`,
        logText: logger.toText()
      });
    } finally {
      exportingZip = false;
      updatePanelView(panelApi, { downloadEnabled: Boolean(lastResult) });
    }
  }

  function startManualSelection(panelApi) {
    if (collecting) {
      updatePanelView(panelApi, {
        status: "Collection is already running. Wait for it to finish before selecting an area."
      });
      return;
    }

    const documentRef = getDocument();
    if (!documentRef || typeof documentRef.addEventListener !== "function") {
      updatePanelView(panelApi, { status: "Manual selection unavailable on this page." });
      return;
    }

    if (typeof stopManualSelection === "function") {
      stopManualSelection();
    }

    function onPick(event) {
      if (
        event.target &&
        typeof event.target.closest === "function" &&
        event.target.closest("#dom-clipper-extension-panel")
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      stopManualSelection();
      setSelectedElement(event.target);
      logger.info("area", "manual selected", { success: true });
      updatePanelView(panelApi, {
        logText: logger.toText(),
        status: "Area selected. Click Start."
      });
    }

    stopManualSelection = () => {
      documentRef.removeEventListener("click", onPick, true);
      stopManualSelection = null;
    };
    documentRef.addEventListener("click", onPick, true);
  }

  async function copyLog(panelApi) {
    const text =
      panelApi && typeof panelApi.getLog === "function" && panelApi.getLog()
        ? panelApi.getLog()
        : logger.toText();
    const navigatorRef = root.navigator || null;
    const clipboard = navigatorRef && navigatorRef.clipboard;

    if (!clipboard || typeof clipboard.writeText !== "function") {
      updatePanelView(panelApi, {
        status: "Clipboard unavailable. Open Log and copy manually.",
        logText: text
      });
      return;
    }

    try {
      await clipboard.writeText(text);
      updatePanelView(panelApi, { status: "Log copied." });
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      updatePanelView(panelApi, {
        status: `Could not copy log: ${message}`,
        logText: text
      });
    }
  }

  function collectionStatus(result, endedEarly) {
    if (result && result.ok && result.result && Array.isArray(result.result.blocks)) {
      if (endedEarly) {
        return `Collection ended early with ${result.result.blocks.length} blocks. Result may be incomplete.`;
      }
      return `Collected ${result.result.blocks.length} blocks.`;
    }
    return (result && result.message) || "Collection failed.";
  }

  function progressStatus(progress) {
    const round = progress && Number.isFinite(progress.round) ? progress.round : 0;
    const blocks = progress && Number.isFinite(progress.blocks) ? progress.blocks : 0;
    const paragraphs = progress && Number.isFinite(progress.paragraphs) ? progress.paragraphs : 0;
    const images = progress && Number.isFinite(progress.images) ? progress.images : 0;
    const links = progress && Number.isFinite(progress.links) ? progress.links : 0;
    return `Collecting round ${round}: ${blocks} blocks, ${paragraphs} paragraphs, ${images} images, ${links} links.`;
  }

  async function runAutomaticCollection(panelApi) {
    if (typeof stopManualSelection === "function") {
      stopManualSelection();
    }
    updatePanelView(panelApi, {
      downloadEnabled: false,
      mode: "collecting",
      status: "Collecting..."
    });
    const result = await autoStart({
      onProgress(progress) {
        updatePanelView(panelApi, { status: progressStatus(progress) });
      }
    });
    updatePanelView(panelApi, {
      logText: logger.toText(),
      downloadEnabled: Boolean(result && result.ok),
      mode: result && result.ok ? "collected" : "error",
      status: collectionStatus(result, stoppedEarly)
    });
  }

  function resetCollectionSession(panelApi) {
    if (typeof stopManualSelection === "function") {
      stopManualSelection();
    }
    setSelectedElement(null);
    lastResult = null;
    stopRequested = true;
    stoppedEarly = false;
    exportingZip = false;
    if (typeof logger.clear === "function") {
      logger.clear();
    }
    updatePanelView(panelApi, {
      mode: "ready",
      status: "Ready.",
      logText: "",
      downloadEnabled: false
    });
  }

  function showPanel() {
    if (!root.DOMClipperPanel || typeof root.DOMClipperPanel.createPanel !== "function") {
      return null;
    }

    const panelApi = root.DOMClipperPanel.createPanel({
      "auto-start": runAutomaticCollection,
      "select-area": async (panelApi) => {
        updatePanelView(panelApi, {
          mode: "selecting",
          status: "Click the readable content area."
        });
        startManualSelection(panelApi);
      },
      start: async (panelApi) => {
        if (typeof stopManualSelection === "function") {
          stopManualSelection();
        }
        updatePanelView(panelApi, {
          downloadEnabled: false,
          mode: "collecting",
          status: "Collecting..."
        });
        const result = await start({
          onProgress(progress) {
            updatePanelView(panelApi, { status: progressStatus(progress) });
          }
        });
        updatePanelView(panelApi, {
          logText: logger.toText(),
          downloadEnabled: Boolean(result && result.ok),
          mode: result && result.ok ? "collected" : "error",
          status: collectionStatus(result, stoppedEarly)
        });
      },
      stop: async (panelApi) => {
        if (typeof stopManualSelection === "function") {
          stopManualSelection();
        }
        stop();
        updatePanelView(panelApi, {
          status: "Ending after the current step. The result may be incomplete."
        });
      },
      "download-zip": exportZip,
      "copy-log": copyLog,
      recollect: async (panelApi) => {
        if (collecting || exportingZip) {
          updatePanelView(panelApi, { status: "Wait for the current operation to finish." });
          return;
        }
        resetCollectionSession(panelApi);
        await runAutomaticCollection(panelApi);
      },
      close: async () => {
        if (typeof stopManualSelection === "function") {
          stopManualSelection();
          updatePanelView(null, {
            mode: "ready",
            status: "Ready.",
            logText: "",
            downloadEnabled: false
          });
        }

        const documentRef = getDocument();
        const panel = documentRef && documentRef.querySelector("#dom-clipper-extension-panel");
        if (panel) {
          panel.remove();
        }
      }
    });
    if (panelApi) {
      applyPanelView(panelApi);
    }
    return panelApi;
  }

  root.DOMClipperContent = Object.assign(existingContent, {
    version: "0.4.0",
    initialized: true,
    autoStart,
    start,
    stop,
    setSelectedElement,
    getLastResult,
    showPanel,
    logger
  });

  const documentRef = getDocument();
  if (
    documentRef &&
    typeof documentRef.querySelector === "function" &&
    !documentRef.querySelector("#dom-clipper-extension-panel")
  ) {
    showPanel();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
