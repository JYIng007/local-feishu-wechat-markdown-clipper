(function initDomClipperScysExtractor(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.DOMClipperScysExtractor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createScysExtractor() {
  const invisibleCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

  function stripInvisible(value) {
    return String(value || "").replace(invisibleCharacters, "");
  }

  function normalizeText(value) {
    return stripInvisible(value).replace(/\s+/g, " ").trim();
  }

  function classNames(element) {
    return String((element && element.className) || "").split(/\s+/).filter(Boolean);
  }

  function hasClass(element, name) {
    return classNames(element).includes(name);
  }

  function isScysCourseUrl(value) {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
      const isScysHost = hostname === "scys.com" || hostname.endsWith(".scys.com");
      return Boolean(
        isScysHost &&
          (/^\/deepsea\/[^/]+\/course\/[^/]+\/?$/i.test(url.pathname) ||
            /^\/course\/detail\/[^/]+\/?$/i.test(url.pathname))
      );
    } catch (_error) {
      return false;
    }
  }

  function hasCourseContent(element) {
    return Boolean(
      element &&
        typeof element.querySelector === "function" &&
        element.querySelector(".feishu-doc-content") &&
        element.querySelector(".vc-doc-item")
    );
  }

  function getCourseRoot(rootElement) {
    if (!rootElement) {
      return null;
    }

    if (
      (String(rootElement.tagName || "").toLowerCase() === "main" || hasClass(rootElement, "vc-course-content")) &&
      hasCourseContent(rootElement)
    ) {
      return rootElement;
    }

    if (typeof rootElement.closest === "function") {
      const courseRoot = rootElement.closest("main,.vc-course-content");
      if (hasCourseContent(courseRoot)) {
        return courseRoot;
      }
    }

    if (typeof rootElement.querySelector === "function") {
      const courseRoot = rootElement.querySelector("main,.vc-course-content");
      if (hasCourseContent(courseRoot)) {
        return courseRoot;
      }
    }

    return null;
  }

  function supports(rootElement) {
    const courseRoot = getCourseRoot(rootElement);
    const baseUrl =
      (rootElement && rootElement.ownerDocument && rootElement.ownerDocument.baseURI) ||
      (courseRoot && courseRoot.ownerDocument && courseRoot.ownerDocument.baseURI) ||
      "";
    return Boolean(courseRoot && isScysCourseUrl(baseUrl));
  }

  function getDocumentTitle(rootElement) {
    const courseRoot = getCourseRoot(rootElement) || rootElement;
    if (!courseRoot || typeof courseRoot.querySelector !== "function") {
      return "";
    }
    const heading = courseRoot.querySelector("h1");
    return normalizeText(heading && heading.textContent);
  }

  function getScrollTarget(rootElement) {
    const courseRoot = getCourseRoot(rootElement);
    if (!courseRoot) {
      return null;
    }

    if (hasClass(courseRoot, "vc-course-content") && typeof courseRoot.closest === "function") {
      return courseRoot.closest(".course-scroll-container") || courseRoot;
    }

    return courseRoot;
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

  function directTextZones(item) {
    if (!item || typeof item.querySelectorAll !== "function") {
      return [];
    }
    return Array.from(item.querySelectorAll(".block-text")).filter((zone) => {
      if (typeof zone.closest !== "function") {
        return true;
      }
      return zone.closest(".vc-doc-item") === item;
    });
  }

  function directDescendant(item, selector) {
    if (!item || typeof item.querySelectorAll !== "function") {
      return null;
    }
    return Array.from(item.querySelectorAll(selector)).find((node) => {
      return typeof node.closest !== "function" || node.closest(".vc-doc-item") === item;
    }) || null;
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

  function directNestedItems(item) {
    if (!item || typeof item.querySelectorAll !== "function") {
      return [];
    }
    return Array.from(item.querySelectorAll(".vc-doc-item")).filter(
      (nested) => nearestItemAncestor(nested) === item
    );
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

  function isCourseChromeNode(node) {
    let current = node;
    while (current) {
      if (hasClass(current, "course-complete") || hasClass(current, "next-chapter-card")) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function serializeItemMarkdown(item) {
    const bulletText = directDescendant(item, ".bulletlist");
    if (bulletText) {
      return normalizeMarkdown(serializeInline(bulletText));
    }

    const nestedItems = directNestedItems(item);
    if (nestedItems.length > 0) {
      return nestedItems
        .map((nested) => serializeItemMarkdown(nested))
        .filter(Boolean)
        .join("<br>");
    }

    const zones = directTextZones(item);
    if (zones.length > 0) {
      return zones.map((zone) => normalizeMarkdown(serializeInline(zone))).filter(Boolean).join("<br>");
    }

    return normalizeMarkdown(serializeInline(item));
  }

  function isListItem(item) {
    return Boolean(
      item &&
        (directDescendant(item, ".bullet_container") ||
          directDescendant(item, ".bullet-dot") ||
          directDescendant(item, ".bulletlist"))
    );
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

  function serializeTableCell(cell) {
    const items = directItemsInContainer(cell);
    if (items.length > 0) {
      return items
        .map((item) => serializeItemMarkdown(item))
        .filter(Boolean)
        .join("<br>");
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
    if (!source || /^data:image\//i.test(source)) {
      return false;
    }
    try {
      const url = new URL(source, "https://scys.com/");
      return !/\/images\/docx\/link\.png$/i.test(url.pathname);
    } catch (_error) {
      return true;
    }
  }

  function imageBlocksFromItem(item, core, sourcePrefix, directOnly) {
    if (!item || typeof item.querySelectorAll !== "function") {
      return [];
    }

    const blocks = [];
    const images = Array.from(item.querySelectorAll("img")).filter((image) => {
      const belongsToItem = !directOnly ||
        typeof image.closest !== "function" ||
        image.closest(".vc-doc-item") === item;
      return belongsToItem && isBodyImage(image);
    });
    for (let index = 0; index < images.length; index += 1) {
      const extracted = core.extractBlocksFromElement(images[index]).find((block) => block.type === "image");
      if (extracted) {
        blocks.push(Object.assign({}, extracted, { sourceId: `${sourcePrefix}:image:${index}` }));
      }
    }
    return blocks;
  }

  function videoBlockFromItem(item, sourcePrefix, directOnly) {
    if (!item || typeof item.querySelectorAll !== "function") {
      return null;
    }

    const container = Array.from(item.querySelectorAll(".block-file.video")).find((candidate) => {
      const ownerItem = typeof candidate.closest === "function"
        ? candidate.closest(".vc-doc-item")
        : item;
      return ownerItem === item || (!directOnly && nearestItemAncestor(ownerItem) === item);
    });
    if (!container || typeof container.querySelector !== "function") {
      return null;
    }

    const video = container.querySelector("video.video-preview");
    const containerItem = typeof container.closest === "function"
      ? container.closest(".vc-doc-item")
      : item;
    if (!video || (typeof video.closest === "function" && video.closest(".vc-doc-item") !== containerItem)) {
      return null;
    }

    const source = String(
      video.currentSrc ||
        video.src ||
        (typeof video.getAttribute === "function" && video.getAttribute("src")) ||
        ""
    ).trim();
    const baseUrl = (item.ownerDocument && item.ownerDocument.baseURI) || "";
    let url;
    try {
      url = new URL(source, baseUrl);
    } catch (_error) {
      return null;
    }
    if (url.protocol !== "https:") {
      return null;
    }

    const titleNode = container.querySelector(".title span") || container.querySelector(".title");
    return {
      type: "video",
      src: url.href,
      text: normalizeText(titleNode && titleNode.textContent) || "Video",
      sourceId: `${sourcePrefix}:video:0`
    };
  }

  function documentHeadingLevel(item) {
    const headingClass = classNames(item).find((name) => /^doc-heading-[1-9]$/.test(name));
    if (!headingClass) {
      return 0;
    }
    return Math.min(Number(headingClass.slice("doc-heading-".length)) || 0, 6);
  }

  function blockFromItem(item, core, sourcePrefix, listDepth, directImagesOnly) {
    const images = imageBlocksFromItem(item, core, sourcePrefix, directImagesOnly);
    const video = videoBlockFromItem(item, sourcePrefix, directImagesOnly);
    const blocks = [];
    const listItem = isListItem(item);
    const structuredBlock = listItem ? null : extractCodeBlock(item) || extractDivTable(item);
    const headingLevel = documentHeadingLevel(item);

    if (video) {
      blocks.push(video);
    } else if (headingLevel) {
      const text = normalizeText(serializeItemMarkdown(item));
      if (text) {
        blocks.push({ type: "heading", level: headingLevel, text });
      }
    } else if (structuredBlock) {
      blocks.push(structuredBlock);
    } else {
      const markdown = serializeItemMarkdown(item);
      const text = normalizeText(markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<br>/g, " ").replace(/[*~]/g, ""));

      if (markdown && text) {
        if (listItem) {
          blocks.push({ type: "listItem", text, markdown, ordered: isOrderedListItem(item), depth: listDepth });
        } else if (isQuoteItem(item) || isCalloutItem(item)) {
          const quote = { type: "quote", text, markdown: markdown.replace(/<br>/g, "\n") };
          if (listDepth > 0) {
            quote.depth = listDepth;
          }
          blocks.push(quote);
        } else {
          blocks.push({ type: "paragraph", text, markdown });
        }
      }
    }

    blocks.push(...images);
    return blocks;
  }

  function blocksFromItemTree(item, core, itemIndex, listDepth, path) {
    const nestedItems = directNestedItems(item);
    const recurseIntoChildren = isListItem(item) && nestedItems.length > 0;
    const suffix = path.length > 0 ? `:nested:${path.join(".")}` : "";
    const blocks = blockFromItem(
      item,
      core,
      `scys:${itemIndex}${suffix}`,
      listDepth,
      recurseIntoChildren
    );

    if (!recurseIntoChildren) {
      return blocks;
    }

    for (let index = 0; index < nestedItems.length; index += 1) {
      blocks.push(...blocksFromItemTree(nestedItems[index], core, itemIndex, listDepth + 1, path.concat(index)));
    }
    return blocks;
  }

  function extractBlocks(rootElement, core) {
    const courseRoot = getCourseRoot(rootElement);
    if (!courseRoot || !core || typeof courseRoot.querySelectorAll !== "function") {
      return [];
    }

    const sections = Array.from(courseRoot.querySelectorAll(".level2-section"));
    const scopes = sections.length > 0 ? sections : [courseRoot];
    const nodes = scopes.flatMap((scope) =>
      Array.from(scope.querySelectorAll("h2,h3,h4,h5,h6,.vc-doc-item"))
    );
    const blocks = [];
    let itemIndex = 0;

    for (const node of nodes) {
      if (isCourseChromeNode(node)) {
        continue;
      }

      const tag = String(node.tagName || "").toLowerCase();
      if (/^h[2-6]$/.test(tag)) {
        const itemAncestor = typeof node.closest === "function" ? node.closest(".vc-doc-item") : null;
        if (!itemAncestor) {
          const text = normalizeText(node.textContent);
          if (text) {
            blocks.push({ type: "heading", level: Number(tag.slice(1)), text });
          }
        }
        continue;
      }

      if (nearestItemAncestor(node)) {
        continue;
      }

      itemIndex += 1;
      blocks.push(...blocksFromItemTree(node, core, itemIndex, 0, []));
    }

    return core.removeDuplicateBlocks(blocks);
  }

  function getCollectionPolicy() {
    return {
      mode: "stable-bottom",
      mergeMode: "ordered",
      maxStableBottomRounds: 10,
      strictStability: true,
      waitMs: 1000
    };
  }

  return {
    supports,
    getCourseRoot,
    getDocumentTitle,
    getScrollTarget,
    extractBlocks,
    getCollectionPolicy
  };
});
