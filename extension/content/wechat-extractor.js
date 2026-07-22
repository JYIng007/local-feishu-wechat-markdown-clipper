(function initDomClipperWechatExtractor(root, factory) {
  const api = factory(root);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DOMClipperWechatExtractor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createWechatExtractor(root) {
  const IMAGE_TOKEN_PREFIX = "DOMCLIPPERWECHATIMAGE";
  const IMAGE_TOKEN_SUFFIX = "TOKEN";
  const HIDDEN_STYLE_PATTERN = /(?:^|;\s*)(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)(?:\s*;|\s*$)/i;
  const NOISE_SELECTORS = [
    "script",
    "style",
    "noscript",
    ".qr_code_pc",
    ".reward_area",
    ".rich_media_tool",
    ".code-snippet__line-index",
    "ul.code-snippet__line-index"
  ];
  const TABLE_CELL_BLOCK_SELECTOR = [
    "article",
    "aside",
    "blockquote",
    "div",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "li",
    "main",
    "ol",
    "p",
    "pre",
    "section",
    "ul"
  ].join(",");

  function loadDependency(globalName, packageName) {
    if (root && root[globalName]) {
      return root[globalName];
    }
    if (typeof require === "function") {
      try {
        return require(packageName);
      } catch (_error) {
        return null;
      }
    }
    return null;
  }

  function getDocument(value) {
    if (!value) {
      return root && root.document ? root.document : null;
    }
    if (value.nodeType === 9) {
      return value;
    }
    return value.ownerDocument || (root && root.document) || null;
  }

  function getPageUrl(value) {
    const documentRef = getDocument(value);
    return String(
      (documentRef && documentRef.location && documentRef.location.href) ||
        (documentRef && documentRef.baseURI) ||
        (root && root.location && root.location.href) ||
        ""
    );
  }

  function isWechatArticleUrl(value) {
    try {
      const url = new URL(value);
      return url.hostname.toLowerCase().replace(/\.$/, "") === "mp.weixin.qq.com";
    } catch (_error) {
      return false;
    }
  }

  function getContentRoot(value) {
    if (!value) {
      return null;
    }

    if (value.nodeType === 1 && value.id === "js_content") {
      return value;
    }

    if (value.nodeType === 1 && typeof value.closest === "function") {
      const closest = value.closest("#js_content");
      if (closest) {
        return closest;
      }
    }

    if (typeof value.querySelector === "function") {
      const nested = value.querySelector("#js_content");
      if (nested) {
        return nested;
      }
    }

    const documentRef = getDocument(value);
    return documentRef && typeof documentRef.querySelector === "function"
      ? documentRef.querySelector("#js_content")
      : null;
  }

  function supports(value) {
    return Boolean(isWechatArticleUrl(getPageUrl(value)) && getContentRoot(value));
  }

  function normalizeText(value) {
    return String(value || "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getDocumentTitle(value) {
    const documentRef = getDocument(value);
    if (!documentRef || typeof documentRef.querySelector !== "function") {
      return "";
    }

    const selectors = ["#activity-name", "#js_text_title", ".rich_media_title"];
    for (const selector of selectors) {
      const title = normalizeText(documentRef.querySelector(selector)?.textContent);
      if (title) {
        return title;
      }
    }

    const metaTitle = documentRef.querySelector('meta[property="og:title"]')?.getAttribute("content");
    return normalizeText(metaTitle || documentRef.title);
  }

  function getScrollTarget(value) {
    const documentRef = getDocument(value);
    return documentRef
      ? documentRef.scrollingElement || documentRef.documentElement || null
      : null;
  }

  function getCollectionPolicy() {
    return {
      mode: "stable-bottom",
      mergeMode: "latest",
      maxStableBottomRounds: 2,
      maxRounds: 180,
      waitMs: 700
    };
  }

  function hasAttribute(element, name) {
    return Boolean(element && typeof element.hasAttribute === "function" && element.hasAttribute(name));
  }

  function shouldRemoveOriginalElement(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    if (hasAttribute(element, "hidden") || String(element.getAttribute?.("aria-hidden") || "").toLowerCase() === "true") {
      return true;
    }

    const styleText = String(element.getAttribute?.("style") || "");
    if (HIDDEN_STYLE_PATTERN.test(styleText)) {
      return true;
    }

    const view = element.ownerDocument && element.ownerDocument.defaultView;
    const getComputedStyle =
      (view && typeof view.getComputedStyle === "function" && view.getComputedStyle.bind(view)) ||
      (root && typeof root.getComputedStyle === "function" && root.getComputedStyle.bind(root));
    if (!getComputedStyle) {
      return false;
    }

    try {
      const style = getComputedStyle(element);
      return Boolean(
        style &&
          (style.display === "none" || style.visibility === "hidden" || String(style.opacity || "").trim() === "0")
      );
    } catch (_error) {
      return false;
    }
  }

  function pruneHiddenClone(originalNode, clonedNode) {
    const originalChildren = Array.from((originalNode && originalNode.childNodes) || []);
    const clonedChildren = Array.from((clonedNode && clonedNode.childNodes) || []);
    const count = Math.min(originalChildren.length, clonedChildren.length);

    for (let index = 0; index < count; index += 1) {
      const originalChild = originalChildren[index];
      const clonedChild = clonedChildren[index];
      if (shouldRemoveOriginalElement(originalChild)) {
        clonedChild.remove();
        continue;
      }
      pruneHiddenClone(originalChild, clonedChild);
    }
  }

  function removeNoise(container) {
    for (const selector of NOISE_SELECTORS) {
      Array.from(container.querySelectorAll(selector)).forEach((element) => element.remove());
    }
  }

  function removeEmptyFormatting(container) {
    Array.from(container.querySelectorAll("strong,b,em,i,s,del"))
      .reverse()
      .forEach((element) => {
        const hasImage = typeof element.querySelector === "function" && element.querySelector("img");
        if (!normalizeText(element.textContent) && !hasImage) {
          element.remove();
        }
      });
  }

  function detectCodeLanguage(pre) {
    const direct = String(pre?.getAttribute?.("data-lang") || "").trim();
    if (direct) {
      return direct;
    }
    const className = String(pre?.getAttribute?.("class") || "");
    const match = className.match(/(?:language|lang)-([a-z0-9_+#.-]+)/i);
    return match ? match[1] : "";
  }

  function replaceElement(element, replacement) {
    if (typeof element.replaceWith === "function") {
      element.replaceWith(replacement);
    } else if (element.parentNode) {
      element.parentNode.replaceChild(replacement, element);
    }
  }

  function normalizeWechatCodeBlocks(container) {
    const documentRef = container.ownerDocument;
    let codeBlockCount = 0;

    Array.from(container.querySelectorAll(".code-snippet__fix")).forEach((wrapper) => {
      const pre = wrapper.querySelector("pre") || wrapper;
      const language = detectCodeLanguage(pre);
      const codeElements = Array.from(wrapper.querySelectorAll("code"));
      const lines = codeElements
        .map((element) => String(element.textContent || ""))
        .filter((line) => !/^[ce]?ounter\(line/i.test(line.trim()));
      const code = (lines.length > 1 ? lines.join("\n") : lines[0] || pre.textContent || "")
        .replace(/\r\n?/g, "\n")
        .replace(/^\n+|\n+$/g, "");

      if (!code.trim()) {
        wrapper.remove();
        return;
      }

      const cleanPre = documentRef.createElement("pre");
      const cleanCode = documentRef.createElement("code");
      cleanCode.textContent = code;
      if (language) {
        cleanPre.setAttribute("data-lang", language);
        cleanCode.setAttribute("class", `language-${language}`);
      }
      cleanPre.appendChild(cleanCode);
      replaceElement(wrapper, cleanPre);
      codeBlockCount += 1;
    });

    return codeBlockCount;
  }

  function unwrapWithSpacing(element, documentRef) {
    const parent = element && element.parentNode;
    if (!parent) {
      return;
    }

    parent.insertBefore(documentRef.createTextNode(" "), element);
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.insertBefore(documentRef.createTextNode(" "), element);
    parent.removeChild(element);
  }

  function normalizeWechatTables(container) {
    const documentRef = container.ownerDocument;

    Array.from(container.querySelectorAll("th,td")).forEach((cell) => {
      Array.from(cell.querySelectorAll("br")).forEach((lineBreak) => {
        replaceElement(lineBreak, documentRef.createTextNode(" "));
      });

      Array.from(cell.querySelectorAll(TABLE_CELL_BLOCK_SELECTOR))
        .reverse()
        .forEach((wrapper) => unwrapWithSpacing(wrapper, documentRef));

      if (typeof cell.normalize === "function") {
        cell.normalize();
      }
    });
  }

  function absoluteUrl(value, baseUrl) {
    try {
      return new URL(value, baseUrl).href;
    } catch (_error) {
      return String(value || "").trim();
    }
  }

  function normalizeImageKey(value) {
    try {
      const url = new URL(value);
      if (/(^|\.)mmbiz\.qpic\.cn$/i.test(url.hostname)) {
        for (const name of ["tp", "wxfrom", "wx_lazy"]) {
          url.searchParams.delete(name);
        }
      }
      url.hash = "";
      return url.href;
    } catch (_error) {
      return String(value || "");
    }
  }

  function getWechatImageSource(image, baseUrl) {
    const lazyAttributes = ["data-src", "data-original", "data-original-src", "data-lazy-src", "_src"];
    for (const name of lazyAttributes) {
      const candidate = String(image.getAttribute(name) || "").trim();
      if (candidate && !candidate.startsWith("data:image/svg")) {
        return absoluteUrl(candidate, baseUrl);
      }
    }

    const rendered = String(image.getAttribute("src") || image.src || "").trim();
    return rendered && !rendered.startsWith("data:image/svg") ? absoluteUrl(rendered, baseUrl) : "";
  }

  function prepareImages(container, baseUrl) {
    const images = [];
    const seen = new Set();

    Array.from(container.querySelectorAll("img")).forEach((image) => {
      const src = getWechatImageSource(image, baseUrl);
      const key = normalizeImageKey(src);
      if (!src || seen.has(key)) {
        image.remove();
        return;
      }

      seen.add(key);
      const token = `${IMAGE_TOKEN_PREFIX}${String(images.length + 1).padStart(4, "0")}${IMAGE_TOKEN_SUFFIX}`;
      image.setAttribute("src", src);
      image.setAttribute("data-dom-clipper-image-token", token);
      images.push({
        token,
        src,
        alt: normalizeText(image.getAttribute("alt") || ""),
        key
      });
    });

    return images;
  }

  function createTurndownService() {
    const TurndownService = loadDependency("TurndownService", "turndown");
    const plugin = loadDependency("turndownPluginGfm", "turndown-plugin-gfm");
    if (!TurndownService) {
      throw new Error("Turndown is unavailable");
    }

    const service = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      fence: "```",
      hr: "---",
      emDelimiter: "*",
      strongDelimiter: "**",
      linkStyle: "inlined"
    });

    if (plugin && typeof plugin.gfm === "function") {
      service.use(plugin.gfm);
    }

    service.addRule("wechatImages", {
      filter(node) {
        return node.nodeName === "IMG" && Boolean(node.getAttribute("data-dom-clipper-image-token"));
      },
      replacement(_content, node) {
        return `\n\n${node.getAttribute("data-dom-clipper-image-token")}\n\n`;
      }
    });

    service.addRule("wechatLineBreak", {
      filter: "br",
      replacement() {
        return "\n";
      }
    });

    return service;
  }

  function normalizeDirectoryTrees(value) {
    const lines = String(value || "").split("\n");
    const output = [];
    let activeFenceCharacter = "";
    let activeFenceLength = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        if (!activeFenceCharacter) {
          activeFenceCharacter = fence[1][0];
          activeFenceLength = fence[1].length;
        } else if (fence[1][0] === activeFenceCharacter && fence[1].length >= activeFenceLength) {
          activeFenceCharacter = "";
          activeFenceLength = 0;
        }
        output.push(line);
        continue;
      }

      const rootLine = line.trim();
      const canStartTree = Boolean(
        !activeFenceCharacter &&
          rootLine.endsWith("/") &&
          rootLine.length <= 180 &&
          !/^(?:https?:\/\/|[#>*|`-])/.test(rootLine)
      );
      if (!canStartTree) {
        output.push(line);
        continue;
      }

      const treeLines = [];
      let cursor = index + 1;
      let lastTreeIndex = index;
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        if (!candidate.trim()) {
          cursor += 1;
          continue;
        }
        if (!/^\s*(?:│\s*)*[├└]──\s*\S/.test(candidate)) {
          break;
        }
        treeLines.push(candidate);
        lastTreeIndex = cursor;
        cursor += 1;
      }

      if (treeLines.length < 2) {
        output.push(line);
        continue;
      }

      output.push("```text", rootLine, ...treeLines, "```");
      index = lastTreeIndex;
    }

    return output.join("\n");
  }

  function normalizeWechatMarkdown(value) {
    let fenceCharacter = "";
    let fenceLength = 0;
    const normalizedLines = String(value || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((originalLine) => {
        const fence = originalLine.match(/^\s*(`{3,}|~{3,})/);
        if (!fenceCharacter && fence) {
          fenceCharacter = fence[1][0];
          fenceLength = fence[1].length;
          return { line: originalLine, inCode: true };
        }

        if (fenceCharacter) {
          const closesFence = Boolean(
            fence && fence[1][0] === fenceCharacter && fence[1].length >= fenceLength
          );
          if (closesFence) {
            fenceCharacter = "";
            fenceLength = 0;
          }
          return { line: originalLine, inCode: true };
        }

        const line = originalLine
          .replace(/\u00a0/g, " ")
          .replace(/\*\*\*\*/g, "")
          .replace(/[ \t]+$/g, "");
        const bullet = line.match(/^(\s*)[•●▪▫◦·]\s*(\S.*)$/);
        if (bullet) {
          return { line: `${bullet[1]}- ${bullet[2]}`, inCode: false };
        }

        const unordered = line.match(/^(\s*)[-+*]\s+(\S.*)$/);
        if (unordered) {
          return { line: `${unordered[1]}- ${unordered[2]}`, inCode: false };
        }

        const ordered = line.match(/^(\s*)(\d+)[.)]\s+(\S.*)$/);
        return {
          line: ordered ? `${ordered[1]}${ordered[2]}. ${ordered[3]}` : line,
          inCode: false
        };
      });

    const compactLists = normalizedLines.filter((entry, index, entries) => {
      if (entry.inCode || entry.line.trim()) {
        return true;
      }

      const previous = entries[index - 1] || { line: "", inCode: false };
      const next = entries[index + 1] || { line: "", inCode: false };
      if (previous.inCode || next.inCode) {
        return true;
      }

      const previousMarker = previous.line.match(/^(\s*)(?:-|\d+\.)\s+/);
      const nextMarker = next.line.match(/^(\s*)(?:-|\d+\.)\s+/);
      return !(previousMarker && nextMarker && previousMarker[1] === nextMarker[1]);
    });

    const compactLines = [];
    let previousOutsideCodeWasBlank = false;
    for (const entry of compactLists) {
      const isOutsideCodeBlank = !entry.inCode && !entry.line.trim();
      if (isOutsideCodeBlank && previousOutsideCodeWasBlank) {
        continue;
      }
      compactLines.push(entry.line);
      previousOutsideCodeWasBlank = isOutsideCodeBlank;
    }

    return normalizeDirectoryTrees(compactLines.join("\n")).trim();
  }

  function plainTextFromMarkdown(value) {
    return normalizeText(
      String(value || "")
        .replace(/```[^\n]*\n?/g, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/<br\s*\/?\s*>/gi, " ")
        .replace(/^[ \t]*(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
        .replace(/[|*_~`\\]/g, " ")
    );
  }

  function splitMarkdownAndImages(markdown, images) {
    const imageByToken = new Map(images.map((image) => [image.token, image]));
    const tokenPattern = new RegExp(`(${IMAGE_TOKEN_PREFIX}\\d+${IMAGE_TOKEN_SUFFIX})`, "g");
    const parts = String(markdown || "").split(tokenPattern);
    const blocks = [];
    let sourceOrder = 0;
    let textIndex = 0;

    for (const part of parts) {
      const image = imageByToken.get(part);
      if (image) {
        blocks.push({
          type: "image",
          src: image.src,
          alt: image.alt,
          sourceId: `wechat:image:${image.key}`,
          sourceOrder
        });
        sourceOrder += 1;
        continue;
      }

      const normalizedMarkdown = normalizeWechatMarkdown(part);
      const text = plainTextFromMarkdown(normalizedMarkdown);
      if (!normalizedMarkdown || !text) {
        continue;
      }

      textIndex += 1;
      blocks.push({
        type: "paragraph",
        text,
        markdown: normalizedMarkdown,
        sourceId: `wechat:text:${textIndex}`,
        sourceOrder
      });
      sourceOrder += 1;
    }

    return blocks;
  }

  function visibleSourceText(element) {
    const parts = [];

    function walk(node) {
      if (!node) {
        return;
      }
      if (node.nodeType === 3) {
        parts.push(node.nodeValue || node.textContent || "");
        return;
      }
      if (node.nodeType !== 1 || shouldRemoveOriginalElement(node)) {
        return;
      }
      if (String(node.tagName || "").toLowerCase() === "br") {
        parts.push("\n");
        return;
      }
      Array.from(node.childNodes || []).forEach(walk);
    }

    walk(element);
    return normalizeText(parts.join(" "));
  }

  function logDiagnostics(logger, contentRoot, blocks, images, codeBlockCount) {
    if (!logger || typeof logger.info !== "function") {
      return;
    }

    const sourceChars = visibleSourceText(contentRoot).length;
    const exportedChars = blocks
      .filter((block) => block.type !== "image")
      .reduce((total, block) => total + plainTextFromMarkdown(block.markdown || block.text).length, 0);
    const coveragePercent = sourceChars > 0 ? Math.round((exportedChars / sourceChars) * 100) : 100;
    const tableCount = contentRoot.querySelectorAll("table").length;

    logger.info("wechat", "snapshot", {
      sourceChars,
      exportedChars,
      coveragePercent,
      images: images.length,
      codeBlocks: codeBlockCount,
      tables: tableCount
    });

    if (sourceChars >= 80 && exportedChars < sourceChars * 0.7 && typeof logger.warn === "function") {
      logger.warn("wechat", "possible content loss", {
        sourceChars,
        exportedChars,
        coveragePercent
      });
    }
  }

  function extractBlocks(value, _core, logger) {
    const contentRoot = getContentRoot(value);
    if (!contentRoot) {
      return [];
    }

    const clonedContent = contentRoot.cloneNode(true);
    pruneHiddenClone(contentRoot, clonedContent);
    removeNoise(clonedContent);
    removeEmptyFormatting(clonedContent);
    normalizeWechatTables(clonedContent);
    const codeBlockCount = normalizeWechatCodeBlocks(clonedContent);
    const images = prepareImages(clonedContent, getPageUrl(contentRoot));
    const markdown = createTurndownService().turndown(clonedContent);
    const blocks = splitMarkdownAndImages(markdown, images);
    logDiagnostics(logger, contentRoot, blocks, images, codeBlockCount);
    return blocks;
  }

  return {
    supports,
    getContentRoot,
    getDocumentTitle,
    getScrollTarget,
    getCollectionPolicy,
    extractBlocks,
    normalizeWechatMarkdown,
    plainTextFromMarkdown
  };
});
