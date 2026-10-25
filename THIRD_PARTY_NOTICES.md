# Third-party notices and acknowledgements

Original project author and maintainer: **Yidi Sprei ([YidiDev](https://github.com/YidiDev))**.
Copyright © 2026 Yidi Sprei for original copyrightable project material owned by the author.
The project is distributed under the [MIT license](LICENSE). This notice does not transfer
copyright in third-party software or future unassigned contributions.

## Runtime requirements and platform

This archive contains the project's own TypeScript and documentation, not bundled copies of
these libraries. Package managers obtain external libraries with their original license files.
Their copyright and license notices must be retained if they are redistributed or bundled.

| Project                   | Use                                                                 | License | Upstream                              |
| ------------------------- | ------------------------------------------------------------------- | ------- | ------------------------------------- |
| Zod                       | Configuration/state validation and schema generation                | MIT     | https://github.com/colinhacks/zod     |
| Solid                     | Reactive lifecycle integration                                      | MIT     | https://github.com/solidjs/solid      |
| Seroval / Seroval plugins | External transitive dependencies of Solid                           | MIT     | https://github.com/lxsmnsyc/seroval   |
| OpenCode                  | Host platform and public plugin API; SDK used for development types | MIT     | https://github.com/anomalyco/opencode |
| OpenTUI                   | Host-owned terminal UI; not imported or bundled by this plugin      | MIT     | https://github.com/anomalyco/opentui  |

The tested dependency inventory attached to releases records resolved versions and declared
licenses from the clean consumer installation. It describes that tested graph, not every future
resolution permitted by dependency ranges. Upstream packages remain subject to their own terms.

Solid's external CSSType type dependency is MIT-licensed: https://github.com/frenic/csstype.

## Inspiration, not a fork

The independent [Tab Wrangler browser extension](https://github.com/tabwrangler/tabwrangler)
inspired the tab-housekeeping workflow. Its source is licensed GPL-3.0. No browser-extension
source, assets, or license text is incorporated into this package. Inspiration is not a claim
of authorship or endorsement. Any future source reuse must receive a separate license review.

This project is not an official OpenCode, OpenTUI, Solid, Zod, Google, or Tab Wrangler release.
Project names and marks belong to their respective holders.

## Development tooling

Development uses OpenCode and AI-assisted coding, Bun (MIT), TypeScript (Apache-2.0), ESLint
(MIT), typescript-eslint (MIT), Prettier (MIT), Python (PSF-2.0), Ruff (MIT), GitHub Actions,
npm (Artistic-2.0), actionlint (MIT), and Gitleaks (MIT). These are acknowledgements of tools used, not claims
that their source is distributed in this archive or that their authors endorse this project.
AI assistance does not replace the project's stated human author/maintainer attribution.
