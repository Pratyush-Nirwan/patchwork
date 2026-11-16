# @patchwork/website Agent Rules

1. **Package boundary**: Never import, require, or read files outside `website/`. Read app metadata, commands, settings, env vars, permissions, schema, shortcuts, installer flags, and `CHANGELOG.md` only from `src/data/generated/`.
2. **Self-hosted assets**: Never load third-party fonts, scripts, images, or trackers at runtime. Use self-hosted WOFF2 fonts (`@fontsource/*`) and committed assets in `src/assets/` and `public/`.
3. **Honesty**: Document and market only verified features in `src/data/features.yaml` and `src/data/generated/`. Planned work belongs only in `src/data/roadmap.yaml` (`Planned for v1.0.0`).
4. **Motion & Accessibility**: Animate only `transform` and `opacity`, respect `prefers-reduced-motion`, keep contrast WCAG 2.2 AA, and support `320px` to `1920px+` without horizontal overflow.
5. **Cross-platform**: All scripts in `website/scripts/` must be Node.js (`.mjs`), shell-agnostic, and pass on Windows and Linux.
