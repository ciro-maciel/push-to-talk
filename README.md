# 🎙️ Push-to-Talk (Whisper Local)

A fully local, air-gapped speech-to-text application for macOS. Press and hold **F8** to record, release to transcribe.

**Zero API costs. Zero internet required. 100% local.**

## ✨ Features

- 🎤 **Global Hotkey** - F8 works from any application
- 🧠 **Local AI** - Uses whisper.cpp with the `small` model (optimized for pt-BR)
- 📋 **Auto Clipboard** - Transcribed text is automatically copied
- ⚡ **Fast** - Native C++ inference, no Python overhead
- 🔒 **Private** - All processing happens on your machine

## 📦 Prerequisites

- macOS (Apple Silicon or Intel)
- [Homebrew](https://brew.sh/)
- [Bun](https://bun.sh/) runtime

## 🚀 Installation

### Step 1: Install System Dependencies

```bash
# Install SoX for audio recording
brew install sox

# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash
```

### Step 2: Clone and Build whisper.cpp

```bash
# From this project directory
git clone https://github.com/ggerganov/whisper.cpp.git

cd whisper.cpp

# Download the 'small' model (~465 MB, best for pt-BR)
bash ./models/download-ggml-model.sh small

# Compile the binary
make

# Return to project root
cd ..
```

### Step 3: Install Node Dependencies

```bash
bun install
```

### Step 4: Grant macOS Permissions

Before running, you need to grant permissions in **System Settings → Privacy & Security**:

1. **Microphone** - Allow Terminal/iTerm to access the microphone
2. **Accessibility** - Allow Terminal/iTerm for global keyboard events

## 🎯 Usage

```bash
# Start the application
bun start

# Or with auto-reload during development
bun run dev
```

Then:

1. Press and hold **F8** to start recording
2. Speak clearly
3. Release **F8** to transcribe
4. The transcribed text is automatically copied to your clipboard
5. Paste (⌘+V) anywhere!

## ⚙️ Configuration

Edit the `CONFIG` object in `index.js` to customize:

```javascript
const CONFIG = {
  triggerKey: UiohookKey.F8, // Change the hotkey
  audioFile: "/tmp/recording.wav", // Temp file location
  whisperBinary: "./whisper.cpp/main", // whisper.cpp path
  whisperModel: "./whisper.cpp/models/ggml-small.bin",
  audio: {
    rate: 16000, // Sample rate (16kHz required by whisper)
    channels: 1, // Mono
    bits: 16, // Bit depth
  },
};
```

## 🎛️ Available Models

You can use different whisper models for different tradeoffs:

| Model  | Size   | RAM     | Speed    | Quality    |
| ------ | ------ | ------- | -------- | ---------- |
| tiny   | 75 MB  | ~390 MB | ⚡⚡⚡⚡ | ⭐         |
| base   | 142 MB | ~500 MB | ⚡⚡⚡   | ⭐⭐       |
| small  | 466 MB | ~1.0 GB | ⚡⚡     | ⭐⭐⭐     |
| medium | 1.5 GB | ~2.6 GB | ⚡       | ⭐⭐⭐⭐   |
| large  | 2.9 GB | ~4.7 GB | 🐢       | ⭐⭐⭐⭐⭐ |

To switch models:

```bash
cd whisper.cpp
bash ./models/download-ggml-model.sh base  # or tiny, medium, large
```

Then update `whisperModel` in `index.js`.

## 🐛 Troubleshooting

### "Failed to start recording"

- Ensure SoX is installed: `brew install sox`
- Check microphone permissions in System Settings

### "Failed to run whisper.cpp"

- Ensure whisper.cpp is compiled: `cd whisper.cpp && make`
- Verify the model exists: `ls whisper.cpp/models/ggml-small.bin`

### F8 key not detected

- Grant Accessibility permissions to your terminal app
- Restart the terminal after granting permissions

### Poor transcription quality

- Speak clearly and at a normal pace
- Ensure low background noise
- Try a larger model (base or medium)
- For pt-BR, the `small` model works best

## 📝 License

MIT
