# 🎙️ Push to Talk - Electron Application

A fully local, air-gapped speech-to-text application. Press and hold a hotkey to record, release to transcribe and paste.

**Zero API costs. Zero internet required. 100% local.**

## 📦 Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [SoX](http://sox.sourceforge.net/) for audio recording
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) compiled locally

## 🚀 Installation

### Quick Install

```bash
# From the repository root
cd application

# Run the installation script
bash install.sh
```

### Manual Installation

#### 1. Install SoX

**macOS:**

```bash
brew install sox cmake
```

**Windows:**
Download from [SoX website](https://sourceforge.net/projects/sox/)

**Linux:**

```bash
sudo apt install sox cmake build-essential
```

#### 2. Clone and Build whisper.cpp

```bash
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp
bash ./models/download-ggml-model.sh small
make
cd ..
```

#### 3. Install Dependencies

```bash
npm install
```

## 🎯 Usage

### Run in Development

```bash
npm start
```

### Build for Distribution

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

## ⌨️ Hotkey

Default: **⌘ + Shift + Space** (macOS) / **Ctrl + Shift + Space** (Windows/Linux)

1. **Hold** the hotkey to start recording
2. **Speak** clearly
3. **Release** to transcribe
4. Text is **automatically pasted** at your cursor!

## ⚙️ Configuration

Edit `src/main.js` to customize:

```javascript
const CONFIG = {
  hotkey: "CommandOrControl+Shift+Space",
  autoPaste: true,
  audio: {
    rate: 16000,
    channels: 1,
    bits: 16,
  },
};
```

## 🎛️ Available Models

| Model  | Size   | RAM     | Speed    | Quality  |
| ------ | ------ | ------- | -------- | -------- |
| tiny   | 75 MB  | ~390 MB | ⚡⚡⚡⚡ | ⭐       |
| base   | 142 MB | ~500 MB | ⚡⚡⚡   | ⭐⭐     |
| small  | 466 MB | ~1.0 GB | ⚡⚡     | ⭐⭐⭐   |
| medium | 1.5 GB | ~2.6 GB | ⚡       | ⭐⭐⭐⭐ |

To switch models:

```bash
cd whisper.cpp
bash ./models/download-ggml-model.sh base
```

## 🐛 Troubleshooting

### macOS Permissions

Grant permissions in **System Settings → Privacy & Security**:

- **Microphone** - Allow "Push to Talk"
- **Accessibility** - Allow "Push to Talk" (for auto-paste)

### macOS Security Warning

If you see _"Apple could not verify that Push to Talk.app is free of malware"_, this is because the app is not signed with an Apple Developer certificate.

**Option 1 - System Settings:**

1. Go to **System Settings → Privacy & Security**
2. Scroll down to find the message about "Push to Talk.app" being blocked
3. Click **"Open Anyway"**

**Option 2 - Terminal:**

```bash
xattr -cr /Applications/Push\ to\ Talk.app
```

### SoX not found

Install SoX:

- macOS: `brew install sox`
- Windows: Download from [SoX website](https://sourceforge.net/projects/sox/)
- Linux: `sudo apt install sox`

### whisper.cpp not compiled

```bash
cd whisper.cpp
make clean
make
```

## 📝 License

MIT
