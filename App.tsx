import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { subscribe, unzip, zip } from "react-native-zip-archive";

type PickedApk = {
  uri: string;
  name: string;
  size: number | null;
};

type ConvertedZip = {
  uri: string;
  name: string;
  size: number;
};

function formatMegabytes(size: number | null): string {
  if (size === null) return "Unknown size";
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function safeBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.apk$/i, "");
  const safeName = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  return safeName || "application";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

export default function App() {
  const [selectedApk, setSelectedApk] = useState<PickedApk | null>(null);
  const [convertedZip, setConvertedZip] = useState<ConvertedZip | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  async function pickApk() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset || !asset.name.toLowerCase().endsWith(".apk")) {
        Alert.alert(
          "Invalid file",
          "Please select a file with the .apk extension.",
        );
        return;
      }

      setSelectedApk({
        uri: asset.uri,
        name: asset.name,
        size: asset.size ?? null,
      });
      setConvertedZip(null);
    } catch (error) {
      console.error("APK selection failed:", error);
      Alert.alert("Could not select file", errorText(error));
    }
  }

  async function convertApk() {
    if (!selectedApk || isConverting) return;

    let workingDirectory: string | null = null;
    let conversionFailed = false;
    let conversionError: unknown;
    let cleanupFailed = false;

    setConvertedZip(null);
    setIsConverting(true);
    setProgress(null);

    try {
      const cacheDirectory = FileSystem.cacheDirectory;
      const documentsDirectory = FileSystem.documentDirectory;
      if (!cacheDirectory || !documentsDirectory) {
        throw new Error("The app could not access its storage directories.");
      }

      const baseName = safeBaseName(selectedApk.name);
      const outputName = `${baseName}_extracted.zip`;
      const outputUri = `${documentsDirectory}${outputName}`;
      workingDirectory = `${cacheDirectory}apk-to-zip-${Date.now()}/`;
      await FileSystem.makeDirectoryAsync(workingDirectory, {
        intermediates: true,
      });

      setStage("Copying APK to temporary storage…");
      const copiedApkUri = `${workingDirectory}${baseName}.apk`;
      await FileSystem.copyAsync({
        from: selectedApk.uri,
        to: copiedApkUri,
      });

      const extractedDirectory = `${workingDirectory}extracted/`;
      await FileSystem.makeDirectoryAsync(extractedDirectory, {
        intermediates: true,
      });

      setStage("Extracting APK contents…");
      setProgress(0);
      const unzipSubscription = subscribe(({ progress: currentProgress }) => {
        setProgress(currentProgress);
      });
      try {
        await unzip(copiedApkUri, extractedDirectory);
      } finally {
        unzipSubscription.remove();
      }

      setStage("Creating ZIP archive…");
      setProgress(0);
      const zipSubscription = subscribe(({ progress: currentProgress }) => {
        setProgress(currentProgress);
      });
      try {
        await FileSystem.deleteAsync(outputUri, { idempotent: true });
        await zip(extractedDirectory, outputUri);
      } finally {
        zipSubscription.remove();
      }

      const outputInfo = await FileSystem.getInfoAsync(outputUri);
      if (!outputInfo.exists || outputInfo.isDirectory) {
        throw new Error("The ZIP archive was not created.");
      }

      setConvertedZip({
        uri: outputUri,
        name: outputName,
        size: outputInfo.size ?? 0,
      });
    } catch (error) {
      conversionFailed = true;
      conversionError = error;
      console.error("APK conversion failed:", error);
      setConvertedZip(null);
    } finally {
      if (workingDirectory) {
        try {
          await FileSystem.deleteAsync(workingDirectory, { idempotent: true });
        } catch (error) {
          cleanupFailed = true;
          console.error("Temporary conversion files could not be removed:", error);
        }
      }
      setIsConverting(false);
      setStage("");
      setProgress(null);
    }

    if (conversionFailed) {
      Alert.alert(
        "Conversion failed",
        `We couldn't create a ZIP from this APK. Check that the file is valid and that your device has enough free space.\n\n${errorText(conversionError)}`,
      );
    } else if (cleanupFailed) {
      Alert.alert(
        "ZIP created",
        "Your archive is ready, but some temporary files could not be removed. You can try converting again to clear them.",
      );
    }
  }

  async function shareZip() {
    if (!convertedZip) return;

    try {
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert(
          "Sharing unavailable",
          "This device does not support sharing files from the app.",
        );
        return;
      }

      await Sharing.shareAsync(convertedZip.uri, {
        dialogTitle: `Save or share ${convertedZip.name}`,
        mimeType: "application/zip",
        UTI: "public.zip-archive",
      });
    } catch (error) {
      console.error("Sharing ZIP failed:", error);
      Alert.alert("Could not share ZIP", errorText(error));
    }
  }

  const statusText = isConverting
    ? "Converting"
    : convertedZip
      ? "Success"
      : selectedApk
        ? "Ready to convert"
        : "Waiting for an APK";

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>ZIP</Text>
          </View>
          <Text style={styles.eyebrow}>FILE CONVERTER</Text>
          <Text style={styles.title}>APK to ZIP{"\n"}Converter</Text>
          <Text style={styles.subtitle}>
            Extract an Android package and create a ZIP with its folder
            structure intact.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your APK file</Text>
          <Text style={styles.sectionDescription}>
            Choose an APK stored on your device to get started.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Select APK file"
            disabled={isConverting}
            onPress={pickApk}
            style={({ pressed }) => [
              styles.selectButton,
              pressed && styles.buttonPressed,
              isConverting && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.selectIcon}>↑</Text>
            <Text style={styles.selectButtonText}>
              {selectedApk ? "Choose another APK" : "Select APK File"}
            </Text>
          </Pressable>

          {selectedApk ? (
            <View style={styles.fileDetails}>
              <View style={styles.fileIcon}>
                <Text style={styles.fileIconText}>APK</Text>
              </View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {selectedApk.name}
                </Text>
                <Text style={styles.fileSize}>
                  {formatMegabytes(selectedApk.size)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              convertedZip && styles.successDot,
              isConverting && styles.workingDot,
            ]}
          />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>

        {isConverting ? (
          <View style={styles.progressCard} accessibilityLiveRegion="polite">
            <ActivityIndicator color={COLORS.accent} />
            <View style={styles.progressInfo}>
              <Text style={styles.progressTitle}>{stage}</Text>
              <Text style={styles.progressCaption}>
                {progress === null
                  ? "Please keep the app open."
                  : `${Math.round(progress * 100)}% complete`}
              </Text>
            </View>
          </View>
        ) : null}

        {convertedZip ? (
          <View style={styles.successCard}>
            <View style={styles.successHeading}>
              <Text style={styles.successCheck}>✓</Text>
              <Text style={styles.successTitle}>ZIP ready</Text>
            </View>
            <Text style={styles.outputName} numberOfLines={2}>
              {convertedZip.name}
            </Text>
            <Text style={styles.fileSize}>
              {formatMegabytes(convertedZip.size)}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={shareZip}
              style={({ pressed }) => [
                styles.shareButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.shareButtonText}>Save / Share ZIP</Text>
            </Pressable>
          </View>
        ) : null}

        {selectedApk && !convertedZip ? (
          <Pressable
            accessibilityRole="button"
            disabled={isConverting}
            onPress={convertApk}
            style={({ pressed }) => [
              styles.convertButton,
              pressed && styles.buttonPressed,
              isConverting && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.convertButtonText}>Convert to ZIP</Text>
            <Text style={styles.convertArrow}>→</Text>
          </Pressable>
        ) : null}

        <Text style={styles.footnote}>
          Your APK is processed locally on this device. No file is uploaded.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const COLORS = {
  background: "#F5F7F9",
  surface: "#FFFFFF",
  ink: "#17212B",
  muted: "#697784",
  border: "#E5EAEE",
  accent: "#226B55",
  accentLight: "#E7F3ED",
  success: "#21734F",
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 28,
  },
  header: {
    marginBottom: 28,
  },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  brandMarkText: {
    color: COLORS.surface,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  eyebrow: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginBottom: 9,
  },
  title: {
    color: COLORS.ink,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    letterSpacing: -1,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 12,
    maxWidth: 400,
  },
  card: {
    padding: 20,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    color: COLORS.ink,
    fontSize: 17,
    fontWeight: "700",
  },
  sectionDescription: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 18,
  },
  selectButton: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#B8D3C7",
    borderStyle: "dashed",
    backgroundColor: "#F7FBF8",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  selectIcon: {
    color: COLORS.accent,
    fontSize: 22,
    fontWeight: "600",
    marginTop: -3,
  },
  selectButtonText: {
    color: COLORS.accent,
    fontSize: 15,
    fontWeight: "700",
  },
  buttonPressed: {
    opacity: 0.78,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  fileDetails: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    paddingTop: 17,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  fileIcon: {
    width: 44,
    height: 48,
    borderRadius: 10,
    backgroundColor: COLORS.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  fileIconText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: "800",
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  fileSize: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 20,
    marginBottom: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#A3AFB8",
    marginRight: 8,
  },
  successDot: {
    backgroundColor: COLORS.success,
  },
  workingDot: {
    backgroundColor: "#CA8A25",
  },
  statusText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  progressCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 17,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  progressInfo: {
    flex: 1,
    marginLeft: 13,
  },
  progressTitle: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  progressCaption: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 4,
  },
  successCard: {
    padding: 19,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#CFE4D7",
    marginBottom: 14,
  },
  successHeading: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  successCheck: {
    width: 23,
    height: 23,
    overflow: "hidden",
    textAlign: "center",
    textAlignVertical: "center",
    borderRadius: 12,
    backgroundColor: COLORS.accentLight,
    color: COLORS.success,
    fontWeight: "800",
    marginRight: 8,
  },
  successTitle: {
    color: COLORS.success,
    fontSize: 15,
    fontWeight: "700",
  },
  outputName: {
    color: COLORS.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  shareButton: {
    minHeight: 50,
    borderRadius: 13,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 17,
  },
  shareButtonText: {
    color: COLORS.surface,
    fontSize: 15,
    fontWeight: "700",
  },
  convertButton: {
    minHeight: 56,
    borderRadius: 15,
    backgroundColor: COLORS.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  convertButtonText: {
    color: COLORS.surface,
    fontSize: 15,
    fontWeight: "700",
  },
  convertArrow: {
    color: COLORS.surface,
    fontSize: 18,
    fontWeight: "700",
    marginLeft: 9,
  },
  footnote: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 24,
    paddingHorizontal: 15,
  },
});
