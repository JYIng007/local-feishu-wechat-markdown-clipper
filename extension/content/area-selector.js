(function initDomClipperAreaSelector(root) {
  function selectBestArea(documentRef, core, logger) {
    const wechatExtractor = root.DOMClipperWechatExtractor;
    const wechatRoot =
      wechatExtractor && typeof wechatExtractor.getContentRoot === "function"
        ? wechatExtractor.getContentRoot(documentRef)
        : null;
    if (
      wechatRoot &&
      typeof wechatExtractor.supports === "function" &&
      wechatExtractor.supports(wechatRoot)
    ) {
      logger.info("area", "auto selected", { success: true, adapter: "wechat" });
      return wechatRoot;
    }

    const scysExtractor = root.DOMClipperScysExtractor;
    const documentRoot = documentRef && (documentRef.documentElement || documentRef.body);
    const scysRoot =
      scysExtractor && typeof scysExtractor.getCourseRoot === "function"
        ? scysExtractor.getCourseRoot(documentRoot)
        : null;
    if (
      scysRoot &&
      typeof scysExtractor.supports === "function" &&
      scysExtractor.supports(scysRoot)
    ) {
      logger.info("area", "auto selected", { success: true, adapter: "scys" });
      return scysRoot;
    }

    const best = core.findBestContentElement(documentRef);

    if (best) {
      logger.info("area", "auto selected", { success: true });
      return best;
    }

    logger.warn("area", "auto selected", { success: false });
    return null;
  }

  root.DOMClipperAreaSelector = {
    selectBestArea
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
