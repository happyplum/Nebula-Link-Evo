import Navigo from 'navigo';

const router = new Navigo('/', { hash: true });

router.on('/chat', () => {
  // Will be wired in main.ts
});

declare global {
  interface Window {
    router?: typeof router;
  }
}

export { router };
