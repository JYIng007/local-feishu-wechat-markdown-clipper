(function initDomClipperCollector(root) {
  function wait(ms) {
    return new Promise((resolve) => root.setTimeout(resolve, ms));
  }

  function getScrollTop(target) {
    return target === root ? root.scrollY || 0 : target.scrollTop || 0;
  }

  function getMaxScrollTop(target) {
    if (target === root) {
      const documentRef = root.document || {};
      const scrollingElement = documentRef.scrollingElement || documentRef.documentElement || {};
      return Math.max(0, (scrollingElement.scrollHeight || 0) - (root.innerHeight || scrollingElement.clientHeight || 0));
    }

    return Math.max(0, (target.scrollHeight || 0) - (target.clientHeight || root.innerHeight || 0));
  }

  function scrollByStep(target) {
    const height = target === root ? root.innerHeight : target.clientHeight || root.innerHeight;
    const step = Math.max(240, Math.floor((height || 0) * 0.75));
    const before = getScrollTop(target);
    const next = Math.min(before + step, getMaxScrollTop(target));

    if (target === root) {
      if (typeof root.scrollTo === "function") {
        root.scrollTo(root.scrollX || 0, next);
      } else if (typeof root.scrollBy === "function") {
        root.scrollBy(0, next - before);
      }
    } else {
      target.scrollTop = next;
    }

    return getScrollTop(target) !== before;
  }

  function scrollToTop(target) {
    const before = getScrollTop(target);
    if (before <= 0) {
      return false;
    }

    if (target === root) {
      if (typeof root.scrollTo === "function") {
        root.scrollTo(root.scrollX || 0, 0);
      } else if (typeof root.scrollBy === "function") {
        root.scrollBy(0, -before);
      }
    } else {
      target.scrollTop = 0;
    }

    return getScrollTop(target) !== before;
  }

  function getScrollTarget(element, core, extractor) {
    const documentRef = (element && element.ownerDocument) || root.document || {};
    const adapterTarget =
      extractor && typeof extractor.getScrollTarget === "function"
        ? extractor.getScrollTarget()
        : null;
    return (
      adapterTarget ||
      core.findScrollableContainer(element) ||
      documentRef.scrollingElement ||
      documentRef.documentElement ||
      root
    );
  }

  function countBlocks(blocks, type) {
    return blocks.filter((block) => block && block.type === type).length;
  }

  function serializeBlocks(blocks) {
    try {
      return JSON.stringify(blocks || []);
    } catch (_error) {
      return String((blocks || []).length);
    }
  }

  function resolveExtractor(element, core, logger) {
    const adapters = [
      { name: "wechat", api: root.DOMClipperWechatExtractor },
      { name: "scys-article", api: root.DOMClipperScysArticleExtractor },
      { name: "scys", api: root.DOMClipperScysExtractor },
      { name: "feishu", api: root.DOMClipperFeishuExtractor }
    ];

    for (const adapter of adapters) {
      const api = adapter.api;
      if (
        api &&
        typeof api.supports === "function" &&
        typeof api.extractBlocks === "function" &&
        api.supports(element)
      ) {
        return {
          name: adapter.name,
          policy:
            typeof api.getCollectionPolicy === "function"
              ? api.getCollectionPolicy(element) || null
              : null,
          extractBlocks() {
            return api.extractBlocks(element, core, logger);
          },
          getScrollTarget() {
            return typeof api.getScrollTarget === "function"
              ? api.getScrollTarget(element, core)
              : null;
          }
        };
      }
    }

    return {
      name: "generic",
      policy: { mergeMode: "ordered" },
      extractBlocks() {
        return core.extractBlocksFromElement(element);
      },
      getScrollTarget() {
        return null;
      }
    };
  }

  async function collectFromElement(element, options) {
    const core = options.core;
    const logger = options.logger;
    const fragments = [];
    const maxIdleRounds = Number.isFinite(options.maxIdleRounds) ? options.maxIdleRounds : 4;
    const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : 900;
    const extractor = resolveExtractor(element, core, logger);
    const target = getScrollTarget(element, core, extractor);
    const stableBottomPolicy = extractor.policy && extractor.policy.mode === "stable-bottom"
      ? extractor.policy
      : null;
    const strictStability = Boolean(stableBottomPolicy && stableBottomPolicy.strictStability);
    const useLatestSnapshot = extractor.policy && extractor.policy.mergeMode === "latest";
    const useOrderedSnapshots = Boolean(
      extractor.policy &&
        extractor.policy.mergeMode === "ordered" &&
        typeof core.mergeOrderedSnapshots === "function"
    );
    const effectiveWaitMs = Number.isFinite(options.waitMs)
      ? options.waitMs
      : stableBottomPolicy && Number.isFinite(stableBottomPolicy.waitMs)
        ? stableBottomPolicy.waitMs
        : waitMs;
    const maxStableBottomRounds = stableBottomPolicy && Number.isFinite(stableBottomPolicy.maxStableBottomRounds)
      ? stableBottomPolicy.maxStableBottomRounds
      : maxIdleRounds;
    const maxRounds = stableBottomPolicy && Number.isFinite(stableBottomPolicy.maxRounds)
      ? stableBottomPolicy.maxRounds
      : Number.POSITIVE_INFINITY;
    let idleRounds = 0;
    let previousCount = 0;
    let previousSnapshot = null;
    let previousMaxScrollTop = getMaxScrollTop(target);
    let round = 0;
    let orderedResult = { blocks: [] };
    let orderedInputCount = 0;

    logger.info("extract", "adapter", { name: extractor.name });
    const startingScrollTop = getScrollTop(target);
    const movedToTop = scrollToTop(target);
    logger.info("scroll", "start", {
      movedToTop,
      previousScrollTop: Math.round(startingScrollTop),
      scrollTop: Math.round(getScrollTop(target))
    });
    if (movedToTop) {
      await wait(effectiveWaitMs);
      previousMaxScrollTop = getMaxScrollTop(target);
    }

    while (
      !options.shouldStop() &&
      idleRounds < (stableBottomPolicy ? maxStableBottomRounds : maxIdleRounds) &&
      round < maxRounds
    ) {
      round += 1;
      const blocks = extractor.extractBlocks();
      let merged;
      let beforeCount;
      if (useLatestSnapshot) {
        fragments.splice(0, fragments.length, { blocks });
        merged = core.mergeFragments(fragments);
        beforeCount = blocks.length;
      } else if (useOrderedSnapshots) {
        orderedInputCount += blocks.length;
        orderedResult = core.mergeOrderedSnapshots(orderedResult.blocks, blocks);
        merged = orderedResult;
        beforeCount = orderedInputCount;
      } else {
        fragments.push({ blocks });
        merged = core.mergeFragments(fragments);
        beforeCount = fragments.reduce((total, fragment) => total + fragment.blocks.length, 0);
      }
      const afterCount = merged.blocks.length;
      const paragraphCount = countBlocks(blocks, "paragraph");
      const imageCount = countBlocks(merged.blocks, "image");
      const linkCount = countBlocks(merged.blocks, "link");
      const removedCount = Math.max(0, beforeCount - afterCount);
      const snapshot = strictStability ? serializeBlocks(blocks) : null;
      const snapshotChanged = strictStability && snapshot !== previousSnapshot;

      const blockCountChanged = afterCount !== previousCount;
      const contentChanged = blockCountChanged || snapshotChanged;
      if (contentChanged) {
        idleRounds = 0;
        previousCount = afterCount;
      }
      if (strictStability) {
        previousSnapshot = snapshot;
      }

      const moved = scrollByStep(target);
      const scrollTop = getScrollTop(target);
      const maxScrollTop = getMaxScrollTop(target);
      const atBottom = maxScrollTop - scrollTop <= 2;

      if (stableBottomPolicy) {
        const heightChanged = Math.abs(maxScrollTop - previousMaxScrollTop) > 2;
        if (maxScrollTop > previousMaxScrollTop + 2) {
          logger.info("scroll", "content expanded", {
            previousMaxScrollTop: Math.round(previousMaxScrollTop),
            maxScrollTop: Math.round(maxScrollTop),
            blocks: previousCount
          });
        }
        previousMaxScrollTop = maxScrollTop;
        if (strictStability && (contentChanged || heightChanged || !atBottom)) {
          idleRounds = 0;
        } else if (!contentChanged && atBottom) {
          idleRounds += 1;
        } else if (!atBottom) {
          idleRounds = 0;
        }
        const scrollDetails = {
          moved,
          blocks: previousCount,
          stableBottomRounds: idleRounds,
          scrollTop: Math.round(scrollTop),
          maxScrollTop: Math.round(maxScrollTop)
        };
        if (strictStability) {
          scrollDetails.snapshotChanged = snapshotChanged;
          scrollDetails.heightChanged = heightChanged;
        }
        logger.info("scroll", `round=${round}`, scrollDetails);
      } else {
        if (!contentChanged) {
          idleRounds += 1;
        }
        logger.info("scroll", `round=${round}`, {
          moved,
          blocks: previousCount,
          idleRounds
        });
      }
      logger.info("extract", "summary", {
        paragraphs: paragraphCount,
        images: imageCount,
        links: linkCount,
        blocks: blocks.length
      });
      logger.info("dedupe", "summary", {
        before: beforeCount,
        after: afterCount,
        removed: removedCount
      });

      if (typeof options.onProgress === "function") {
        const progress = {
          round,
          moved,
          blocks: previousCount,
          paragraphs: paragraphCount,
          images: imageCount,
          links: linkCount,
          idleRounds
        };
        if (stableBottomPolicy) {
          progress.stableBottomRounds = idleRounds;
          if (strictStability) {
            progress.snapshotChanged = snapshotChanged;
          }
        }
        options.onProgress(progress);
      }

      if (!stableBottomPolicy && !moved) {
        logger.info("scroll", "stopped", { reason: "bottom", blocks: previousCount });
        break;
      }

      await wait(effectiveWaitMs);
    }

    if (options.shouldStop()) {
      logger.info("scroll", "stopped", { reason: "stop", blocks: previousCount });
    } else if (stableBottomPolicy && idleRounds >= maxStableBottomRounds) {
      logger.info("scroll", "stopped", {
        reason: "stable-bottom",
        blocks: previousCount,
        stableBottomRounds: idleRounds
      });
    } else if (stableBottomPolicy && round >= maxRounds) {
      logger.warn("scroll", "stopped", { reason: "round-limit", blocks: previousCount, rounds: round });
    } else if (idleRounds >= maxIdleRounds) {
      logger.info("scroll", "stopped", { reason: "idle", blocks: previousCount, idleRounds });
    }

    return useOrderedSnapshots ? orderedResult : core.mergeFragments(fragments);
  }

  root.DOMClipperCollector = {
    collectFromElement,
    scrollByStep,
    scrollToTop,
    wait
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
