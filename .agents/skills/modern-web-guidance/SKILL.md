---
name: modern-web-guidance
description: Web platform defaults for UI work - semantic accessible HTML, modern CSS layout, Core Web Vitals budgets, and when to reach for the deeper React/Vercel skills.
---
# Modern Web Guidance

- **HTML and accessibility**: native elements first (`button`, `a`, `dialog`, `label`). Every control is keyboard reachable with a visible focus ring and an accessible name. Text contrast meets WCAG AA (4.5:1).
- **CSS**: layout with Grid/Flexbox and `gap`; responsive with container queries where a component, not the page, decides; `:has()` instead of JS for parent state. Use the design tokens in `src/styles/` rather than raw colors. Respect `prefers-reduced-motion` and `prefers-color-scheme`.
- **Performance budgets**: LCP < 2.5s, INP < 200ms, CLS < 0.1. Size images, lazy-load below the fold, avoid layout shifts from late content, and keep long work off the main thread.
- **State and rendering**: derive values instead of storing them; keep state at the lowest component that needs it.
- **Go deeper**: React performance → `react-best-practices`; component APIs → `composition-patterns`; animations between states → `react-view-transitions`; accessibility/UX review → `web-design-guidelines`.
