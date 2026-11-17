# Changelog

All notable changes to `kubi-sdk` are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-17

First release.

### Changed

- License: MIT (the pre-release draft used BSD 3-Clause)

### Added

- `Kubi` class for Web Bluetooth: `connect` / `disconnect` / `dispose`, connection state and Bluetooth availability
- Servo basic API, one device operation per call: `writePanGoal` / `writeTiltGoal`, `writePanSpeed` / `writeTiltSpeed`, `readPan` / `readTilt`. A read returns the measured position with its time (`Observed`). The speed setting is read back with `kubi.speed` (last written value; the device is not read). The library sends nothing to the device unless one of its methods is called
- Device status: battery voltage and status, servo errors, device button, Device Information
- Diagnostics: `onDiagnostic` for raw bytes and clamping events
- Byte-level protocol test vectors in `spec/vectors/protocol.json`
- Sample code in `examples/`, one file per method, with a page that runs them
- Demo in `demo/`, showing what is written (input) and what is read back (output)
