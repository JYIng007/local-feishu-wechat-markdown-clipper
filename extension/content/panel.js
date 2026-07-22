(function initDomClipperPanel(root) {
  const panelId = "dom-clipper-extension-panel";
  let currentApi = null;
  let currentActions = null;

  function getDocument() {
    return root.document || null;
  }

  function applyButtonStyle(button) {
    Object.assign(button.style, {
      margin: "4px 4px 0 0",
      padding: "6px 8px",
      border: "1px solid #6b7280",
      borderRadius: "6px",
      background: "#f9fafb",
      color: "#111827",
      cursor: "pointer"
    });
  }

  function appendButton(documentRef, container, action, label, disabled) {
    const button = documentRef.createElement("button");
    button.setAttribute("data-action", action);
    button.setAttribute("type", "button");
    button.textContent = label;
    button.disabled = Boolean(disabled);
    applyButtonStyle(button);
    container.appendChild(button);
    return button;
  }

  function createPanel(actions) {
    const documentRef = getDocument();
    if (!documentRef || !documentRef.body) {
      return null;
    }

    currentActions = actions || {};
    const existingPanel = documentRef.querySelector(`#${panelId}`);
    if (existingPanel && currentApi) {
      return currentApi;
    }
    if (existingPanel && existingPanel.__domClipperPanelApi) {
      currentApi = existingPanel.__domClipperPanelApi;
      return currentApi;
    }

    const panel = existingPanel || documentRef.createElement("div");
    panel.id = panelId;
    panel.setAttribute("id", panelId);

    if (!existingPanel) {
      const title = documentRef.createElement("div");
      title.textContent = "Local Markdown Clipper";
      Object.assign(title.style, {
        fontWeight: "600",
        marginBottom: "8px"
      });
      panel.appendChild(title);

      const status = documentRef.createElement("div");
      status.setAttribute("data-role", "status");
      status.textContent = "Ready.";
      Object.assign(status.style, {
        fontSize: "12px",
        lineHeight: "1.4",
        marginBottom: "8px"
      });
      panel.appendChild(status);

      const actionsContainer = documentRef.createElement("div");
      actionsContainer.setAttribute("data-role", "actions");
      panel.appendChild(actionsContainer);

      appendButton(documentRef, actionsContainer, "auto-start", "开始采集");
      appendButton(documentRef, actionsContainer, "stop", "提前结束");
      appendButton(documentRef, actionsContainer, "download-zip", "下载 ZIP", true);
      appendButton(documentRef, actionsContainer, "copy-log", "复制日志");
      appendButton(documentRef, actionsContainer, "recollect", "重新采集");
      appendButton(documentRef, actionsContainer, "close", "关闭");

      const advanced = documentRef.createElement("details");
      advanced.setAttribute("data-role", "advanced");
      Object.assign(advanced.style, {
        marginTop: "8px"
      });

      const advancedSummary = documentRef.createElement("summary");
      advancedSummary.textContent = "高级操作";
      advanced.appendChild(advancedSummary);
      appendButton(documentRef, advanced, "select-area", "手动选择区域");
      appendButton(documentRef, advanced, "start", "开始手动采集");
      panel.appendChild(advanced);

      const logDetails = documentRef.createElement("details");
      logDetails.setAttribute("data-role", "log-details");
      Object.assign(logDetails.style, {
        marginTop: "8px"
      });

      const logSummary = documentRef.createElement("summary");
      logSummary.textContent = "日志";
      logDetails.appendChild(logSummary);

      const log = documentRef.createElement("pre");
      log.setAttribute("data-role", "log");
      Object.assign(log.style, {
        whiteSpace: "pre-wrap",
        fontSize: "11px",
        maxHeight: "180px",
        overflow: "auto"
      });
      logDetails.appendChild(log);
      panel.appendChild(logDetails);
    }

    Object.assign(panel.style, {
      position: "fixed",
      zIndex: "2147483647",
      right: "16px",
      top: "16px",
      width: "280px",
      padding: "12px",
      background: "#111827",
      color: "#ffffff",
      border: "1px solid #374151",
      borderRadius: "8px",
      boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    });

    function stopHostEvent(event) {
      event.stopPropagation();
    }

    for (const eventName of ["pointerdown", "mousedown", "mouseup", "click", "dblclick"]) {
      panel.addEventListener(eventName, stopHostEvent);
    }

    const status = panel.querySelector('[data-role="status"]');
    const log = panel.querySelector('[data-role="log"]');
    const advanced = panel.querySelector('[data-role="advanced"]');
    const logDetails = panel.querySelector('[data-role="log-details"]');
    const autoStartButton = panel.querySelector('[data-action="auto-start"]');
    const stopButton = panel.querySelector('[data-action="stop"]');
    const downloadButton = panel.querySelector('[data-action="download-zip"]');
    const copyLogButton = panel.querySelector('[data-action="copy-log"]');
    const recollectButton = panel.querySelector('[data-action="recollect"]');

    function setStatus(message) {
      status.textContent = message || "";
    }

    function setLog(text) {
      log.textContent = text || "";
    }

    function getLog() {
      return log.textContent || "";
    }

    function enableDownload(enabled) {
      downloadButton.disabled = !enabled;
    }

    function setMode(mode) {
      const nextMode = mode || "ready";
      panel.setAttribute("data-mode", nextMode);
      autoStartButton.hidden = nextMode !== "ready";
      advanced.hidden = nextMode !== "ready" && nextMode !== "selecting";
      stopButton.hidden = nextMode !== "collecting";
      downloadButton.hidden = nextMode !== "collected" && nextMode !== "exported";
      copyLogButton.hidden = nextMode === "ready" || nextMode === "selecting";
      recollectButton.hidden = nextMode !== "collected" && nextMode !== "exported";
      logDetails.hidden = nextMode === "ready" || nextMode === "selecting";

      if (nextMode === "error") {
        logDetails.open = true;
      } else if (nextMode === "ready") {
        advanced.open = false;
        logDetails.open = false;
      }
    }

    currentApi = { panel, setStatus, setLog, getLog, enableDownload, setMode };
    panel.__domClipperPanelApi = currentApi;
    setMode("ready");

    for (const button of panel.querySelectorAll("button[data-action]")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.getAttribute("data-action");
        if (currentActions && typeof currentActions[action] === "function") {
          await currentActions[action](currentApi);
        }
      });
    }

    if (!existingPanel) {
      documentRef.body.appendChild(panel);
    }

    return currentApi;
  }

  root.DOMClipperPanel = {
    createPanel
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
