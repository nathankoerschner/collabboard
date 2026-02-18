import { landingView } from './views/landing.js';
import { dashboardView } from './views/dashboard.js';
import { boardView } from './views/board.js';
import { isSignedIn } from './auth.js';

interface View {
  render(container: HTMLElement, params: Record<string, string>): void;
  destroy(): void;
}

interface Route {
  pattern: RegExp;
  view: View;
  params: (m: RegExpMatchArray) => Record<string, string>;
  requiresAuth?: boolean;
}

const routes: Route[] = [
  { pattern: /^#\/board\/(.+)$/, view: boardView, params: m => ({ boardId: m[1]! }), requiresAuth: true },
  { pattern: /^#\/dashboard$/, view: dashboardView, params: () => ({}), requiresAuth: true },
  { pattern: /.*/, view: landingView, params: () => ({}) },
];

let currentView: View | null = null;
let container: HTMLElement | null = null;

function resolve(): { view: View; params: Record<string, string> } {
  const hash = location.hash || '#/';
  for (const route of routes) {
    const match = hash.match(route.pattern);
    if (match) {
      if (route.requiresAuth && !isSignedIn()) {
        return { view: landingView, params: {} };
      }
      return { view: route.view, params: route.params(match) };
    }
  }
  return { view: landingView, params: {} };
}

function navigate(): void {
  if (currentView?.destroy) {
    currentView.destroy();
  }
  const { view, params } = resolve();
  currentView = view;
  container!.innerHTML = '';
  view.render(container!, params);
}

export const router = {
  start(el: HTMLElement): void {
    container = el;
    window.addEventListener('hashchange', navigate);
    navigate();
  },
};

export function navigateTo(path: string): void {
  location.hash = path;
}
