import { navigateTo } from '../router.js';
import { isSignedIn, mountSignIn, getClerk } from '../auth.js';
import type { View } from '../router.js';

export const landingView: View = {
  render(container) {
    // If already signed in, go to dashboard
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

    // Mount Clerk sign-in if available
    const signInEl = document.getElementById('clerk-sign-in');
    const clerk = getClerk();
    if (clerk) {
      mountSignIn(signInEl);
      // Hide the simple button if Clerk is active
      document.getElementById('go-dashboard')!.style.display = 'none';
      // Watch for sign-in completion
      clerk.addListener((emission) => {
        if (emission.user) navigateTo('#/dashboard');
      });
    } else {
      // No Clerk = just use the button
      container.querySelector('#go-dashboard')!.addEventListener('click', () => {
        navigateTo('#/dashboard');
      });
    }
  },
  destroy() {},
};
