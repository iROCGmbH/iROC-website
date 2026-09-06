# Android APK Build Guide

Both **iROC Doctor Portal** and **Spirecut for Patients** are Progressive Web Apps (PWAs).  
On Android Chrome, users get an **"Install App"** prompt automatically — no APK needed for most use cases.

For scenarios where you need a proper `.apk` file (internal distribution, MDM, offline-first), follow the Capacitor build steps below.

---

## Option A — PWA Install (recommended, no build needed)

When a user opens the app in Chrome on Android:
1. Chrome automatically shows an **"Install"** banner at the bottom.
2. Tapping **Install Now** adds the app to the home screen and app drawer.
3. The app opens full-screen with no browser UI — identical experience to a native app.

> The apps already detect this and show a custom in-app install banner to guide users.

---

## Option B — Standalone APK via Capacitor

### Prerequisites (on your local machine)
- Node.js 18+
- Android Studio (latest) with Android SDK 33+
- Java JDK 17+

### Step 1 — Build the web app
```bash
# For iROC Doctor Portal
cd artifacts/iroc-portal
BASE_PATH=/iroc-portal/ pnpm run build

# For Spirecut Patient Portal
cd artifacts/spirecut-patient
BASE_PATH=/spirecut-patient/ pnpm run build
```

### Step 2 — Install Capacitor
```bash
# In artifacts/iroc-portal/
pnpm add @capacitor/core @capacitor/cli @capacitor/android

# In artifacts/spirecut-patient/
pnpm add @capacitor/core @capacitor/cli @capacitor/android
```

### Step 3 — Initialise and add Android platform
```bash
# iROC Portal
cd artifacts/iroc-portal
npx cap init "iROC Doctor Portal" "de.iroc.doctorportal" --web-dir dist/public
npx cap add android

# Spirecut Patient
cd artifacts/spirecut-patient
npx cap init "Spirecut" "de.spirecut.patient" --web-dir dist/public
npx cap add android
```

### Step 4 — Copy web assets
```bash
npx cap copy android
```

### Step 5 — Build APK in Android Studio
```bash
npx cap open android
```
Then in Android Studio: **Build → Build Bundle(s)/APK(s) → Build APK(s)**

The signed APK will be at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

For a release (signed) APK, configure a keystore in Android Studio under
**Build → Generate Signed Bundle/APK**.

---

## Distribute the APK

Once you have the `.apk`:

- **Direct download link**: Host it on your server/storage. Share the URL. Android will prompt users to allow "Install from unknown sources" (Settings → Apps → Special permissions).
- **MDM / Enterprise**: Push the APK via your Mobile Device Management system (e.g. Microsoft Intune, Jamf, VMware Workspace ONE).
- **QR code**: Generate a QR code pointing to the `.apk` download URL and put it on your website / print materials.

---

## iOS — PWA only

iOS Safari does not support sideloading (without an Enterprise Developer Account).  
The installed PWA experience on iOS is:

1. User opens the app in **Safari** (not Chrome — Chrome on iOS can't install PWAs)
2. Taps the **Share** button → **"Add to Home Screen"**
3. The app appears on the home screen and opens full-screen

> The in-app iOS install banner already guides users through this flow automatically.

For a true iOS native app, you would need an Apple Developer account and either:
- TestFlight distribution (internal testing, up to 10,000 users)
- Apple Enterprise Program (in-house distribution, requires annual enrollment)

---

## App identifiers

| App | Bundle ID | Name |
|-----|-----------|------|
| iROC Doctor Portal | `de.iroc.doctorportal` | iROC Portal |
| Spirecut for Patients | `de.spirecut.patient` | Spirecut |
