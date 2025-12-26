import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { app } from "electron";

// List of available models from whisper.cpp
const AVAILABLE_MODELS = ["tiny", "base", "small", "medium", "large-v3-turbo"];

// Base URL for downloading models (Hugging Face)
const BASE_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml";

export class ModelManager {
  constructor(resourcesPath) {
    this.resourcesPath = resourcesPath;
    this.modelsPath = this._getModelsPath();
    this.downloading = new Map(); // Track active downloads
  }

  _getModelsPath() {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "models");
    }
    // In dev, use the whisper.cpp/models directory
    return path.join(this.resourcesPath, "..", "whisper.cpp", "models");
  }

  getModelsContentPath() {
    return this.modelsPath;
  }

  getModelPath(modelName) {
    return path.join(this.modelsPath, `ggml-${modelName}.bin`);
  }

  async getModels() {
    const models = [];

    // Ensure directory exists
    if (!fs.existsSync(this.modelsPath)) {
      try {
        fs.mkdirSync(this.modelsPath, { recursive: true });
      } catch (e) {
        console.error("Could not create models dir", e);
      }
    }

    for (const name of AVAILABLE_MODELS) {
      const filePath = this.getModelPath(name);

      let size = 0;
      let exists = false;

      try {
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          size = stats.size;
          exists = true;
        }
      } catch (err) {
        console.error(`Error checking model ${name}:`, err);
      }

      models.push({
        name,
        exists,
        size,
        path: filePath,
      });
    }

    return models;
  }

  downloadModel(modelName, progressCallback) {
    return new Promise((resolve, reject) => {
      if (!AVAILABLE_MODELS.includes(modelName)) {
        return reject(new Error(`Invalid model name: ${modelName}`));
      }

      const destPath = this.getModelPath(modelName);
      // Construct URL: e.g. https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin
      const url = `${BASE_URL}-${modelName}.bin`;

      const downloadFile = (downloadUrl) => {
        console.log(
          `Downloading ${modelName} from ${downloadUrl} to ${destPath}`
        );

        const request = https.get(downloadUrl, (response) => {
          // Handle Redirects
          if (
            response.statusCode === 301 ||
            response.statusCode === 302 ||
            response.statusCode === 307 ||
            response.statusCode === 308
          ) {
            const newUrl = response.headers.location;
            if (newUrl) {
              console.log(`Redirecting to: ${newUrl}`);
              // Update cancellation map to new request?
              // Actually we just recursive call, but risk: old request object in map is stale immediately.
              // We should overwrite the map entry.
              return downloadFile(newUrl);
            }
          }

          if (response.statusCode !== 200) {
            fs.unlink(destPath, () => {}); // Delete partial file
            return reject(
              new Error(
                `Failed to download: Status Code ${response.statusCode}`
              )
            );
          }

          const totalLength = parseInt(response.headers["content-length"], 10);
          let downloadedLength = 0;

          const file = fs.createWriteStream(destPath);
          response.pipe(file);

          response.on("data", (chunk) => {
            downloadedLength += chunk.length;
            if (progressCallback && totalLength) {
              const percent = (downloadedLength / totalLength) * 100;
              progressCallback(percent.toFixed(1));
            }
          });

          file.on("finish", () => {
            file.close(() => {
              console.log(`Download completed: ${modelName}`);
              resolve(destPath);
              this.downloading.delete(modelName);
            });
          });

          file.on("error", (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
            this.downloading.delete(modelName);
          });
        });

        request.on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
          this.downloading.delete(modelName);
        });

        this.downloading.set(modelName, request);
      };

      downloadFile(url);
    });
  }

  cancelDownload(modelName) {
    if (this.downloading.has(modelName)) {
      const req = this.downloading.get(modelName);
      req.destroy();
      this.downloading.delete(modelName);
      return true;
    }
    return false;
  }
}
