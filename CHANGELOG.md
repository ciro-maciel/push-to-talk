## [1.3.2](https://github.com/ciro-maciel/push-to-talk/compare/v1.3.1...v1.3.2) (2025-12-25)


### Bug Fixes

* add libxrandr-dev for Linux uiohook build ([d937af0](https://github.com/ciro-maciel/push-to-talk/commit/d937af01b8aec3030e605608684209de0439343d))

## [1.3.1](https://github.com/ciro-maciel/push-to-talk/compare/v1.3.0...v1.3.1) (2025-12-25)


### Bug Fixes

* sync package.json version with semantic-release before building ([37ce4f3](https://github.com/ciro-maciel/push-to-talk/commit/37ce4f38672655643e1e1290ebd58a5e15c138ff))

# [1.3.0](https://github.com/ciro-maciel/push-to-talk/compare/v1.2.0...v1.3.0) (2025-12-25)


### Features

* enable multi-platform builds with semantic versioning ([3dae814](https://github.com/ciro-maciel/push-to-talk/commit/3dae814c53b54ed24195885f46d6d1b6332c9aeb))

# [1.2.0](https://github.com/ciro-maciel/push-to-talk/compare/v1.1.0...v1.2.0) (2025-12-25)


### Features

* Download pre-built `whisper.cpp` binaries instead of compiling from source and update build matrix. ([faef31a](https://github.com/ciro-maciel/push-to-talk/commit/faef31a8df9c3f6c4c7b788b175a1f61850769df))

# [1.1.0](https://github.com/ciro-maciel/push-to-talk/compare/v1.0.1...v1.1.0) (2025-12-25)


### Features

* Implement direct text insertion instead of clipboard paste and add Linux build dependencies for input handling. ([d3e7d39](https://github.com/ciro-maciel/push-to-talk/commit/d3e7d390b2e00900241c69c149b33b611205943b))

## [1.0.1](https://github.com/ciro-maciel/push-to-talk/compare/v1.0.0...v1.0.1) (2025-12-25)


### Bug Fixes

* Add Python 3.12 setup and install setuptools for node-gyp compatibility. ([08fccac](https://github.com/ciro-maciel/push-to-talk/commit/08fccac3f87f6aead086549e34a25d3c385366ac))

# 1.0.0 (2025-12-25)


### Bug Fixes

* enable clicking on links and logs by disabling app region drag ([8da8bf1](https://github.com/ciro-maciel/push-to-talk/commit/8da8bf1b7f8f45a58c827322bf4a25c191da206b))


### Features

* add audio visualizer overlay to display audio levels during recording. ([db19f6d](https://github.com/ciro-maciel/push-to-talk/commit/db19f6df14ed51fe9cfd512ce165527b095fd30c))
* Add loading screen, enhance system tray icon and menu with a new ear icon, and improve log message display. ([52be9e0](https://github.com/ciro-maciel/push-to-talk/commit/52be9e08f6c37cf22806e37186fbdac23020d65d))
* Implement auto-launch functionality with UI toggle, IPC, and Linux desktop entry. ([66f24ec](https://github.com/ciro-maciel/push-to-talk/commit/66f24ec8d474c822d0fbb4dd2e45121cc3418916))
* Implement custom focus styles, link styling, overlay blur, and dynamic trigger mode instructions. ([59efc2f](https://github.com/ciro-maciel/push-to-talk/commit/59efc2fdb16dcd4e2bbfb197065f46c566f9b36c))
* Implement hybrid tap-to-toggle/hold-to-PTT hotkey using uiohook-napi. ([6bed403](https://github.com/ciro-maciel/push-to-talk/commit/6bed4037c728164076ed4f7045af421a5d5c41a5))
* Implement hybrid, toggle, and hold hotkey trigger modes with UI selection and config persistence, and reduce verbose logging. ([6ca4e99](https://github.com/ciro-maciel/push-to-talk/commit/6ca4e99693a241898353dd3f29a62d07822e802a))
* Implement instant microphone recording with advanced audio processing and add a styled footer link. ([9093c94](https://github.com/ciro-maciel/push-to-talk/commit/9093c9437699b0ec82d9c5116710cd39d8f2ae11))
* Implement new visualizer styling with a Montserrat font, app-themed color palette, and refined container and bar animations. ([ce6163f](https://github.com/ciro-maciel/push-to-talk/commit/ce6163f6ef185d3dc833f1290a7fec2ff43cb7d4))
* Implement noise filtering in the main process and update renderer to display main process's noise detection results. ([9f584ec](https://github.com/ciro-maciel/push-to-talk/commit/9f584ecba194b2ed4e608cc1a7bff5bdd34e4f3c))
* Implement precise left/right modifier key support for hotkeys, updating configuration and display. ([375fd9c](https://github.com/ciro-maciel/push-to-talk/commit/375fd9c278eb08ed34badf079c2a9dee13df0db8))
* Implement semantic-release, refine hotkey recording logic, and adjust default settings and UI dimensions. ([7d94a24](https://github.com/ciro-maciel/push-to-talk/commit/7d94a24d8af83fde30c39afe9fb7a4c099245e4b))
* Improve hotkey recording with precise modifier detection and add GitHub Actions for automated releases. ([0402f34](https://github.com/ciro-maciel/push-to-talk/commit/0402f344c9ffcce5898a4e72da87a1fd14a03233))
* initialize Electron push-to-talk application with core files, configuration, and styling ([288d4b1](https://github.com/ciro-maciel/push-to-talk/commit/288d4b1f2bde32fb03d3c4b6578d536206ede198))
* introduce application icons and ear image, and remove ffmpeg binary. ([ebc8293](https://github.com/ciro-maciel/push-to-talk/commit/ebc8293ed852cfdbc973a83f74f3bd1ab10f79cf))
* Persist window position and size, and redesign the hotkey recording UI with inline display and new styles. ([0e71742](https://github.com/ciro-maciel/push-to-talk/commit/0e71742e5385fd4dfc71fcc1d20fc36a659117e2))
* refactor macOS permission checks with `electron-mac-permissions` and enhance UI with a permission modal and collapsible logs. ([c14da4f](https://github.com/ciro-maciel/push-to-talk/commit/c14da4f055be5977b54b32e10312708b95e3f7db))
* Relocate auto-launch toggle from header to footer and update its UI with a new compact switch design. ([490bf04](https://github.com/ciro-maciel/push-to-talk/commit/490bf0468bdddece92a422890a87bb39ecca8ed0))
* update various GGML backends, examples, and bindings, alongside build system improvements ([8b84007](https://github.com/ciro-maciel/push-to-talk/commit/8b8400780fe71473c366e67517e962f4671508c9))
* upgrade default Whisper model to base and add configurable transcription prompt ([ad72835](https://github.com/ciro-maciel/push-to-talk/commit/ad72835844f358f4c21406b5f59b9c3adb20dd01))
