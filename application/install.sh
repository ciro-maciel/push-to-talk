#!/bin/bash

# ============================================================================
# Push-to-Talk (Whisper Local) - Installation Script
# ============================================================================
# This script installs all dependencies and sets up the application.
# Run it with: bash install.sh
# ============================================================================

set -e  # Exit on error

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     🎙️  Push-to-Talk (Whisper Local) - Installation         ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo -e "${RED}❌ Homebrew is not installed.${NC}"
    echo "   Please install it first: https://brew.sh/"
    exit 1
fi

echo -e "${GREEN}✓${NC} Homebrew detected"

# Check if Bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${YELLOW}📦 Installing Bun...${NC}"
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi
echo -e "${GREEN}✓${NC} Bun detected"

# Install system dependencies
echo ""
echo -e "${YELLOW}📦 Installing system dependencies...${NC}"

if ! command -v sox &> /dev/null; then
    echo "   Installing SoX..."
    brew install sox
else
    echo -e "${GREEN}✓${NC} SoX already installed"
fi

if ! command -v cmake &> /dev/null; then
    echo "   Installing CMake..."
    brew install cmake
else
    echo -e "${GREEN}✓${NC} CMake already installed"
fi

# Clone and build whisper.cpp if not present
echo ""
if [ ! -d "whisper.cpp" ]; then
    echo -e "${YELLOW}📥 Cloning whisper.cpp...${NC}"
    git clone https://github.com/ggerganov/whisper.cpp.git
else
    echo -e "${GREEN}✓${NC} whisper.cpp directory exists"
fi

cd whisper.cpp

# Download model if not present
if [ ! -f "models/ggml-base.bin" ]; then
    echo ""
    echo -e "${YELLOW}📥 Downloading 'base' model (~148 MB)...${NC}"
    echo "   This may take a few minutes depending on your connection."
    bash ./models/download-ggml-model.sh base
else
    echo -e "${GREEN}✓${NC} Model ggml-base.bin exists"
fi

# Compile whisper if not compiled
if [ ! -f "build/bin/whisper-cli" ]; then
    echo ""
    echo -e "${YELLOW}🔨 Compiling whisper.cpp...${NC}"
    cmake -B build -DGGML_NATIVE=OFF
    cmake --build build --config Release -j$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
else
    echo -e "${GREEN}✓${NC} whisper-cli already compiled"
fi

cd ..

# Install Node dependencies
echo ""
echo -e "${YELLOW}📦 Installing Node dependencies...${NC}"
bun install

# Trust uiohook-napi postinstall
echo ""
echo -e "${YELLOW}🔧 Trusting uiohook-napi package...${NC}"
bun pm trust uiohook-napi 2>/dev/null || true

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    ✅ Installation Complete!                  ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║                                                               ║"
echo "║   ⚠️  IMPORTANT: Grant macOS permissions before running:      ║"
echo "║                                                               ║"
echo "║   System Settings → Privacy & Security → Microphone          ║"
echo "║   System Settings → Privacy & Security → Accessibility       ║"
echo "║                                                               ║"
echo "║   Add your Terminal app (Terminal, iTerm, etc.) to both.     ║"
echo "║                                                               ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║                                                               ║"
echo "║   To run the application:                                     ║"
echo "║                                                               ║"
echo "║       bun start                                               ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
