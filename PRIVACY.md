# Privacy Policy

Last updated: 2026-07-22

Local Markdown Clipper for Feishu & WeChat is designed to process content locally in the user's browser.

## Data Processing

- The extension reads the active page only after the user clicks the extension and starts collection.
- Readable page content is converted to Markdown in the browser.
- Image requests are made to the source page's image addresses when image localization is requested.
- Generated Markdown and images are packaged locally and sent to the browser download manager.

## Data Collection

The extension does not include analytics, advertising, telemetry, an account system, or a project-operated server. It does not intentionally collect or transmit page content, browsing history, cookies, credentials, exported files, or runtime logs to the project maintainers.

The extension may include existing browser credentials in requests to the same Feishu site when required to download an image the current user can already view. Credentials are handled by the browser and are not written into the exported ZIP or runtime log.

## User Control

Collection begins only through an explicit user action. Output is saved only when the user chooses to download a ZIP. Removing the unpacked extension stops all extension functionality.

Users should review exported Markdown and logs before sharing them because they may contain source URLs, page titles, or content from the collected page.

## Permission Scope

The extension requests access to web URLs so that it can operate on user-selected pages and retrieve their images. It does not use this permission to crawl pages in the background or bypass login and reading permissions.
