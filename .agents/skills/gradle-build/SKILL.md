---
name: gradle-build
description: Multi-module Gradle build management, version catalogs (libs.versions.toml), ProGuard/R8 shrinking rules, and compilation tasks.
---
# Gradle Build Optimization

Guidelines for multi-module Android build performance and dependency governance.

## 1. Version Catalogs
- All libraries and plugins must be declared in `gradle/libs.versions.toml`.
- Never hardcode dependency strings directly in `build.gradle.kts` files.

## 2. Build Commands
- Run unit tests: `./gradlew testDebugUnitTest`
- Run lint analysis: `./gradlew lintDebug`
- Assemble debug APK: `./gradlew assembleDebug`
