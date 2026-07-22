(function initDomClipperScysArticleExtractor(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DOMClipperScysArticleExtractor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createScysArticleExtractor() {
  const invisibleCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

  function stripInvisible(value) {
    return String(value || "").replace(invisibleCharacters, "");
  }

  function normalizeText(value) {
    return stripInvisible(value).replace(/\s+/g, " ").trim();
  }

  function normalizeMarkdown(value) {
    return stripInvisible(value)
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\s*<br>\s*/g, "<br>")
      .trim();
  }

  function normalizeCode(value) {
    return stripInvisible(value)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/^\n+|\n+$/g, "");
  }

  function classNames(element) {
    return String((element && element.className) || "").split(/\s+/).filter(Boolean);
  }

  function hasClass(element, name) {
    return classNames(element).includes(name);
  }

  function isScysArticleUrl(value) {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
      const isScysHost = hostname === "scys.com" || hostname.endsWith(".scys.com");
      return isScysHost && /^\/articleDetail\/xq_topic\/[^/]+\/?$/i.test(url.pathname);
    } catch (_error) {
      return false;
    }
  }

  function hasArticleContent(element) {
    return Boolean(
      element &&
        typeof element.querySelector === "function" &&
        element.querySelector(".feishu-doc-content") &&
        element.querySelector(".vc-doc-item")
    );
  }

  function getArticleRoot(rootElement) {
    if (!rootElement) {
      return null;
    }

    if (hasArticleContent(rootElement)) {
      return rootElement;
    }

    if (typeof rootElement.closest === "function") {
      const main = rootElement.closest("main");
      if (hasArticleContent(main)) {
        return main;
      }
    }

    if (typeof rootElement.querySelector === "function") {
      const main = rootElement.querySelector("main");
      if (hasArticleContent(main)) {
        return main;
      }
    }

    const documentRef = rootElement.ownerDocument;
    if (documentRef && typeof documentRef.querySelector === "function") {
      const main = documentRef.querySelector("main");
      if (hasArticleContent(main)) {
        return main;
      }
    }

    return null;
  }

  function nearestContentAncestor(element) {
    let current = element && element.parentElement;
    while (current) {
      if (hasClass(current, "feishu-doc-content")) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function getContentRoots(rootElement) {
    const articleRoot = getArticleRoot(rootElement);
    if (!articleRoot || typeof articleRoot.querySelectorAll !== "function") {
      return [];
    }
    const roots = hasClass(articleRoot, "feishu-doc-content")
      ? [articleRoot]
      : Array.from(articleRoot.querySelectorAll(".feishu-doc-content"));
    return roots.filter((contentRoot) => !nearestContentAncestor(contentRoot));
  }

  function getPreludeRoots(rootElement) {
    const articleRoot = getArticleRoot(rootElement);
    if (!articleRoot || typeof articleRoot.querySelectorAll !== "function") {
      return [];
    }
    const containers = hasClass(articleRoot, "content-container")
      ? [articleRoot]
      : Array.from(articleRoot.querySelectorAll(".content-container"));
    return containers.flatMap((container) => {
      if (!container.querySelector || !container.querySelector(".feishu-doc-content")) {
        return [];
      }
      return Array.from(container.children || []).filter((child) => hasClass(child, "post-content"));
    });
  }

  function supports(rootElement) {
    const articleRoot = getArticleRoot(rootElement);
    const baseUrl =
      (rootElement && rootElement.ownerDocument && rootElement.ownerDocument.baseURI) ||
      (articleRoot && articleRoot.ownerDocument && articleRoot.ownerDocument.baseURI) ||
      "";
    return Boolean(articleRoot && isScysArticleUrl(baseUrl));
  }

  function titleCandidates(container) {
    if (!container || typeof container.querySelectorAll !== "function") {
      return [];
    }

    const selectors = [
      ".post-title",
      ".article-title",
      ".article_detail_title",
      ".article-detail-title",
      ".topic-title",
      "h1"
    ];
    const candidates = [];
    for (const selector of selectors) {
      for (const node of Array.from(container.querySelectorAll(selector))) {
        const title = normalizeText(node && node.textContent);
        if (title && !candidates.includes(title)) {
          candidates.push(title);
        }
      }
    }
    return candidates;
  }

  function getDocumentTitle(rootElement) {
    const articleRoot = getArticleRoot(rootElement) || rootElement;
    const documentRef = articleRoot && articleRoot.ownerDocument;
    const candidates = titleCandidates(documentRef).concat(titleCandidates(articleRoot));
    const readable = candidates.find((title) => title.length >= 4);
    if (readable) {
      return readable;
    }

    return normalizeText(documentRef && documentRef.title).replace(/\s*[-|｜]\s*生财有术.*$/i, "");
  }

  function escapeLabel(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  }

  function escapeUrl(value) {
    return String(value || "").trim().replace(/\(/g, "%28").replace(/\)/g, "%29");
  }

  function wrapInlineMarkdown(value, marker) {
    const content = String(value || "");
    const leading = (content.match(/^\s*/) || [""])[0];
    const trailing = (content.match(/\s*$/) || [""])[0];
    const inner = content.trim();
    return inner ? `${leading}${marker}${inner}${marker}${trailing}` : content;
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
    if (tag === "img" || tag === "video" || tag === "source" || tag === "svg" || tag === "button") {
      return "";
    }
    if (hasClass(node, "bullet-dot")) {
      return "";
    }

    let content = stripInvisible(Array.from(node.childNodes || []).map(serializeInline).join(""));
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
    const classes = classNames(node);
    if (
      tag === "strong" ||
      tag === "b" ||
      classes.includes("bold") ||
      /font-weight\s*:\s*(?:bold|[6-9]00)/.test(style)
    ) {
      content = wrapInlineMarkdown(content, "**");
    }
    if (tag === "em" || tag === "i" || classes.includes("italic") || /font-style\s*:\s*italic/.test(style)) {
      content = wrapInlineMarkdown(content, "*");
    }
    if (
      tag === "s" ||
      tag === "del" ||
      classes.includes("strikethrough") ||
      /text-decoration[^;]*line-through/.test(style)
    ) {
      content = wrapInlineMarkdown(content, "~~");
    }

    return content;
  }

  function normalizeCodeLanguage(value) {
    const language = normalizeText(value).toLowerCase();
    if (language === "plain text" || language === "plaintext" || language === "txt") {
      return "text";
    }
    if (language === "md") {
      return "markdown";
    }
    return language;
  }

  function nearestItemAncestor(item) {
    let current = item && item.parentElement;
    while (current) {
      if (hasClass(current, "vc-doc-item")) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function isListItem(item) {
    if (!item || typeof item.querySelector !== "function") {
      return false;
    }
    const marker = item.querySelector(".bullet_container") || item.querySelector(".bullet-dot") || item.querySelector(".bulletlist");
    return Boolean(
      marker &&
        (typeof marker.closest !== "function" || marker.closest(".vc-doc-item") === item)
    );
  }

  function documentHeadingLevel(item) {
    const headingClass = classNames(item).find((name) => /^doc-heading-[1-9]$/.test(name));
    if (!headingClass) {
      return 0;
    }
    return Math.min(Number(headingClass.slice("doc-heading-".length)) || 0, 6);
  }

  function isOrderedListItem(item) {
    const container = item && item.firstElementChild;
    const classes = classNames(container).concat(classNames(item));
    return classes.some((name) => /ordered|number/i.test(name));
  }

  function isQuoteItem(item) {
    return Boolean(item && typeof item.querySelector === "function" && item.querySelector(".quote_container"));
  }

  function isCalloutItem(item) {
    return Boolean(item && typeof item.querySelector === "function" && item.querySelector(".callout"));
  }

  function extractCodeBlock(item) {
    if (!item || typeof item.querySelector !== "function") {
      return null;
    }

    const block = item.querySelector(".block-code");
    if (!block) {
      return null;
    }

    const content =
      block.querySelector(".block-code-content code") ||
      block.querySelector("pre code") ||
      block.querySelector(".block-code-content") ||
      block.querySelector("pre");
    const text = normalizeCode(content && content.textContent);
    if (!text) {
      return null;
    }

    const languageNode = block.querySelector(".block-code-language");
    return {
      type: "code",
      language: normalizeCodeLanguage(languageNode && languageNode.textContent),
      text
    };
  }

  function serializeItemText(item) {
    const bulletText = item && item.querySelector && item.querySelector(".bulletlist");
    if (bulletText) {
      return normalizeMarkdown(serializeInline(bulletText));
    }

    const zones = item && item.querySelectorAll
      ? Array.from(item.querySelectorAll(".block-text")).filter(
          (zone) => typeof zone.closest !== "function" || zone.closest(".vc-doc-item") === item
        )
      : [];
    if (zones.length > 0) {
      return zones.map((zone) => normalizeMarkdown(serializeInline(zone))).filter(Boolean).join("<br>");
    }
    return normalizeMarkdown(serializeInline(item));
  }

  function directItemsInContainer(container) {
    if (!container || typeof container.querySelectorAll !== "function") {
      return [];
    }
    return Array.from(container.querySelectorAll(".vc-doc-item")).filter((item) => {
      let current = item.parentElement;
      while (current && current !== container) {
        if (hasClass(current, "vc-doc-item")) {
          return false;
        }
        current = current.parentElement;
      }
      return current === container;
    });
  }

  function serializeTableCell(cell) {
    const items = directItemsInContainer(cell);
    if (items.length > 0) {
      return items.map(serializeItemText).filter(Boolean).join("<br>");
    }
    return normalizeMarkdown(serializeInline(cell));
  }

  function extractDivTable(item) {
    if (!item || typeof item.querySelector !== "function") {
      return null;
    }

    const table = item.querySelector(".table");
    if (!table) {
      return null;
    }

    const columnClass = classNames(table).find((name) => /^table_\d+$/.test(name));
    const columnCount = columnClass ? Number(columnClass.slice("table_".length)) : 0;
    if (!Number.isInteger(columnCount) || columnCount < 1) {
      return null;
    }

    const cells = Array.from(table.querySelectorAll(".table_cell"))
      .filter((cell) => typeof cell.closest !== "function" || cell.closest(".table") === table)
      .map(serializeTableCell);
    if (cells.length === 0) {
      return null;
    }

    const rows = [];
    for (let index = 0; index < cells.length; index += columnCount) {
      const row = cells.slice(index, index + columnCount);
      rows.push(row.concat(Array(columnCount - row.length).fill("")));
    }
    return { type: "table", rows };
  }

  function hasDescendantImage(node) {
    return Boolean(node && typeof node.querySelector === "function" && node.querySelector("img"));
  }

  function inlineUnits(container) {
    const units = [];
    let markdown = "";

    function flushText() {
      const normalized = normalizeMarkdown(markdown);
      if (normalized) {
        units.push({ type: "text", markdown: normalized });
      }
      markdown = "";
    }

    function visit(node) {
      if (!node) {
        return;
      }
      if (node.nodeType === 3) {
        markdown += stripInvisible(node.nodeValue || node.textContent || "");
        return;
      }
      if (node.nodeType !== 1) {
        return;
      }

      const tag = String(node.tagName || "").toLowerCase();
      if (tag === "img") {
        flushText();
        units.push({ type: "image", node });
        return;
      }
      if (tag === "video" || tag === "source" || tag === "svg" || tag === "button" || hasClass(node, "bullet-dot")) {
        return;
      }
      if (hasDescendantImage(node)) {
        for (const child of Array.from(node.childNodes || [])) {
          visit(child);
        }
        return;
      }
      markdown += serializeInline(node);
    }

    for (const child of Array.from((container && container.childNodes) || [])) {
      visit(child);
    }
    flushText();
    return units;
  }

  function directContentUnits(item) {
    const units = [];

    function hasStructuredDescendant(node) {
      return Boolean(
        node &&
          typeof node.querySelector === "function" &&
          node.querySelector(".vc-doc-item,.block-text,.bulletlist,img")
      );
    }

    function visit(node) {
      for (const child of Array.from((node && node.childNodes) || [])) {
        if (!child || child.nodeType !== 1) {
          continue;
        }
        const tag = String(child.tagName || "").toLowerCase();
        if (hasClass(child, "vc-doc-item")) {
          units.push({ type: "item", node: child });
          continue;
        }
        if (tag === "img") {
          units.push({ type: "image", node: child });
          continue;
        }
        if (tag === "video" || tag === "source" || tag === "svg" || tag === "button") {
          continue;
        }
        if (hasClass(child, "block-text") || hasClass(child, "bulletlist")) {
          units.push(...inlineUnits(child));
          continue;
        }
        if (!hasStructuredDescendant(child)) {
          const markdown = normalizeMarkdown(serializeInline(child));
          if (markdown) {
            units.push({ type: "text", markdown });
          }
          continue;
        }
        visit(child);
      }
    }

    visit(item);
    return units;
  }

  function markdownText(markdown) {
    return normalizeText(
      String(markdown || "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/<br>/g, " ")
        .replace(/[*~]/g, "")
    );
  }

  function textBlock(item, markdown, listDepth) {
    const text = markdownText(markdown);
    if (!text) {
      return null;
    }
    if (isListItem(item)) {
      return {
        type: "listItem",
        text,
        markdown,
        ordered: isOrderedListItem(item),
        depth: listDepth
      };
    }
    return { type: "paragraph", text, markdown };
  }

  function rawImageSource(image) {
    return String(
      (image && (image.currentSrc || image.src)) ||
        (image && typeof image.getAttribute === "function" &&
          (image.getAttribute("data-src") || image.getAttribute("src"))) ||
        ""
    ).trim();
  }

  function isBodyImage(image) {
    const source = rawImageSource(image);
    if (!source || /^data:image\//i.test(source) || /^data:image\/svg\+xml/i.test(source)) {
      return false;
    }
    try {
      const url = new URL(source, "https://scys.com/");
      return !/\/images\/docx\/link\.png$/i.test(url.pathname);
    } catch (_error) {
      return true;
    }
  }

  function imageBlock(image, core, state) {
    if (!isBodyImage(image)) {
      return null;
    }
    const extracted = core.extractBlocksFromElement(image).find((block) => block.type === "image");
    if (!extracted) {
      return null;
    }
    state.imageIndex += 1;
    return Object.assign({}, extracted, { sourceId: `scys-article:image:${state.imageIndex}` });
  }

  function quoteMarkdownForBlock(block) {
    if (!block) {
      return "";
    }
    if (block.type === "listItem") {
      const indent = "    ".repeat(Math.max(0, Number(block.depth) || 0));
      return `${indent}${block.ordered ? "1." : "-"} ${block.markdown || block.text}`;
    }
    if (block.type === "heading") {
      return `${"#".repeat(Math.min(Math.max(Number(block.level) || 2, 1), 6))} ${block.text}`;
    }
    return block.markdown || block.text || "";
  }

  function wrapAsQuote(blocks) {
    const result = [];
    let lines = [];

    function flush() {
      const markdown = lines.filter(Boolean).join("\n");
      const text = markdownText(markdown);
      if (markdown && text) {
        result.push({ type: "quote", text, markdown });
      }
      lines = [];
    }

    for (const block of mergeSplitNumberedListItems(blocks)) {
      if (block.type === "image" || block.type === "code" || block.type === "table") {
        flush();
        result.push(block);
      } else {
        const markdown = quoteMarkdownForBlock(block);
        if (markdown) {
          lines.push(markdown);
        }
      }
    }
    flush();
    return result;
  }

  function isNumberMarkerListItem(block) {
    return Boolean(
      block &&
        block.type === "listItem" &&
        /^\d+[.)、]?$/.test(normalizeText(block.markdown || block.text))
    );
  }

  function mergeSplitNumberedListItems(blocks) {
    const merged = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const next = blocks[index + 1];
      if (isNumberMarkerListItem(block) && next && next.type === "listItem" && !isNumberMarkerListItem(next)) {
        merged.push(Object.assign({}, next, {
          ordered: true,
          depth: Math.min(Number(block.depth) || 0, Number(next.depth) || 0)
        }));
        index += 1;
      } else {
        merged.push(block);
      }
    }
    return merged;
  }

  function listItemMarkdown(block) {
    const indent = "    ".repeat(Math.max(0, Number(block.depth) || 0));
    return `${indent}${block.ordered ? "1." : "-"} ${block.markdown || block.text}`;
  }

  function compactAdjacentLists(blocks) {
    const compacted = [];
    let listRun = [];

    function flush() {
      if (listRun.length === 1) {
        compacted.push(listRun[0]);
      } else if (listRun.length > 1) {
        const markdown = listRun.map(listItemMarkdown).join("\n");
        compacted.push({ type: "paragraph", text: markdownText(markdown), markdown });
      }
      listRun = [];
    }

    for (const block of blocks) {
      if (block.type === "listItem") {
        listRun.push(block);
      } else {
        flush();
        compacted.push(block);
      }
    }
    flush();
    return compacted;
  }

  function blocksFromItem(item, core, state, listDepth) {
    const headingLevel = documentHeadingLevel(item);
    if (headingLevel > 0) {
      const text = markdownText(serializeItemText(item));
      return text ? [{ type: "heading", level: headingLevel, text }] : [];
    }

    const structured = extractCodeBlock(item) || extractDivTable(item);
    if (structured) {
      return [structured];
    }

    const units = directContentUnits(item);
    const blocks = [];
    const nestedListDepth = isListItem(item) ? listDepth + 1 : listDepth;
    let hasDirectText = false;

    for (const unit of units) {
      if (unit.type === "text") {
        const block = textBlock(item, unit.markdown, listDepth);
        if (block) {
          hasDirectText = true;
          blocks.push(block);
        }
      } else if (unit.type === "image") {
        const block = imageBlock(unit.node, core, state);
        if (block) {
          blocks.push(block);
        }
      } else if (unit.type === "item") {
        blocks.push(...blocksFromItem(unit.node, core, state, nestedListDepth));
      }
    }

    if (!hasDirectText && units.length === 0) {
      const markdown = serializeItemText(item);
      const block = textBlock(item, markdown, listDepth);
      if (block) {
        blocks.push(block);
      }
    }

    return isQuoteItem(item) || isCalloutItem(item) ? wrapAsQuote(blocks) : blocks;
  }

  function blocksFromPrelude(preludeRoot, core, state) {
    const hasDirectText = Array.from(preludeRoot.childNodes || []).some(
      (node) => node && node.nodeType === 3 && normalizeText(node.textContent || node.nodeValue)
    );
    if (hasDirectText && !(preludeRoot.querySelector && preludeRoot.querySelector("img"))) {
      const blocks = [];
      const groups = normalizeMarkdown(serializeInline(preludeRoot))
        .split(/(?:<br>){2,}/i)
        .map((markdown) => normalizeMarkdown(markdown).replace(/^(?:<br>)+|(?:<br>)+$/gi, ""))
        .filter(Boolean);

      for (const group of groups) {
        for (const line of group.split(/<br>/i).map(normalizeMarkdown).filter(Boolean)) {
          const listMatch = line.match(/^(?:\d+|[一二三四五六七八九十百]+)[、.．]\s*(.+)$/);
          const markdown = listMatch ? listMatch[1] : line;
          const text = markdownText(markdown);
          if (!text) {
            continue;
          }
          blocks.push(
            listMatch
              ? { type: "listItem", text, markdown, ordered: true, depth: 0 }
              : { type: "paragraph", text, markdown }
          );
        }
      }
      return blocks;
    }

    const blocks = [];
    for (const unit of directContentUnits(preludeRoot)) {
      if (unit.type === "text") {
        const text = markdownText(unit.markdown);
        if (text) {
          blocks.push({ type: "paragraph", text, markdown: unit.markdown });
        }
      } else if (unit.type === "image") {
        const block = imageBlock(unit.node, core, state);
        if (block) {
          blocks.push(block);
        }
      } else if (unit.type === "item") {
        blocks.push(...blocksFromItem(unit.node, core, state, 0));
      }
    }
    return blocks;
  }

  function extractBlocks(rootElement, core) {
    const contentRoots = getContentRoots(rootElement);
    if (contentRoots.length === 0 || !core) {
      return [];
    }

    const title = getDocumentTitle(rootElement);
    const blocks = [];
    const state = { imageIndex: 0 };

    for (const preludeRoot of getPreludeRoots(rootElement)) {
      blocks.push(...blocksFromPrelude(preludeRoot, core, state));
    }

    for (const contentRoot of contentRoots) {
      const nodes = Array.from(contentRoot.querySelectorAll("h1,h2,h3,h4,h5,h6,.vc-doc-item"));
      for (const node of nodes) {
        const tag = String(node.tagName || "").toLowerCase();
        if (/^h[1-6]$/.test(tag)) {
          const itemAncestor = typeof node.closest === "function" ? node.closest(".vc-doc-item") : null;
          const text = normalizeText(node.textContent);
          if (!itemAncestor && text && text !== title) {
            blocks.push({ type: "heading", level: Number(tag.slice(1)), text });
          }
          continue;
        }

        if (nearestItemAncestor(node)) {
          continue;
        }
        blocks.push(...blocksFromItem(node, core, state, 0));
      }
    }

    const deduped = core.removeDuplicateBlocks(blocks);
    return compactAdjacentLists(mergeSplitNumberedListItems(deduped));
  }

  function getCollectionPolicy() {
    return {
      mode: "stable-bottom",
      mergeMode: "latest",
      maxStableBottomRounds: 4,
      maxRounds: 400,
      waitMs: 1000
    };
  }

  return {
    supports,
    getArticleRoot,
    getDocumentTitle,
    extractBlocks,
    getCollectionPolicy
  };
});
