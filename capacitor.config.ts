import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.nora.app',
  appName: 'Nora',
  // Points to the Vite renderer output (same build used by Electron)
  webDir: 'out/renderer-mobile',
  bundledWebRuntime: false,
  server: {
    // Use the live dev server in development (remove for production)
    // url: 'http://192.168.x.x:5173',
    cleartext: false,
  },
  ios: {
    // Minimum iOS version
    deploymentTarget: '16.0',
    backgroundColor: '#ffffff',
    contentInset: 'always',
    preferredContentMode: 'mobile',
    // Disable scroll-bounce for app-like feel
    scrollEnabled: false,
    limitsNavigationsToAppBoundDomains: true,
    // Required entitlements
    entitlements: {
      'com.apple.security.network.client': true,
    },
  },
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    // Capacitor Filesystem — used on mobile instead of Electron IPC
    Filesystem: {
      iosScheme: 'ionic',
    },
    // Capacitor StatusBar
    StatusBar: {
      overlaysWebView: false,
      style: 'DEFAULT',
    },
    // Splash Screen
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    // Local Notifications (used by mobile player)
    LocalNotifications: {
      smallIcon: 'ic_stat_icon',
      iconColor: '#5e5ee6',
    },
  },
};

export default config;
