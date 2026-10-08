# JUUNIBI

Монорепозиторий (npm workspaces, TypeScript strict).

- `packages/core` — ядро без зависимостей: `Kernel` (плагины, порядок по зависимостям, изоляция сбоев, остановка в обратном порядке), типизированный `EventBus`, иммутабельный `Store` с селекторами, `Result`, `Logger`.
- `apps/web` — веб-версия на Vite: тёмная/светлая тема, a11y, адаптивность, сохранение в localStorage.

```
npm install
npm run dev        # веб в режиме разработки
npm test           # тесты ядра
npm run typecheck
npm run build
```
