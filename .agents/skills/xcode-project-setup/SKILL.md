---
name: xcode-project-setup
description: Safely modifies Xcode projects (.pbxproj) to add Swift Packages and link files. Adheres to folder synchronization and anti-Ruby mandates.
compatibility: Requires Swift to be installed locally and macOS environment.
---
# Xcode Project Setup

## Critical Rules & Environment Checks
1. **The Anti-Ruby Mandate**: Strictly forbidden from using Ruby, Rails, or xcodeproj gem.
2. **Modern Xcode Folder Synchronization**: When adding new .swift or resource files, write them directly to the folder on disk. Xcode syncs automatically. Never modify .pbxproj manually.
3. **Swift Package Manager**: Configure dependencies via SPM.
4. **Static Frameworks**: Ensure `-ObjC` linker flag is configured when integrating static Objective-C frameworks.
