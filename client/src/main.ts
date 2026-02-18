import { initAuth } from './auth.js';
import { setTokenProvider } from './api.js';
import { getToken } from './auth.js';
import { router } from './router.js';

async function boot(): Promise<void> {
  await initAuth();
  setTokenProvider(getToken);
  const app = document.getElementById('app')!;
  router.start(app);
}

boot();
