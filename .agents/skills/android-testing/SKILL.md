---
name: android-testing
description: Automated unit and integration testing with JUnit5, MockK, Turbine for StateFlow verification, and Compose UI tests.
---
# Android Automated Testing

This skill specifies rules for authoring high-fidelity automated tests in Android projects.

## 1. AAA Pattern
Every unit test must strictly follow the **Arrange-Act-Assert** pattern:
- **Arrange**: Setup mock repository and test dispatcher.
- **Act**: Invoke ViewModel method or UseCase execution.
- **Assert**: Verify StateFlow emissions using Turbine.

## 2. Turbine for StateFlow
```kotlin
@Test
fun `when repository succeeds uiState emits Success`() = runTest {
    coEvery { repository.getData() } returns Result.success(testData)
    viewModel.loadData()
    viewModel.uiState.test {
        assertEquals(UiState.Loading, awaitItem())
        assertEquals(UiState.Success(testData), awaitItem())
    }
}
```

## 3. Code Coverage
- ViewModels & UseCases must achieve 100% test coverage.
- All tests must pass cleanly with zero regressions before feature handoff.
