# APK to ZIP Converter

An Expo / React Native app that selects an APK, extracts its archive contents locally, and creates a ZIP while retaining the contained directory structure. ZIP operations use native code, so run this app in an EAS development build or another custom development client—not in Expo Go.

## Set up the project

To scaffold a fresh Expo TypeScript app and install the required packages:

```sh
npx create-expo-app@latest apk-to-zip --template blank-typescript
cd apk-to-zip
npx expo install expo-dev-client expo-document-picker expo-file-system expo-sharing expo-system-ui react-native-zip-archive
```

Use the `App.tsx`, `index.ts`, `app.json`, `eas.json`, `package.json`, and `tsconfig.json` files in this repository for the corresponding scaffold files. The `expo install` command selects package versions compatible with the generated Expo SDK.

For this checked-in project, install dependencies and run the type check with:

```sh
npm install
npm run typecheck
```

## Native configuration and permissions

`app.json` enables the `react-native-zip-archive` config plugin and the Expo document-picker plugin. The ZIP library is automatically linked when native projects are generated.

No broad Android storage permission is needed: the system document picker grants access to the selected file, and the share sheet handles exporting the generated ZIP. The picker intentionally accepts a broad file type and validates the `.apk` extension in the app.

## Build a development client with EAS

Install and configure EAS CLI, then create an Android development build:

```sh
npm install --global eas-cli
eas login
eas build:configure
eas build --profile development --platform android
```

For iOS, use `eas build --profile development --platform ios`. Install the resulting development build on the device, then start Metro with:

```sh
npx expo start --dev-client
```

The generated ZIP is stored in the app's document directory. **Save / Share ZIP** opens the platform share sheet; the available save destinations depend on the apps installed on the device.
