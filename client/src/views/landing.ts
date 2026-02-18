import { navigateTo } from '../router.js';
import { isSignedIn, mountSignIn, getClerk } from '../auth.js';

export const landingView = {
  render(container: HTMLElement, _params: Record<string, string>): void {
    if (isSignedIn()) {
      navigateTo('#/dashboard');
      return;
    }

    container.innerHTML = `
      <div class="landing">
        <div class="landing-hero">
          <h1 class="landing-title">CollabBoard</h1>
          <p class="landing-subtitle">Real-time collaborative whiteboard for teams</p>
          <div class="landing-features">
            <div class="feature">
              <span class="feature-icon">&#9998;</span>
              <span>Infinite Canvas</span>
            </div>
            <div class="feature">
              <span class="feature-icon">&#9889;</span>
              <span>Real-Time Sync</span>
            </div>
            <div class="feature">
              <span class="feature-icon">&#128101;</span>
              <span>Multiplayer Cursors</span>
            </div>
          </div>
          <div id="clerk-sign-in"></div>
          <button class="btn btn-primary" id="go-dashboard">Get Started</button>
        </div>
      </div>
    `;

    const signInEl = document.getElementById('clerk-sign-in');
    const clerk = getClerk();
    if (clerk) {
      mountSignIn(signInEl);
      document.getElementById('go-dashboard')!.style.display = 'none';
      clerk.addListener(({ user }: { user?: unknown }) => {
        if (user) navigateTo('#/dashboard');
      });
    } else {
      container.querySelector('#go-dashboard')!.addEventListener('click', () => {
        navigateTo('#/dashboard');
      });
    }
  },
  destroy() {},
};
