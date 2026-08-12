const path = require("node:path");
const { config: loadEnvFile } = require("dotenv");

const rootEnvDir = path.resolve(__dirname, "../..");

for (const candidate of [path.join(rootEnvDir, ".env.local"), path.join(rootEnvDir, ".env")]) {
  loadEnvFile({ path: candidate, override: false });
}

const convexUrl =
  process.env.EXPO_PUBLIC_CONVEX_URL ??
  process.env.VITE_CONVEX_URL ??
  process.env.CONVEX_URL ??
  null;

if (convexUrl !== null) {
  process.env.EXPO_PUBLIC_CONVEX_URL = convexUrl;
}

const siteUrl = process.env.SITE_URL ?? null;
const passkeyDomain = siteUrl ? new URL(siteUrl).hostname : null;

module.exports = {
  expo: {
    name: "demo-expo",
    slug: "demo-expo",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "demoexpo",
    userInterfaceStyle: "automatic",
    ios: {
      supportsTablet: true,
      ...(passkeyDomain ? { associatedDomains: [`webcredentials:${passkeyDomain}`] } : {}),
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      ...(passkeyDomain
        ? {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: true,
                data: [{ scheme: "https", host: passkeyDomain }],
                category: ["BROWSABLE", "DEFAULT"],
              },
            ],
          }
        : {}),
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain",
          backgroundColor: "#ffffff",
          dark: {
            backgroundColor: "#000000",
          },
        },
      ],
      "expo-secure-store",
      "expo-web-browser",
    ],
    experiments: {
      autolinkingModuleResolution: true,
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: {
        origin: false,
      },
      convexUrl,
    },
  },
};
