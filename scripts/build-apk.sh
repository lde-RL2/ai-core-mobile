#!/usr/bin/env bash
# Builds the signed Android APK end-to-end:
#   web build → capacitor sync → gradle assembleRelease
# Output: releases/AI-Core-Mobile.apk (share this file to install on
# Android phones/tablets).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(ls -d "$HOME"/tools/jdk-21* 2>/dev/null | head -1 || true)"
  export JAVA_HOME
fi
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "JAVA_HOME이 없습니다. JDK 21 경로를 JAVA_HOME으로 지정하세요." >&2
  exit 1
fi
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"

# The signing keystore is intentionally NOT in git (the repo may be public
# for GitHub Pages). First build on a new machine generates a fresh one —
# but then updates won't install over APKs signed with the old key, so back
# up android/release.keystore and copy it here instead if you have one.
if [ ! -f android/release.keystore ]; then
  echo "android/release.keystore가 없어 새 서명 키를 생성합니다."
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore android/release.keystore \
    -alias aicore -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass aicore-friends -keypass aicore-friends \
    -dname "CN=AI-Core Mobile, OU=Personal, O=Personal"
  echo "⚠ 새 키로 서명된 APK는 기존 설치 위에 업데이트되지 않습니다. 키를 백업하세요."
fi

npm run build
npx cap sync android
(cd android && ./gradlew assembleRelease --no-daemon -q)

mkdir -p releases
cp android/app/build/outputs/apk/release/app-release.apk releases/AI-Core-Mobile.apk
echo
echo "✔ releases/AI-Core-Mobile.apk"
