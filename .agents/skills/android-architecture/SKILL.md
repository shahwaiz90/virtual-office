---
name: android-architecture
description: Clean Architecture guidelines for modern Android apps using Jetpack Compose, Kotlin Coroutines, StateFlow, and Repository patterns.
---
# Android Clean Architecture

This skill defines the architectural standards for modern Android development.

## 1. Unidirectional Data Flow (UDF)
- ViewModels expose immutable `StateFlow<UiState>`.
- One-off events are emitted via `SharedFlow<UiEvent>` or handled by dedicated channels.
- UI layer (Jetpack Compose) remains completely stateless and reacts only to state emissions.

## 2. Layer Boundaries
- **UI Layer**: Composable functions and ViewModels. No direct network or DB calls.
- **Domain Layer**: Pure Kotlin use cases encapsulating business logic rules.
- **Data Layer**: Repositories abstracting Room database, DataStore, and Ktor/Retrofit network clients.

## 3. Dependency Injection
- Always inject dependencies via Hilt, Koin, or constructor injection.
- Pass fake/mock repositories in unit test configurations.
