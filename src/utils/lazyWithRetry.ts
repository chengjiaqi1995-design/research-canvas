import { lazy, type ComponentType } from 'react';

/**
 * Wraps React.lazy with an automatic page reload if the chunk fails to load.
 * This resolves the "Failed to fetch dynamically imported module" error
 * when a new version of the app is deployed while the user has the SPA open.
 */
export const lazyWithRetry = <T extends ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>,
  name?: string // Optional identifier for session storage
) =>
  lazy(async () => {
    const key = `lazy-retry-${name || Math.random().toString(36).slice(2)}`;
    const pageHasAlreadyBeenForceRefreshed = JSON.parse(
      window.sessionStorage.getItem(key) || 'false'
    );

    try {
      const component = await componentImport();
      window.sessionStorage.setItem(key, 'false');
      return component;
    } catch (error) {
      if (!pageHasAlreadyBeenForceRefreshed) {
        // Assume failure is due to a new deployment replacing old chunk hashes.
        // Refresh the page to fetch the new index.html and fresh chunk names.
        window.sessionStorage.setItem(key, 'true');
        window.location.reload();
        // Return a promise that never resolves so it doesn't render an error boundary while reloading
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
