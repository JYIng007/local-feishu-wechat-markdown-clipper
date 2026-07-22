(function initDomClipperFeishuExtractor(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DOMClipperFeishuExtractor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createFeishuExtractor() {
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

  function inlineMarkdownToText(value) {
    return normalizeText(
      String(value || "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<br>/g, " ")
        .replace(/[*~]/g, "")
    );
  }

  function classNames(element) {
    return String((element && element.className) || "").split(/\s+/).filter(Boolean);
  }

  function hasClass(element, name) {
    return classNames(element).includes(name);
  }

  function isFeishuUrl(value) {
    try {
      const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
      return hostname === "feishu.cn" || hostname.endsWith(".feishu.cn");
    } catch (_error) {
      return false;
    }
  }

  function getPageBlock(rootElement) {
    if (!rootElement) {
      return null;
    }
    if (hasClass(rootElement, "docx-page-block")) {
      return rootElement;
    }
    if (typeof rootElement.closest === "function") {
      const ancestor = rootElement.closest(".docx-page-block");
      if (ancestor) {
        return ancestor;
      }
    }
    return typeof rootElement.querySelector === "function"
      ? rootElement.querySelector(".docx-page-block")
      : null;
  }

  function supports(rootElement) {
    const page = getPageBlock(rootElement);
    const baseUrl =
      (rootElement && rootElement.ownerDocument && rootElement.ownerDocument.baseURI) ||
      (page && page.ownerDocument && page.ownerDocument.baseURI) ||
      "";
    return Boolean(page && isFeishuUrl(baseUrl));
  }

  function getDocumentTitle(rootElement) {
    const page = getPageBlock(rootElement) || rootElement;
    if (!page || typeof page.querySelector !== "function") {
      return "";
    }

    const heading = page.querySelector("h1") || page.querySelector(".docx-title");
    return normalizeText(heading && heading.textContent);
  }

  function getScrollTarget(rootElement, core) {
    const page = getPageBlock(rootElement);
    if (!page || !core || typeof core.findScrollableContainer !== "function") {
      return null;
    }
    return core.findScrollableContainer(page);
  }

  function isBlock(element) {
    return Boolean(
      element &&
        hasClass(element, "block") &&
        typeof element.getAttribute === "function" &&
        element.getAttribute("data-block-id")
    );
  }

  function nearestBlockAncestor(element) {
    let current = element && element.parentElement;
    while (current) {
      if (isBlock(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function directChildBlocks(container) {
    if (!container || typeof container.querySelectorAll !== "function") {
      return [];
    }
    return Array.from(container.querySelectorAll(".block[data-block-id]")).filter(
      (element) => nearestBlockAncestor(element) === container
    );
  }

  function isManagedContainer(block) {
    const classes = classNames(block);
    return (
      classes.includes("docx-quote_container-block") ||
      classes.includes("docx-table-block") ||
      classes.includes("docx-table_cell-block") ||
      classes.includes("docx-code-block")
    );
  }

  function isListBlock(block) {
    const classes = classNames(block);
    return classes.includes("docx-ordered-block") || classes.includes("docx-bullet-block");
  }

  function getListDepth(block) {
    let depth = 0;
    let ancestor = nearestBlockAncestor(block);
    while (ancestor) {
      if (isListBlock(ancestor)) {
        depth += 1;
      }
      ancestor = nearestBlockAncestor(ancestor);
    }
    return depth;
  }

  function getBlockIdentity(block) {
    if (!block || typeof block.getAttribute !== "function") {
      return { recordId: "", sourceOrder: null };
    }

    const blockId = block.getAttribute("data-block-id") || "";
    const fallbackOrder = Number(blockId);
    let sourceOrder = Number.isFinite(fallbackOrder) ? fallbackOrder : null;
    const page = getPageBlock(block);
    if (
      page &&
      typeof page.getBoundingClientRect === "function" &&
      typeof block.getBoundingClientRect === "function"
    ) {
      const pageRect = page.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();
      const visualOrder = Number(blockRect && blockRect.top) - Number(pageRect && pageRect.top);
      if (Number.isFinite(visualOrder)) {
        sourceOrder = visualOrder;
      }
    }
    return {
      recordId: block.getAttribute("data-record-id") || blockId,
      sourceOrder
    };
  }

  function withBlockMetadata(items, sourceBlock) {
    const list = (items || []).filter(Boolean);
    const identity = getBlockIdentity(sourceBlock);
    if (!identity.recordId) {
      return list;
    }

    return list.map((item, index) => {
      const prefix = item.type === "image" ? "feishu-image" : "feishu-block";
      const suffix = list.length > 1 ? `:${index}` : "";
      const metadata = { sourceId: `${prefix}:${identity.recordId}${suffix}` };
      if (identity.sourceOrder !== null) {
        metadata.sourceOrder = identity.sourceOrder;
      }
      return Object.assign({}, item, metadata);
    });
  }

  function documentBlocks(page) {
    if (!page || typeof page.querySelectorAll !== "function") {
      return [];
    }

    return Array.from(page.querySelectorAll(".block[data-block-id]")).filter((block) => {
      let ancestor = nearestBlockAncestor(block);
      while (ancestor && ancestor !== page) {
        if (isManagedContainer(ancestor)) {
          return false;
        }
        ancestor = nearestBlockAncestor(ancestor);
      }
      return ancestor === page;
    });
  }

  function escapeLabel(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  }

  function escapeUrl(value) {
    return String(value || "").trim().replace(/\(/g, "%28").replace(/\)/g, "%29");
  }

  function serializeInline(node) {
    if (!node) {
      return "";
    }
    if (node.nodeType === 3) {
      return stripInvisible(node.nodeValue || node.textContent || "");
    }
    if (node.nodeType !== 1) {
      return "";
    }

    const tag = String(node.tagName || "").toLowerCase();
    if (tag === "br") {
      return "<br>";
    }
    if (tag === "img" || tag === "svg" || tag === "button" || hasClass(node, "ignore-dom")) {
      return "";
    }

    let content = Array.from(node.childNodes || []).map(serializeInline).join("");
    content = stripInvisible(content);
    if (!content) {
      return "";
    }

    if (tag === "a") {
      const href = node.href || (typeof node.getAttribute === "function" && node.getAttribute("href"));
      if (href) {
        return `[${escapeLabel(normalizeText(content))}](${escapeUrl(href)})`;
      }
    }

    const style = String(
      (typeof node.getAttribute === "function" && node.getAttribute("style")) || ""
    ).toLowerCase();
    if (tag === "strong" || tag === "b" || /font-weight\s*:\s*(?:bold|[6-9]00)/.test(style)) {
      content = `**${content}**`;
    }
    if (tag === "em" || tag === "i" || /font-style\s*:\s*italic/.test(style)) {
      content = `*${content}*`;
    }
    if (tag === "s" || tag === "del" || /text-decoration[^;]*line-through/.test(style)) {
      content = `~~${content}~~`;
    }

    return content;
  }

  function serializeLine(line) {
    return stripInvisible(Array.from((line && line.childNodes) || []).map(serializeInline).join(""))
      .replace(/\s+/g, " ")
      .trim();
  }

  function ownedEditableZones(block) {
    if (!block || typeof block.querySelectorAll !== "function") {
      return [];
    }
    return Array.from(block.querySelectorAll(".zone-container[data-slate-editor]")).filter(
      (zone) => nearestBlockAncestor(zone) === block
    );
  }

  function serializeEditableBlock(block) {
    const zones = ownedEditableZones(block);
    const lines = [];

    for (const zone of zones) {
      const zoneLines = Array.from(zone.querySelectorAll(".ace-line"));
      if (zoneLines.length === 0) {
        const fallback = normalizeText(zone.textContent);
        if (fallback) {
          lines.push(fallback);
        }
        continue;
      }
      for (const line of zoneLines) {
        const markdown = serializeLine(line);
        if (markdown) {
          lines.push(markdown);
        }
      }
    }

    return {
      markdown: lines.join("<br>"),
      text: inlineMarkdownToText(lines.join(" "))
    };
  }

  function serializeNestedBlocks(container) {
    const parts = [];
    for (const child of directChildBlocks(container)) {
      const value = serializeEditableBlock(child);
      if (value.markdown) {
        parts.push(value.markdown);
      }
    }
    return {
      markdown: parts.join("<br>"),
      text: inlineMarkdownToText(parts.join(" "))
    };
  }

  function serializeTableCell(cell) {
    const nested = serializeNestedBlocks(cell);
    if (nested.markdown) {
      return nested.markdown;
    }
    return serializeEditableBlock(cell).markdown || normalizeText(cell && cell.textContent);
  }

  function extractTable(block) {
    const rows = [];
    for (const row of Array.from(block.querySelectorAll("tr"))) {
      const cells = Array.from(row.children || []).filter((cell) => {
        const tag = String(cell.tagName || "").toLowerCase();
        return tag === "td" || tag === "th";
      });
      if (cells.length > 0) {
        rows.push(cells.map(serializeTableCell));
      }
    }
    return rows.length > 0 ? { type: "table", rows } : null;
  }

  function extractCode(block) {
    const container = block.querySelector(".code-block-zone-container");
    if (!container) {
      return null;
    }
    const lines = Array.from(container.querySelectorAll(".ace-line")).map(serializeLine);
    const text = normalizeCode(lines.join("\n"));
    return text ? { type: "code", text } : null;
  }

  function extractImageBlock(block, core) {
    const images = core
      .extractBlocksFromElement(block)
      .filter((item) => item && item.type === "image");
    return withBlockMetadata(images, block);
  }

  function extractQuote(block, core) {
    const items = [];
    const children = directChildBlocks(block);

    for (const child of children) {
      if (hasClass(child, "docx-image-block")) {
        items.push(...extractImageBlock(child, core));
        continue;
      }

      const value = serializeEditableBlock(child);
      if (value.markdown) {
        items.push(...withBlockMetadata([
          { type: "quote", text: value.text, markdown: value.markdown }
        ], child));
      }
    }

    if (items.length > 0) {
      return items;
    }

    const fallback = serializeEditableBlock(block);
    return fallback.markdown
      ? withBlockMetadata([
          { type: "quote", text: fallback.text, markdown: fallback.markdown }
        ], block)
      : [];
  }

  function extractBlock(block, core) {
    const classes = classNames(block);
    const headingClass = classes.find((name) => /^docx-heading[1-6]-block$/.test(name));
    if (headingClass) {
      const level = Number(headingClass.match(/heading([1-6])/)[1]);
      const value = serializeEditableBlock(block);
      return value.text
        ? withBlockMetadata([{ type: "heading", level, text: value.text }], block)
        : [];
    }

    if (classes.includes("docx-image-block")) {
      return extractImageBlock(block, core);
    }

    if (classes.includes("docx-table-block")) {
      const table = extractTable(block);
      return table ? withBlockMetadata([table], block) : [];
    }

    if (classes.includes("docx-code-block")) {
      const code = extractCode(block);
      return code ? withBlockMetadata([code], block) : [];
    }

    if (classes.includes("docx-quote_container-block")) {
      return extractQuote(block, core);
    }

    if (classes.includes("docx-ordered-block") || classes.includes("docx-bullet-block")) {
      const value = serializeEditableBlock(block);
      return value.markdown
        ? withBlockMetadata([{
            type: "listItem",
            ordered: classes.includes("docx-ordered-block"),
            depth: getListDepth(block),
            text: value.text,
            markdown: value.markdown
          }], block)
        : [];
    }

    if (classes.includes("docx-text-block") && !classes.includes("isEmpty")) {
      const value = serializeEditableBlock(block);
      return value.markdown
        ? withBlockMetadata([
            { type: "paragraph", text: value.text, markdown: value.markdown }
          ], block)
        : [];
    }

    return [];
  }

  function extractBlocks(rootElement, core) {
    const page = getPageBlock(rootElement);
    if (!page || !core) {
      return [];
    }

    const blocks = [];
    for (const block of documentBlocks(page)) {
      blocks.push(...extractBlock(block, core));
    }

    return typeof core.removeDuplicateBlocks === "function"
      ? core.removeDuplicateBlocks(blocks)
      : blocks;
  }

  return {
    extractBlocks,
    getDocumentTitle,
    getScrollTarget,
    stripInvisible,
    supports
  };
});
