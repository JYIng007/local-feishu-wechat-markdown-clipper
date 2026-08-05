(function initDomClipperCore(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DOMClipperCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : null, function createCore() {
  const invisibleCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

  function stripInvisible(value) {
    return String(value || "").replace(invisibleCharacters, "");
  }

  function normalizeText(value) {
    return stripInvisible(value).replace(/\s+/g, " ").trim();
  }

  function normalizeCode(value) {
    return stripInvisible(value).replace(/\r\n/g, "\n").trim();
  }

  function normalizeListDepth(value) {
    const depth = Number(value);
    return Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0;
  }

  function normalizeImageKey(src) {
    try {
      const url = new URL(src);
      if (!/(^|\.)mmbiz\.qpic\.cn$/i.test(url.hostname)) {
        return String(src || "");
      }

      for (const name of ["tp", "wxfrom", "wx_lazy"]) {
        url.searchParams.delete(name);
      }
      url.hash = "";
      return url.href;
    } catch (_error) {
      return String(src || "");
    }
  }

  function blockKey(block) {
    if (!block || !block.type) {
      return "unknown:";
    }

    if (block.sourceId) {
      return JSON.stringify([block.type, "source", String(block.sourceId)]);
    }

    if (block.type === "heading") {
      return JSON.stringify([block.type, Number(block.level) || 0, normalizeText(block.text)]);
    }

    if (block.type === "link") {
      return JSON.stringify([block.type, normalizeText(block.text), block.href || ""]);
    }

    if (block.type === "image") {
      return JSON.stringify([block.type, normalizeImageKey(block.src || ""), normalizeText(block.alt)]);
    }

    if (block.type === "video") {
      return JSON.stringify([block.type, block.src || "", normalizeText(block.text)]);
    }

    if (block.type === "table") {
      return JSON.stringify([block.type, block.rows || []]);
    }

    if (block.type === "listItem") {
      return JSON.stringify([
        block.type,
        normalizeText(block.text),
        String(block.markdown || ""),
        Boolean(block.ordered),
        normalizeListDepth(block.depth)
      ]);
    }

    return JSON.stringify([
      block.type,
      normalizeText(block.text),
      String(block.markdown || ""),
      Boolean(block.ordered)
    ]);
  }

  function isVisibleElement(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    if (element.tagName && element.tagName.toLowerCase() === "source" && element.parentElement) {
      return isVisibleElement(element.parentElement);
    }

    if (typeof window === "undefined" || !window.getComputedStyle) {
      return true;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    if (typeof element.getBoundingClientRect !== "function") {
      return true;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function absoluteUrl(value, element) {
    if (!value) {
      return "";
    }

    try {
      const base =
        (element && element.ownerDocument && element.ownerDocument.baseURI) ||
        (typeof location !== "undefined" && location.href) ||
        "https://example.invalid/";

      return new URL(value, base).href;
    } catch (_error) {
      return String(value);
    }
  }

  function getAttributeValue(element, names) {
    for (const name of names) {
      if (typeof element.getAttribute === "function") {
        const value = element.getAttribute(name);
        if (value) {
          return value;
        }
      }
    }

    return "";
  }

  function getTagName(element) {
    return String((element && element.tagName) || "").toLowerCase();
  }

  function isPlaceholderImageSource(value) {
    const src = String(value || "").trim();
    return /^data:image\/svg\+xml(?:[;,]|$)/i.test(src) || /\/pic_blank\.gif(?:[?#]|$)/i.test(src);
  }

  function getImageSource(element) {
    const lazySrc = getAttributeValue(element, [
      "data-src",
      "data-original",
      "data-original-src",
      "data-lazy-src"
    ]);
    const renderedSrc = element.currentSrc || element.src || getAttributeValue(element, ["src"]);
    const src = lazySrc && (!renderedSrc || isPlaceholderImageSource(renderedSrc))
      ? lazySrc
      : renderedSrc || lazySrc;

    return absoluteUrl(src, element);
  }

  function isKnownContentTag(tag) {
    return /^(h[1-6]|p|li|blockquote|pre|img|video|source|a)$/.test(tag);
  }

  function isTextContainerTag(tag) {
    return /^(div|span|section|article|main)$/.test(tag);
  }

  function hasKnownContentAncestor(element, rootElement) {
    if (element === rootElement) {
      return false;
    }

    let current = element.parentElement || null;

    while (current) {
      if (isKnownContentTag(getTagName(current))) {
        return true;
      }
      if (current === rootElement) {
        return false;
      }
      current = current.parentElement || null;
    }

    return false;
  }

  function isBlockContentTag(tag) {
    return /^(h[1-6]|p|li|blockquote|pre|div|section|article|main)$/.test(tag);
  }

  function hasDescendantBlockContent(element, selector) {
    if (typeof element.querySelectorAll !== "function") {
      return false;
    }

    return Array.from(element.querySelectorAll(selector)).some((child) => child !== element && isBlockContentTag(getTagName(child)));
  }

  function hasNonInlineExtractableDescendant(element, selector) {
    if (typeof element.querySelectorAll !== "function") {
      return false;
    }

    return Array.from(element.querySelectorAll(selector)).some(
      (child) => child !== element && getTagName(child) !== "span"
    );
  }

  function getVisibleText(element) {
    const parts = [];

    function walk(node) {
      if (!node) {
        return;
      }

      if (node.nodeType === 3) {
        parts.push(node.nodeValue || node.textContent || "");
        return;
      }

      if (node.nodeType !== 1) {
        return;
      }

      if (node !== element && !isVisibleElement(node)) {
        return;
      }

      const childNodes = Array.from(node.childNodes || []);
      if (childNodes.length === 0) {
        parts.push(node.textContent || "");
        return;
      }

      for (const child of childNodes) {
        walk(child);
      }
    }

    walk(element);
    return parts.join("");
  }

  function hasOwnReadableText(element) {
    const children = Array.from(element.children || []);
    const fullText = normalizeText(getVisibleText(element));
    if (children.length === 0) {
      return Boolean(fullText);
    }

    const childText = normalizeText(children.map((child) => getVisibleText(child)).join(" "));
    return fullText !== childText;
  }

  function hasReadableInlineContainerAncestor(element, rootElement, selector) {
    let current = element.parentElement || null;

    while (current) {
      const isReadableLeafContainer =
        isTextContainerTag(getTagName(current)) &&
        !hasDescendantBlockContent(current, selector) &&
        (hasOwnReadableText(current) || !hasNonInlineExtractableDescendant(current, selector));

      if (current === rootElement) {
        return isReadableLeafContainer;
      }

      if (isBlockContentTag(getTagName(current)) && hasDescendantBlockContent(current, selector)) {
        return false;
      }

      if (isReadableLeafContainer) {
        return true;
      }

      current = current.parentElement || null;
    }

    return false;
  }

  function pushTextBlock(blocks, tag, text) {
    if (!text) {
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ type: "heading", level: Number(tag.slice(1)), text });
    } else if (tag === "li") {
      blocks.push({ type: "listItem", text });
    } else if (tag === "blockquote") {
      blocks.push({ type: "quote", text });
    } else if (tag === "pre") {
      blocks.push({ type: "code", text });
    } else {
      blocks.push({ type: "paragraph", text });
    }
  }

  function blockFromElement(element) {
    const tag = getTagName(element);

    if (/^h[1-6]$/.test(tag) || tag === "p" || tag === "li" || tag === "blockquote" || tag === "pre") {
      const visibleText = getVisibleText(element);
      const text = tag === "pre" ? normalizeCode(visibleText) : normalizeText(visibleText);
      const blocks = [];
      pushTextBlock(blocks, tag, text);
      return blocks;
    }

    if (isTextContainerTag(tag)) {
      const text = normalizeText(getVisibleText(element));
      return text ? [{ type: "paragraph", text }] : [];
    }

    if (tag === "img") {
      const src = getImageSource(element);

      return src ? [{ type: "image", src, alt: normalizeText(element.alt || getAttributeValue(element, ["alt"])) }] : [];
    }

    if (tag === "video" || tag === "source") {
      const src = absoluteUrl(
        element.currentSrc || element.src || getAttributeValue(element, ["src", "data-src"]),
        element
      );
      const text = normalizeText(
        getAttributeValue(element, ["title", "aria-label"]) ||
          (tag === "video" ? getVisibleText(element) : "") ||
          "Video"
      );

      return src ? [{ type: "video", src, text: text || "Video" }] : [];
    }

    if (tag === "a") {
      const href = absoluteUrl(element.href || getAttributeValue(element, ["href"]), element);
      const text = normalizeText(getVisibleText(element) || href);

      return text && href ? [{ type: "link", text, href }] : [];
    }

    return [];
  }

  function extractBlocksFromElement(rootElement) {
    if (!rootElement || typeof rootElement.querySelectorAll !== "function") {
      return [];
    }

    const selector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,img,video,source,a,div,span,section,article,main";
    const nodes = [];

    if (typeof rootElement.matches === "function" && rootElement.matches(selector)) {
      nodes.push(rootElement);
    }

    nodes.push(...Array.from(rootElement.querySelectorAll(selector)));

    const blocks = [];
    for (const node of nodes) {
      if (!isVisibleElement(node)) {
        continue;
      }

      const tag = getTagName(node);
      if (
        isTextContainerTag(tag) &&
        (hasKnownContentAncestor(node, rootElement) ||
          hasDescendantBlockContent(node, selector) ||
          (!hasOwnReadableText(node) && hasNonInlineExtractableDescendant(node, selector)) ||
          hasReadableInlineContainerAncestor(node, rootElement, selector))
      ) {
        continue;
      }

      blocks.push(...blockFromElement(node));
    }

    return removeDuplicateBlocks(blocks);
  }

  function removeDuplicateBlocks(blocks) {
    const seen = new Set();
    const indexByKey = new Map();
    const result = [];

    for (const block of blocks || []) {
      const key = blockKey(block);
      if (seen.has(key)) {
        const index = indexByKey.get(key);
        if (block && block.sourceId && index !== undefined) {
          result[index] = chooseStableBlock(result[index], block);
        }
        continue;
      }

      seen.add(key);
      indexByKey.set(key, result.length);
      result.push(block);
    }

    return result;
  }

  function mergeOverlappingText(left, right) {
    const normalizedLeft = normalizeText(left);
    const normalizedRight = normalizeText(right);
    const minOverlap = 12;
    const maxOverlap = Math.min(normalizedLeft.length, normalizedRight.length);

    for (let size = maxOverlap; size >= minOverlap; size -= 1) {
      if (normalizedLeft.slice(-size) === normalizedRight.slice(0, size)) {
        return `${normalizedLeft}${normalizedRight.slice(size)}`;
      }
    }

    return null;
  }

  function blockRichness(block) {
    if (!block) {
      return 0;
    }
    if (block.type === "table") {
      const cells = (block.rows || []).flatMap((row) => (Array.isArray(row) ? row : []));
      const nonEmptyCells = cells.filter((cell) => normalizeText(cell)).length;
      const textLength = cells.reduce((total, cell) => total + String(cell || "").length, 0);
      return nonEmptyCells * 1000 + textLength;
    }
    return String(block.markdown || block.text || block.src || "").length;
  }

  function chooseStableBlock(previous, incoming) {
    if (!previous) {
      return Object.assign({}, incoming);
    }
    if (incoming && incoming.type === "image") {
      return Object.assign({}, previous, incoming);
    }
    return blockRichness(incoming) >= blockRichness(previous)
      ? Object.assign({}, previous, incoming)
      : previous;
  }

  function mergeFragments(fragments) {
    const merged = [];
    const seen = new Set();
    const indexByKey = new Map();

    for (const fragment of fragments || []) {
      for (const block of fragment.blocks || []) {
        const key = blockKey(block);
        if (seen.has(key)) {
          const index = indexByKey.get(key);
          if (block && block.sourceId && index !== undefined) {
            merged[index] = chooseStableBlock(merged[index], block);
          }
          continue;
        }

        const previous = merged[merged.length - 1];
        if (
          previous &&
          !previous.sourceId &&
          !block.sourceId &&
          previous.type === "paragraph" &&
          block.type === "paragraph"
        ) {
          const combined = mergeOverlappingText(previous.text, block.text);
          if (combined !== null) {
            previous.text = combined;
            const previousKey = blockKey(previous);
            seen.add(previousKey);
            indexByKey.set(previousKey, merged.length - 1);
            seen.add(key);
            continue;
          }
        }

        seen.add(key);
        indexByKey.set(key, merged.length);
        merged.push(Object.assign({}, block));
      }
    }

    const ordered = merged.every((block) => Number.isFinite(Number(block && block.sourceOrder)));
    if (ordered) {
      merged.sort((left, right) => Number(left.sourceOrder) - Number(right.sourceOrder));
    }

    return { blocks: merged };
  }

  function mergeOrderedSnapshots(existingBlocks, snapshotBlocks) {
    const merged = removeDuplicateBlocks(existingBlocks || []).map((block) => Object.assign({}, block));
    const snapshot = removeDuplicateBlocks(snapshotBlocks || []);

    if (merged.length === 0) {
      return { blocks: snapshot.map((block) => Object.assign({}, block)) };
    }

    function buildIndex() {
      const indexByKey = new Map();
      for (let index = 0; index < merged.length; index += 1) {
        indexByKey.set(blockKey(merged[index]), index);
      }
      return indexByKey;
    }

    let indexByKey = buildIndex();
    let previousKey = "";

    for (let snapshotIndex = 0; snapshotIndex < snapshot.length; snapshotIndex += 1) {
      const block = snapshot[snapshotIndex];
      const key = blockKey(block);
      const existingIndex = indexByKey.get(key);

      if (existingIndex !== undefined) {
        if (block && block.sourceId) {
          merged[existingIndex] = chooseStableBlock(merged[existingIndex], block);
        }
        previousKey = key;
        continue;
      }

      const previousIndex = previousKey ? indexByKey.get(previousKey) : undefined;
      let nextIndex;
      for (let lookahead = snapshotIndex + 1; lookahead < snapshot.length; lookahead += 1) {
        const candidateIndex = indexByKey.get(blockKey(snapshot[lookahead]));
        if (candidateIndex !== undefined) {
          nextIndex = candidateIndex;
          break;
        }
      }

      let insertionIndex = merged.length;
      if (nextIndex !== undefined && (previousIndex === undefined || previousIndex < nextIndex)) {
        insertionIndex = nextIndex;
      } else if (previousIndex !== undefined) {
        insertionIndex = previousIndex + 1;
      } else if (nextIndex !== undefined) {
        insertionIndex = nextIndex;
      }

      merged.splice(insertionIndex, 0, Object.assign({}, block));
      indexByKey = buildIndex();
      previousKey = key;
    }

    return { blocks: merged };
  }

  function escapeMarkdownText(value) {
    return String(value || "").replace(/\r\n/g, "\n").trim();
  }

  function escapeMarkdownLabel(value) {
    return escapeMarkdownText(value).replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  }

  function escapeMarkdownUrl(value) {
    return String(value || "")
      .trim()
      .replace(/ /g, "%20")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");
  }

  function tableCellToMarkdown(value) {
    return stripInvisible(value)
      .replace(/\r?\n/g, "<br>")
      .replace(/\|/g, "\\|")
      .trim();
  }

  function tableToMarkdown(rows) {
    const normalizedRows = (rows || [])
      .filter((row) => Array.isArray(row) && row.length > 0)
      .map((row) => row.map(tableCellToMarkdown));
    if (normalizedRows.length === 0) {
      return "";
    }

    const columnCount = normalizedRows.reduce((count, row) => Math.max(count, row.length), 0);
    const paddedRows = normalizedRows.map((row) => row.concat(Array(columnCount - row.length).fill("")));
    const header = paddedRows[0];
    const separator = Array(columnCount).fill("---");
    return [header, separator, ...paddedRows.slice(1)]
      .map((row) => `| ${row.join(" | ")} |`)
      .join("\n");
  }

  function blockToMarkdown(block) {
    if (!block || !block.type) {
      return "";
    }

    if (block.type === "heading") {
      const level = Math.min(Math.max(Number(block.level) || 2, 1), 6);
      const text = escapeMarkdownText(block.text);
      return text ? `${"#".repeat(level)} ${text}` : "";
    }

    if (block.type === "image") {
      return block.src ? `![${escapeMarkdownLabel(block.alt)}](${escapeMarkdownUrl(block.src)})` : "";
    }

    if (block.type === "video") {
      return block.src ? `[${escapeMarkdownLabel(block.text || "Video")}](${escapeMarkdownUrl(block.src)})` : "";
    }

    if (block.type === "link") {
      return block.href ? `[${escapeMarkdownLabel(block.text || block.href)}](${escapeMarkdownUrl(block.href)})` : "";
    }

    if (block.type === "listItem") {
      const text = escapeMarkdownText(block.markdown || block.text);
      const indent = "    ".repeat(normalizeListDepth(block.depth));
      return text ? `${indent}${block.ordered ? "1." : "-"} ${text}` : "";
    }

    if (block.type === "quote") {
      const text = escapeMarkdownText(block.markdown || block.text);
      return text ? text.split("\n").map((line) => `> ${line}`).join("\n") : "";
    }

    if (block.type === "code") {
      const language = String(block.language || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "");
      const text = normalizeCode(block.text);
      const longestBacktickRun = (text.match(/`+/g) || []).reduce(
        (longest, run) => Math.max(longest, run.length),
        0
      );
      const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
      return `${fence}${language}\n${text}\n${fence}`;
    }

    if (block.type === "table") {
      return tableToMarkdown(block.rows);
    }

    return escapeMarkdownText(block.markdown || block.text);
  }

  function toMarkdown(documentData) {
    const data = documentData || {};
    const title = normalizeText(data.title) || "Untitled";
    const url = normalizeText(data.url);
    const capturedAt = normalizeText(data.capturedAt);
    const body = (data.blocks || []).map(blockToMarkdown).filter(Boolean).join("\n\n");
    const lines = [`# ${title}`, ""];

    if (url) {
      lines.push(`Source: ${url}`);
    }

    if (capturedAt) {
      lines.push(`Captured: ${capturedAt}`);
    }

    if (url || capturedAt) {
      lines.push("");
    }

    if (body) {
      lines.push(body);
    }

    return `${lines.join("\n").trim()}\n`;
  }

  function sanitizeFilename(value) {
    const cleaned = normalizeText(value || "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120)
      .replace(/-+$/g, "");

    return cleaned || "web-clip";
  }

  function findScrollableContainer(element) {
    let current = element;

    while (current) {
      if ((current.scrollHeight || 0) > (current.clientHeight || 0) + 8 && hasScrollableOverflow(current)) {
        return current;
      }

      current = current.parentElement || null;
    }

    return null;
  }

  function scoreContentElement(element) {
    const blocks = extractBlocksFromElement(element);
    const textLength = blocks.reduce((total, block) => total + normalizeText(block.text || block.alt || "").length, 0);
    const mediaCount = blocks.filter((block) => block.type === "image" || block.type === "video").length;

    return {
      blocks,
      score: textLength + blocks.length * 20 + mediaCount * 30
    };
  }

  function findBestContentElement(root = typeof document !== "undefined" ? document : null) {
    if (!root) {
      return null;
    }

    const preferredSelectors = [
      "#js_content",
      ".rich_media_content",
      "article",
      "main",
      "[role='main']",
      "[contenteditable='true']",
      "[data-block-id]",
      "[data-page-id]",
      "[class*='docx']",
      "[class*='Doc']",
      "[class*='document']",
      "[class*='editor']",
      ".article",
      ".content"
    ];

    for (const selector of preferredSelectors) {
      if (typeof root.querySelector !== "function") {
        break;
      }

      const candidate = root.querySelector(selector);
      if (!candidate || !isVisibleElement(candidate)) {
        continue;
      }

      const result = scoreContentElement(candidate);
      if (result.score > 120 && result.blocks.length > 1) {
        return candidate;
      }
    }

    if (typeof root.querySelectorAll !== "function") {
      return null;
    }

    const candidates = Array.from(root.querySelectorAll("article,main,section,div"));
    let best = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      if (!isVisibleElement(candidate) || candidate.id === "dom-clipper-mvp-panel") {
        continue;
      }

      const result = scoreContentElement(candidate);
      if (result.score > bestScore) {
        best = candidate;
        bestScore = result.score;
      }
    }

    return bestScore > 120 ? best : null;
  }

  function hasScrollableOverflow(element) {
    if (typeof window === "undefined" || !window.getComputedStyle) {
      return true;
    }

    const style = window.getComputedStyle(element);
    if (!style) {
      return false;
    }

    const scrollableValues = ["auto", "scroll", "overlay"];
    return scrollableValues.includes(style.overflowY) || scrollableValues.includes(style.overflow);
  }

  function getTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");

    return [
      date.getFullYear(),
      "-",
      pad(date.getMonth() + 1),
      "-",
      pad(date.getDate()),
      " ",
      pad(date.getHours()),
      ":",
      pad(date.getMinutes())
    ].join("");
  }

  return {
    normalizeText,
    extractBlocksFromElement,
    removeDuplicateBlocks,
    mergeFragments,
    mergeOrderedSnapshots,
    mergeOverlappingText,
    toMarkdown,
    sanitizeFilename,
    findScrollableContainer,
    findBestContentElement,
    getTimestamp
  };
});
