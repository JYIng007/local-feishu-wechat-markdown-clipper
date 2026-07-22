(function initDomClipperAreaSelector(root) {
  function selectBestArea(documentRef, core, logger) {
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
