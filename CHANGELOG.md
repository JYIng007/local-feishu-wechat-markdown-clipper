# Changelog

All notable public changes to this project are documented here.

## [Unreleased]

### Fixed

- Fixed incomplete collection on very long dynamically loaded pages.

## [0.3.0] - 2026-07-22

### Added

- Dedicated WeChat public-article adapter for `#js_content` on `mp.weixin.qq.com` pages.
- GFM-compatible conversion through bundled Turndown and turndown-plugin-gfm libraries with included MIT license notices.
- WeChat snapshot diagnostics for source/export character counts, approximate coverage, images, code blocks, and tables.

### Changed

- WeChat collection now waits for a stable bottom and exports the final complete snapshot instead of merging whole-article intermediate snapshots.
- Hidden duplicate nodes, page decoration, lazy-image attributes, code snippets, and equivalent WeChat image URL variants receive dedicated handling without changing Feishu, SCYS, or generic extraction routes.
- Nested WeChat table cells now produce valid GFM rows instead of split vertical bars and cell text.
- Decorative break tags and empty formatting are removed; lists, horizontal rules, and adjacent bold spans use consistent Markdown without changing fenced code contents.
- Project directory trees with `├──` and `└──` branches are grouped into one fenced `text` block with their indentation and comments preserved.

## [0.2.0] - 2026-07-22

### Added

- Initial public source release of the local Chrome extension.
- Markdown and localized-image ZIP export.
- Dedicated Feishu document extraction.
- Dedicated SCYS course and article-detail extraction.
- Generic readable-page and WeChat public article collection.
- Top-first automatic collection, manual area fallback, recollection, early finish, persistent panel state, and copyable runtime logs.
