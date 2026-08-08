declare global {
  namespace App {
    interface PageData {
      convexUrl: string | undefined;
      authProviders: {
        google: boolean;
      };
    }
  }
}

export {};
