const { spawn, execSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const PythonResolver = require("./pythonResolver");

// 簡單的全局緩存，避免頻繁檢查
let globalModelCheckCache = null;
let globalModelCheckTime = 0;
const GLOBAL_CACHE_TIME = 2000; // 2秒緩存

const STREAMING_MODEL_CONFIG = {
  name: "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2",
  required_files: [
    "encoder-epoch-99-avg-1.onnx",
    "decoder-epoch-99-avg-1.onnx",
    "joiner-epoch-99-avg-1.onnx",
    "tokens.txt",
  ],
};

const MODEL_CONFIGS = {
  paraformer: {
    name: "sherpa-onnx-paraformer-zh-small-2024-03-09",
    expected_size: 80 * 1024 * 1024,
    required_files: ["model.int8.onnx", "tokens.txt"],
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09",
  },
  sense_voice: {
    name: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
    expected_size: 330 * 1024 * 1024,
    required_files: ["model.int8.onnx", "tokens.txt"],
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
  },
  whisper: {
    name: "sherpa-onnx-whisper-small",
    expected_size: 200 * 1024 * 1024,
    required_files: ["small-encoder.int8.onnx", "small-decoder.int8.onnx", "small-tokens.txt"],
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small",
  },
  qwen3_asr: {
    name: "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25",
    expected_size: 982 * 1024 * 1024,
    required_files: ["encoder.int8.onnx", "decoder.int8.onnx", "conv_frontend.onnx", "tokenizer/vocab.json"],
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2",
  },
  breeze_asr_25: {
    name: "Breeze-ASR-25-onnx-250806",
    expected_size: 1777 * 1024 * 1024,
    required_files: ["breeze-asr-25-half-encoder.int8.onnx", "breeze-asr-25-half-decoder.int8.onnx", "breeze-asr-25-half-tokens.txt"],
    url: "https://huggingface.co/MediaTek-Research/Breeze-ASR-25-onnx-250806",
  },
};

class SherpaManager {
  constructor(logger = null, options = {}) {
    this.logger = logger || console;
    this.pythonResolver = new PythonResolver(this.logger);
    this.platform = options.platform || process.platform;
    this.userDataPath = options.userDataPath || null;
    this.projectRoot = options.projectRoot || path.join(__dirname, "..", "..");
    this.spawnFn = options.spawnFn || spawn;
    this.httpsGet = options.httpsGet || https.get;
    this.sherpaInstalled = null;
    this.isInitialized = false;
    this.modelsInitialized = false;
    this.initializationPromise = null;
    this.serverProcess = null;
    this.serverReady = false;
    this.modelsDownloaded = null;
    this.databaseManager = null;
    // 串流模型配置（與主要 ASR 模型分開管理）
    this.streamingModelConfig = STREAMING_MODEL_CONFIG;
  }

  setDatabaseManager(databaseManager) {
    this.databaseManager = databaseManager;
  }

  getModelConfig(modelType = null) {
    const activeType = modelType || (this.databaseManager ? this.databaseManager.getSetting("asr_model_type", "paraformer") : "paraformer");
    return MODEL_CONFIGS[activeType] || MODEL_CONFIGS.paraformer;
  }

  getSherpaServerPath() {
    // 獲取 Sherpa 服務器腳本路徑
    const isDevelopment =
      process.env.NODE_ENV === "development" ||
      !require("electron").app?.isPackaged;

    if (isDevelopment) {
      return path.join(__dirname, "..", "..", "sherpa_server.py");
    } else {
      return path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "sherpa_server.py"
      );
    }
  }

  getBundledServerExe() {
    if (!process.resourcesPath) return null;
    const executableName = process.platform === "win32" ? "sherpa_server.exe" : "sherpa_server";
    return path.join(
      process.resourcesPath,
      "sherpa-backend",
      executableName
    );
  }

  getEmbeddedPythonPath() { return this.pythonResolver.getEmbeddedPythonPath(); }
  setupIsolatedEnvironment() { return this.pythonResolver.setupIsolatedEnvironment(); }
  buildPythonEnvironment() { return this.pythonResolver.buildPythonEnvironment(); }

  async buildAccelerationEnv(detector = null) {
    const env = { ...this.buildPythonEnvironment() };
    const acceleration = this.databaseManager
      ? this.databaseManager.getSetting("asr_acceleration", "auto")
      : "auto";
    const det = detector || this.accelerationDetector || (this.accelerationDetector = new (require("./acceleration"))());
    const resolved = await det.resolveForEngine("sherpa", acceleration);
    env.SHERPA_PROVIDER = resolved.provider || "cpu";
    if (resolved.warning) {
      this.logger.warn && this.logger.warn(resolved.warning);
    }
    this.logger.info && this.logger.info("Sherpa 加速模式", { acceleration, provider: env.SHERPA_PROVIDER });
    return env;
  }
  findPythonExecutable() { return this.pythonResolver.findPythonExecutable(); }

  getModelCachePath(modelType = null, customPath = null) {
    const config = this.getModelConfig(modelType);
    const name = config.name;
    // 開發模式用專案根目錄，打包版用 userData（asar 內不可寫）
    const isPackaged = !!(process.env.NODE_ENV !== "development" && require("electron").app?.isPackaged);
    const defaultModelDir = isPackaged
      ? path.join(this.getUserDataPath(), "models", name)
      : path.join(__dirname, "..", "..", "model", name);

    // 1. 若模型已存在於預設目錄，永遠留在原處（不因自訂路徑而搬移）
    if (fs.existsSync(defaultModelDir)) {
      return defaultModelDir;
    }

    // 2. 預設目錄沒有 → 檢查自訂路徑
    let customDir = customPath;
    if (!customDir && this.databaseManager) {
      customDir = this.databaseManager.getSetting("custom_model_dir", "");
    }
    if (customDir) {
      const customModelDir = path.join(customDir, name);
      if (fs.existsSync(customModelDir)) {
        return customModelDir;
      }
    }

    // 3. 相容性後備路徑（打包內建的模型目錄）
    const candidates = [];
    if (process.resourcesPath) {
      candidates.push(
        path.join(process.resourcesPath, "sherpa-backend", "poc-sherpa", name)
      );
    }
    try {
      const userData = require("electron").app.getPath("userData");
      candidates.push(path.join(userData, "models", "poc-sherpa", name));
    } catch (e) { /* ignore */ }
    candidates.push(path.join(__dirname, "..", "..", "poc-sherpa", name));
    candidates.push(path.join(os.homedir(), ".cache", "sherpa-onnx", name));

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // 4. 模型尚未下載 → 回傳目標路徑（自訂優先，否則預設）
    if (customDir) {
      return path.join(customDir, name);
    }
    return defaultModelDir;
  }

  getUserDataPath() {
    if (this.userDataPath) return this.userDataPath;
    return require("electron").app.getPath("userData");
  }

  isStreamingSupportedPlatform() {
    // 串流模型用 tar -xjf 解壓:macOS / Linux 原生支援,Windows 10/11 內建的
    // System32 bsdtar 也帶 bz2lib(實測可解)。三平台皆可,不再限定 macOS。
    return ["darwin", "win32", "linux"].includes(this.platform);
  }

  getStreamingModelTargetPath() {
    const userData = this.getUserDataPath();
    return path.join(userData, "models", "poc-sherpa", this.streamingModelConfig.name);
  }

  getStreamingModelSearchPaths() {
    const name = this.streamingModelConfig.name;
    const candidates = [];
    try {
      candidates.push(this.getStreamingModelTargetPath());
    } catch (error) {
      // Non-Electron tests or early startup can still use project fallback.
    }
    candidates.push(path.join(this.projectRoot, "poc-sherpa", name));
    return candidates;
  }

  findStreamingModelPath() {
    for (const candidate of this.getStreamingModelSearchPaths()) {
      const hasAllFiles = this.streamingModelConfig.required_files.every((file) =>
        fs.existsSync(path.join(candidate, file))
      );
      if (hasAllFiles) return candidate;
    }
    try {
      return this.getStreamingModelTargetPath();
    } catch (error) {
      return path.join(this.projectRoot, "poc-sherpa", this.streamingModelConfig.name);
    }
  }

  async checkStreamingModelFiles() {
    if (!this.isStreamingSupportedPlatform()) {
      return {
        success: false,
        unsupported: true,
        models_downloaded: false,
        error: "Streaming Zipformer is currently available on macOS only",
      };
    }

    const modelPath = this.findStreamingModelPath();
    const missingFiles = this.streamingModelConfig.required_files.filter((file) =>
      !fs.existsSync(path.join(modelPath, file))
    );

    return {
      success: true,
      unsupported: false,
      models_downloaded: missingFiles.length === 0,
      missing_models: missingFiles.length > 0 ? ["streaming"] : [],
      details: {
        model_path: modelPath,
        missing_files: missingFiles,
        download_url: this.streamingModelConfig.url,
      },
    };
  }

  async downloadStreamingModel(progressCallback = null) {
    if (!this.isStreamingSupportedPlatform()) {
      return {
        success: false,
        unsupported: true,
        error: "Streaming Zipformer is currently available on macOS only",
      };
    }

    const existing = await this.checkStreamingModelFiles();
    if (existing.models_downloaded) {
      return { success: true, already_downloaded: true, model_path: existing.details.model_path };
    }

    const targetRoot = path.dirname(this.getStreamingModelTargetPath());
    await fs.promises.mkdir(targetRoot, { recursive: true });
    const tarPath = path.join(os.tmpdir(), `${this.streamingModelConfig.name}-${crypto.randomUUID()}.tar.bz2`);

    try {
      await this.downloadFile(this.streamingModelConfig.url, tarPath, progressCallback);
      progressCallback?.({ stage: "extracting", model: "streaming", progress: 100 });
      await this.extractTarBz2(tarPath, targetRoot);
      progressCallback?.({ stage: "verifying", model: "streaming", progress: 100 });
      const checkResult = await this.checkStreamingModelFiles();
      if (!checkResult.models_downloaded) {
        return {
          success: false,
          error: `Streaming model download incomplete: ${checkResult.details.missing_files.join(", ")}`,
          ...checkResult,
        };
      }
      return { success: true, model_path: checkResult.details.model_path };
    } finally {
      fs.promises.unlink(tarPath).catch(() => {});
    }
  }

  async ensureStreamingModelAvailable(progressCallback = null) {
    const status = await this.checkStreamingModelFiles();
    if (status.models_downloaded) {
      return { success: true, already_downloaded: true, model_path: status.details.model_path };
    }
    if (status.unsupported) {
      return status;
    }
    return await this.downloadStreamingModel(progressCallback);
  }

  downloadFile(url, destPath, progressCallback = null) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const request = this.httpsGet(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.promises.unlink(destPath).catch(() => {});
          this.downloadFile(response.headers.location, destPath, progressCallback).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          file.close();
          reject(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }

        const total = Number(response.headers["content-length"] || 0);
        let downloaded = 0;
        response.on("data", (chunk) => {
          downloaded += chunk.length;
          if (progressCallback && total > 0) {
            progressCallback({
              stage: "downloading",
              model: "streaming",
              downloaded,
              total,
              progress: Math.round((downloaded / total) * 1000) / 10,
            });
          }
        });
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      });
      request.on("error", (error) => {
        file.close();
        fs.promises.unlink(destPath).catch(() => {});
        reject(error);
      });
      file.on("error", (error) => {
        request.destroy();
        reject(error);
      });
    });
  }

  extractTarBz2(tarPath, targetRoot) {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn("tar", ["-xjf", tarPath, "-C", targetRoot], {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr.trim() || `tar exited with code ${code}`));
        }
      });
    });
  }

  async checkModelFiles(modelType = null, customPath = null) {
    const now = Date.now();
    if (
      globalModelCheckCache &&
      now - globalModelCheckTime < GLOBAL_CACHE_TIME &&
      !this.serverReady &&
      !modelType &&
      !customPath
    ) {
      return globalModelCheckCache;
    }

    try {
      const activeType = modelType || (this.databaseManager ? this.databaseManager.getSetting("asr_model_type", "paraformer") : "paraformer");
      const config = this.getModelConfig(activeType);
      const modelPath = this.getModelCachePath(activeType, customPath);
      this.logger.info && this.logger.info(`檢查模型 ${activeType} 路徑:`, modelPath);

      if (!fs.existsSync(modelPath)) {
        this.logger.info && this.logger.info("模型目錄不存在");
        const result = {
          success: true,
          models_downloaded: false,
          missing_models: ["asr"],
          details: {
            model_path: modelPath,
            exists: false,
          },
        };
        if (!modelType && !customPath) {
          this.modelsDownloaded = false;
          globalModelCheckCache = result;
          globalModelCheckTime = now;
        }
        return result;
      }

      const missingFiles = [];
      for (const file of config.required_files) {
        const filePath = path.join(modelPath, file);
        const sz = this._getExistingFileSize(filePath);
        if (sz <= 0) {
          missingFiles.push(file);
        }
      }

      const allDownloaded = missingFiles.length === 0;
      // 檢查模型是否為安裝包內建：
      // - 生產模式：在 process.resourcesPath/sherpa-backend/poc-sherpa/ 下
      // - 開發模式：在專案根目錄 poc-sherpa/ 下（extraResources 打包的模型）
      const isBundled = !!(
        (process.resourcesPath && modelPath.startsWith(path.join(process.resourcesPath, "sherpa-backend"))) ||
        (modelPath.includes(`${path.sep}poc-sherpa${path.sep}`))
      );
      const result = {
        success: true,
        models_downloaded: allDownloaded,
        missing_models: missingFiles.length > 0 ? ["asr"] : [],
        directory_exists: fs.existsSync(modelPath),
        is_bundled: isBundled,
        details: {
          model_path: modelPath,
          missing_files: missingFiles,
        },
      };

      if (!modelType && !customPath) {
        this.modelsDownloaded = allDownloaded;
        globalModelCheckCache = result;
        globalModelCheckTime = now;
      }
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("檢查模型文件失敗:", error);
      const result = {
        success: false,
        error: error.message,
        models_downloaded: false,
        missing_models: ["asr"],
        details: {},
      };
      if (!modelType && !customPath) {
        this.modelsDownloaded = false;
      }
      return result;
    }
  }

  async getDownloadProgress() {
    try {
      const activeType = this.databaseManager ? this.databaseManager.getSetting("asr_model_type", "paraformer") : "paraformer";
      const config = this.getModelConfig(activeType);
      const modelPath = this.getModelCachePath(activeType);

      if (!fs.existsSync(modelPath)) {
        return {
          success: true,
          overall_progress: 0,
          models: {
            asr: {
              progress: 0,
              downloaded: 0,
              total: config.expected_size,
            },
          },
        };
      }

      let fileSize = 0;
      const mainFile = config.required_files[0];
      const modelFile = path.join(modelPath, mainFile);
      if (fs.existsSync(modelFile)) {
        const stats = fs.statSync(modelFile);
        fileSize = stats.size;
      }

      const progress = Math.min(
        100,
        (fileSize / config.expected_size) * 100
      );

      return {
        success: true,
        overall_progress: Math.round(progress * 10) / 10,
        models: {
          asr: {
            progress: Math.round(progress * 10) / 10,
            downloaded: fileSize,
            total: config.expected_size,
          },
        },
      };
    } catch (error) {
      this.logger.error && this.logger.error("獲取下載進度失敗:", error);
      return {
        success: false,
        error: error.message,
        overall_progress: 0,
        models: {},
      };
    }
  }

  async downloadModels(progressCallback = null) {
    try {
      const activeType = this.databaseManager ? this.databaseManager.getSetting("asr_model_type", "paraformer") : "paraformer";
      const config = this.getModelConfig(activeType);
      const targetPath = this.getModelCachePath(activeType);

      this.logger.info && this.logger.info(`開始下載 ${activeType} 模型...`);

      const checkResult = await this.checkModelFiles(activeType);
      if (checkResult.models_downloaded) {
        this.logger.info && this.logger.info("模型已存在，無需下載");
        return { success: true, message: "模型已存在，無需下載" };
      }

      // 清理殘留檔案：先逐檔刪除，若仍殘留（如 Windows ACL 損毀）則 rename 目錄
      if (fs.existsSync(targetPath)) {
        this._removeDirectoryRecursive(targetPath);
        try {
          if (fs.readdirSync(targetPath).length > 0) {
            const oldDir = targetPath + '.bak.' + Date.now();
            fs.renameSync(targetPath, oldDir);
            this.logger.info && this.logger.info(`無法刪除的檔案已搬移至: ${oldDir}`);
          }
        } catch (_) {
          // readdir 也失敗時嘗試 rename
          const oldDir = targetPath + '.bak.' + Date.now();
          try {
            fs.renameSync(targetPath, oldDir);
          } catch (e2) {
            this.logger.warn && this.logger.warn(`無法清理模型目錄: ${e2.message}`);
          }
        }
      }
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }

      const https = require("https");
      
      const downloadFileWithProgress = (url, dest, onProgress) => {
        return new Promise((resolve, reject) => {
          const file = fs.createWriteStream(dest);
          let downloadedBytes = 0;
          let totalBytes = 0;

          const request = https.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              const redirectUrl = response.headers.location.startsWith("http")
                ? response.headers.location
                : new URL(response.headers.location, url).href;
              downloadFileWithProgress(redirectUrl, dest, onProgress)
                .then(resolve)
                .catch(reject);
              return;
            }

            if (response.statusCode !== 200) {
              reject(new Error(`Failed to download file: ${response.statusCode}`));
              return;
            }

            totalBytes = parseInt(response.headers["content-length"] || "0", 10);
            
            response.on("data", (chunk) => {
              downloadedBytes += chunk.length;
              file.write(chunk);
              if (totalBytes > 0 && onProgress) {
                onProgress(downloadedBytes, totalBytes);
              }
            });

            response.on("end", () => {
              file.end();
            });
          });

          file.on("finish", () => {
            resolve();
          });

          file.on("error", (err) => {
            fs.unlink(dest, () => {});
            reject(err);
          });

          request.on("error", (err) => {
            fs.unlink(dest, () => {});
            reject(err);
          });
        });
      };

      if (activeType === "qwen3_asr") {
        const tarUrl = config.url;
        const tempTarPath = path.join(os.tmpdir(), "qwen3_model.tar.bz2");
        
        if (progressCallback) {
          progressCallback({
            stage: "downloading",
            model: "asr",
            progress: 0,
            overall_progress: 0,
          });
        }

        this.logger.info && this.logger.info(`正在下載 Qwen3 壓縮檔: ${tarUrl}`);
        await downloadFileWithProgress(tarUrl, tempTarPath, (downloaded, total) => {
          const pct = Math.round((downloaded / total) * 100);
          if (progressCallback) {
            progressCallback({
              stage: "downloading",
              model: "asr",
              progress: pct,
              overall_progress: pct,
            });
          }
        });

        this.logger.info && this.logger.info("壓縮檔下載完成，正在解壓縮...");
        if (progressCallback) {
          progressCallback({
            stage: "extracting",
            model: "asr",
            progress: 100,
            overall_progress: 100,
          });
        }

        const parentDir = path.dirname(targetPath);
        
        try {
          execSync(`tar -xf "${tempTarPath}" -C "${parentDir}"`);
          this.logger.info && this.logger.info("解壓縮完成！");
          this._forceDeletePath(tempTarPath);
        } catch (e) {
          this.logger.error && this.logger.error("解壓縮失敗:", e);
          this._forceDeletePath(tempTarPath);
          return { success: false, error: "解壓縮失敗: " + e.message };
        }
      } else {
        const repo = config.url.replace("https://huggingface.co/", "");
        const filesToDownload = config.required_files;
        let overallTotal = config.expected_size;
        let overallDownloaded = 0;

        for (const f of filesToDownload) {
          const p = path.join(targetPath, f);
          const sz = this._getExistingFileSize(p);
          if (sz > 0) {
            overallTotal += sz;
          }
        }

        for (let i = 0; i < filesToDownload.length; i++) {
          const filename = filesToDownload[i];
          const fileDest = path.join(targetPath, filename);

          const existingSize = this._getExistingFileSize(fileDest);
          if (existingSize > 0) {
            this.logger.info && this.logger.info(`檔案已存在，跳過 ${i + 1}/${filesToDownload.length}: ${filename}`);
            overallDownloaded += existingSize;
            continue;
          }

          const downloadUrl = `https://hf-mirror.com/${repo}/resolve/main/${filename}`;
          this.logger.info && this.logger.info(`正在下載檔案 ${i + 1}/${filesToDownload.length}: ${filename}`);

          await downloadFileWithProgress(downloadUrl, fileDest, (downloaded, total) => {
            const currentOverall = overallDownloaded + downloaded;
            const pct = Math.min(99, Math.round((currentOverall / overallTotal) * 100));
            if (progressCallback) {
              progressCallback({
                stage: "downloading",
                model: "asr",
                progress: pct,
                overall_progress: pct,
              });
            }
          }).catch(async (err) => {
            this.logger.warn && this.logger.warn(`鏡像下載失敗，回退至官方 HF 來源...: ${err.message}`);
            const fallbackUrl = `https://huggingface.co/${repo}/resolve/main/${filename}`;
            await downloadFileWithProgress(fallbackUrl, fileDest, (downloaded, total) => {
              const currentOverall = overallDownloaded + downloaded;
              const pct = Math.min(99, Math.round((currentOverall / overallTotal) * 100));
              if (progressCallback) {
                progressCallback({
                  stage: "downloading",
                  model: "asr",
                  progress: pct,
                  overall_progress: pct,
                });
              }
            });
          });

          const postSize = this._getExistingFileSize(fileDest);
          if (postSize === 0) {
            this._forceDeletePath(fileDest);
            throw new Error(`下載的檔案 ${filename} 為空（0 bytes），下載可能失敗`);
          }
          overallDownloaded += postSize;
        }
      }

      if (progressCallback) {
        progressCallback({
          stage: "finished",
          model: "asr",
          progress: 100,
          overall_progress: 100,
        });
      }

      this._clearModelCache();
      return { success: true };
    } catch (error) {
      this.logger.error && this.logger.error("模型下載失敗:", error);
      return { success: false, error: error.message };
    }
  }

  async copyModelFiles(modelType, sourcePath, destPath) {
    try {
      this.logger.info && this.logger.info(`準備從 ${sourcePath} 複製 ${modelType} 模型到 ${destPath}`);
      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: "來源路徑不存在" };
      }
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

      // 遞迴複製資料夾
      const copyRecursiveSync = (src, dest) => {
        const exists = fs.existsSync(src);
        const stats = exists && fs.statSync(src);
        const isDirectory = exists && stats.isDirectory();
        if (isDirectory) {
          if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
          }
          fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
          });
        } else {
          fs.copyFileSync(src, dest);
        }
      };

      copyRecursiveSync(sourcePath, destPath);
      this.logger.info && this.logger.info("複製模型完成");
      this._clearModelCache();
      return { success: true };
    } catch (e) {
      this.logger.error && this.logger.error("複製模型失敗:", e);
      return { success: false, error: e.message };
    }
  }

  async deleteModelFiles(modelType, customPath = null) {
    try {
      const modelPath = this.getModelCachePath(modelType, customPath);
      this.logger.info && this.logger.info(`刪除模型檔案: ${modelPath}`);
      if (fs.existsSync(modelPath)) {
        // Windows 上 rename 僅更新目錄項，即使目錄內有 ACL 損毀的檔案也能成功
        const backupPath = modelPath + '.deleted.' + Date.now();
        try {
          fs.renameSync(modelPath, backupPath);
        } catch (renameErr) {
          // rename 失敗（跨磁碟等情況），退回逐檔刪除
          this.logger.warn && this.logger.warn(`rename 失敗，退回逐檔刪除: ${renameErr.message}`);
          this._removeDirectoryRecursive(modelPath);
          this.logger.info && this.logger.info("模型檔案刪除完成");
          this._clearModelCache();
          return { success: true };
        }
        // 背景清理備份（不阻塞）
        setTimeout(() => {
          this._removeDirectoryRecursive(backupPath);
        }, 100);
        this.logger.info && this.logger.info("模型檔案已搬移，背景清理中");
      }
      this._clearModelCache();
      return { success: true };
    } catch (e) {
      this.logger.error && this.logger.error("刪除模型檔案失敗:", e);
      return { success: false, error: e.message };
    }
  }

  _removeDirectoryRecursive(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    let entries;
    try {
      entries = fs.readdirSync(dirPath);
    } catch (e) {
      this.logger.warn && this.logger.warn(`無法讀取目錄 ${dirPath}: ${e.message}`);
      this._forceDeletePath(dirPath);
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = fs.lstatSync(fullPath);
        if (stat.isDirectory()) {
          this._removeDirectoryRecursive(fullPath);
        } else {
          this._forceDeletePath(fullPath);
        }
      } catch (e) {
        if (e.code === 'EPERM') {
          this.logger.warn && this.logger.warn(`無法存取 ${fullPath}，嘗試強制刪除`);
          this._forceDeletePath(fullPath);
        } else {
          this.logger.warn && this.logger.warn(`無法處理 ${fullPath}: ${e.message}`);
        }
      }
    }
    try {
      fs.rmdirSync(dirPath);
    } catch (e) {
      if (e.code === 'ENOENT') return;
      this.logger.warn && this.logger.warn(`無法刪除目錄 ${dirPath}: ${e.message}`);
    }
  }

  _getExistingFileSize(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        // existsSync may return false due to EPERM — try to clean up stale file
        this._forceDeletePath(filePath);
        return 0;
      }
      return fs.statSync(filePath).size;
    } catch (e) {
      if (e.code === 'EPERM') {
        this.logger.warn && this.logger.warn(`檔案權限異常，嘗試強制清除: ${filePath}`);
        this._forceDeletePath(filePath);
        return 0;
      }
      throw e;
    }
  }

  _forceDeletePath(filePath) {
    try {
      fs.unlinkSync(filePath);
      return;
    } catch (e) {
      if (e.code !== 'EPERM') {
        this.logger.warn && this.logger.warn(`無法刪除 ${filePath}: ${e.message}`);
        return;
      }
    }
    try {
      fs.chmodSync(filePath, 0o666);
      fs.unlinkSync(filePath);
      return;
    } catch (e) {
      if (e.code !== 'EPERM') {
        this.logger.warn && this.logger.warn(`無法刪除 ${filePath}: ${e.message}`);
        return;
      }
    }
    try {
      execSync(`attrib -R "${filePath}"`, { timeout: 5000 });
      execSync(`del /F /Q /A "${filePath}"`, { timeout: 5000 });
      return;
    } catch (e) {
      this.logger.warn && this.logger.warn(`del 失敗，嘗試 takeown+icacls: ${e.message}`);
    }
    try {
      execSync(`takeown /F "${filePath}"`, { timeout: 5000 });
      execSync(`icacls "${filePath}" /grant "Everyone:(F)"`, { timeout: 5000 });
      execSync(`del /F /Q /A "${filePath}"`, { timeout: 5000 });
    } catch (e) {
      this.logger.warn && this.logger.warn(`無法強制刪除 ${filePath}: ${e.message}`);
    }
  }


  async restartServer() {
    /**
     * 重啟 Sherpa 服務器
     */
    try {
      this.logger.info && this.logger.info("重啟 Sherpa 服務器...");

      if (this.serverProcess) {
        await this._stopSherpaServer();
        this.logger.info && this.logger.info("已停止現有 Sherpa 服務器");
      }

      this.serverReady = false;
      this.modelsInitialized = false;
      this.initializationPromise = null;
      this._clearModelCache();

      const modelStatus = await this.checkModelFiles();
      if (!modelStatus.models_downloaded) {
        throw new Error("模型文件未下載，無法啟動服務器");
      }

      this.initializationPromise = this._startSherpaServer();
      await this.initializationPromise;

      this.logger.info && this.logger.info("Sherpa 服務器重啟完成");
      return { success: true, message: "Sherpa 服務器重啟成功" };
    } catch (error) {
      this.logger.error && this.logger.error("重啟 Sherpa 服務器失敗:", error);
      return { success: false, error: error.message };
    }
  }

  _clearModelCache() {
    globalModelCheckCache = null;
    globalModelCheckTime = 0;
  }

  async initializeAtStartup() {
    try {
      this.logger.info && this.logger.info("Sherpa 管理器啟動初始化開始");

      // 打包版有自帶的 sherpa_server.exe → 跳過所有系統/嵌入式 Python 檢查
      const bundledExe = this.getBundledServerExe();
      if (bundledExe && fs.existsSync(bundledExe)) {
        this.logger.info &&
          this.logger.info("使用打包的 sherpa_server.exe", { bundledExe });
      } else {
        const pythonCmd = await this.findPythonExecutable();
        this.logger.info &&
          this.logger.info("Python 可執行文件找到", { pythonCmd });

        const sherpaStatus = await this.checkSherpaInstallation();
        this.logger.info &&
          this.logger.info("Sherpa-ONNX 安裝狀態檢查完成", sherpaStatus);
      }

      this.isInitialized = true;

      // 預初始化模型
      this.preInitializeModels();
      this.logger.info && this.logger.info("Sherpa 管理器啟動初始化完成");
    } catch (error) {
      this.logger.warn &&
        this.logger.warn("Sherpa 啟動初始化失敗，但不影響應用啟動", error);
      this.isInitialized = true;
    }
  }

  async preInitializeModels() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._startSherpaServer();
    return this.initializationPromise;
  }

  async _startSherpaServer() {
    try {
      // GGUF 模型由 llamaManager 負責，sherpa_server.py 不支援 --model-type qwen3_asr_gguf
      const activeModelType = this.databaseManager ? this.databaseManager.getSetting("asr_model_type", "paraformer") : "paraformer";
      if (activeModelType === "qwen3_asr_gguf") {
        this.logger.info && this.logger.info("目前使用 GGUF 模型，跳過 Sherpa 服務器啟動");
        return;
      }

      this.logger.info && this.logger.info("啟動 Sherpa 服務器...");

      // 打包的 sherpa_server.exe 自帶 sherpa-onnx，免檢查系統 Python。
      const _bundled = this.getBundledServerExe();
      if (!(_bundled && fs.existsSync(_bundled))) {
        const status = await this.checkSherpaInstallation();
        if (!status.installed) {
          this.logger.warn &&
            this.logger.warn("Sherpa-ONNX 未安裝，跳過服務器啟動");
          return;
        }
      }

      // 打包後優先用 PyInstaller 的 sherpa_server.exe（免 Python）；開發退回 Python 腳本。
      const bundledExe = this.getBundledServerExe();
      const useBundled = bundledExe && fs.existsSync(bundledExe);

      let command;
      let baseArgs;
      let serverPath;
      if (useBundled) {
        command = bundledExe;
        baseArgs = [];
        serverPath = bundledExe;
      } else {
        command = await this.findPythonExecutable();
        serverPath = this.getSherpaServerPath();
        baseArgs = [serverPath];
      }

      this.logger.info &&
        this.logger.info("Sherpa 服務器配置", {
          mode: useBundled ? "bundled-exe" : "python-script",
          command,
          serverPath,
          serverExists: fs.existsSync(serverPath),
        });

      if (!fs.existsSync(serverPath)) {
        this.logger.error &&
          this.logger.error("Sherpa 服務器未找到，跳過服務器啟動", {
            serverPath,
          });
        return;
      }

      this.setupIsolatedEnvironment();
      const pythonEnv = await this.buildAccelerationEnv();

      return new Promise((resolve) => {
        const modelType = this.databaseManager ? this.databaseManager.getSetting("asr_model_type", "paraformer") : "paraformer";
        const modelPath = this.getModelCachePath(modelType);

        this.serverProcess = spawn(
          command,
          [...baseArgs, "--model-dir", modelPath, "--model-type", modelType],

          {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: pythonEnv,
          }
        );

        let initResponseReceived = false;

        this.serverProcess.stdout.on("data", (data) => {
          const lines = data
            .toString()
            .split("\n")
            .filter((line) => line.trim());

          for (const line of lines) {
            this.logger.debug &&
              this.logger.debug("Sherpa 服務器輸出", { line });
            try {
              const result = JSON.parse(line);

              if (!initResponseReceived) {
                initResponseReceived = true;
                if (result.success) {
                  this.serverReady = true;
                  this.modelsInitialized = true;
                  this._clearModelCache();
                  this.logger.info &&
                    this.logger.info("Sherpa 服務器啟動成功，模型已初始化");
                  // 重送使用者自訂符號（啟動 / 後端重啟後都要補回）
                  if (this.customEmojis && Object.keys(this.customEmojis).length) {
                    this._sendServerCommand({ action: "set_custom_emojis", emojis: this.customEmojis }).catch(() => {});
                  }
                } else {
                  this.logger.error &&
                    this.logger.error("Sherpa 服務器初始化失敗", result);
                }
                resolve();
              }
            } catch (parseError) {
              this.logger.debug &&
                this.logger.debug("Sherpa 服務器非 JSON 輸出", { line });
            }
          }
        });

        this.serverProcess.stderr.on("data", (data) => {
          const errorOutput = data.toString();
          this.logger.error &&
            this.logger.error("Sherpa 服務器錯誤輸出", { errorOutput });
        });

        // 捕獲本進程引用，避免重啟時舊進程的 close handler 清掉新進程
        const proc = this.serverProcess;

        proc.on("close", (code) => {
          this.logger.warn &&
            this.logger.warn("Sherpa 服務器進程退出", { code });
          // 只有當退出的是「目前」進程時才重置（防止舊進程的 close 覆蓋新進程）
          if (this.serverProcess === proc) {
            this.serverProcess = null;
            this.serverReady = false;
            this.modelsInitialized = false;
          }

          if (!initResponseReceived) {
            resolve();
          }
        });

        proc.on("error", (error) => {
          this.logger.error &&
            this.logger.error("Sherpa 服務器進程錯誤", error);
          if (this.serverProcess === proc) {
            this.serverProcess = null;
            this.serverReady = false;
          }

          if (!initResponseReceived) {
            resolve();
          }
        });

        // Sherpa-ONNX 載入更快，30 秒超時應該足夠
        setTimeout(() => {
          if (!initResponseReceived) {
            this.logger.warn &&
              this.logger.warn("Sherpa 服務器啟動超時");
            if (this.serverProcess) {
              this.serverProcess.kill();
            }
            resolve();
          }
        }, 30000);
      });
    } catch (error) {
      this.logger.error && this.logger.error("啟動 Sherpa 服務器異常", error);
    }
  }

  async _sendServerCommand(command) {
    if (!this.serverProcess || !this.serverReady) {
      throw new Error("Sherpa 服務器未就緒");
    }

    // 序列化佇列：stdin/stdout 單一管道、回應沒有請求 id，
    // 一次只能在飛一個請求 —— 否則併發時（串流 feed + 狀態查詢）
    // A 的回應會被同時掛著 listener 的 B 搶走，造成回應錯配。
    const run = () => this._dispatchServerCommand(command);
    const result = (this._commandQueue || Promise.resolve()).then(run, run);
    this._commandQueue = result.catch(() => {}); // 佇列不因單一失敗而中斷
    return result;
  }

  _dispatchServerCommand(command) {
    return new Promise((resolve, reject) => {
      let responseReceived = false;

      const onData = (data) => {
        if (responseReceived) return;

        const lines = data
          .toString()
          .split("\n")
          .filter((line) => line.trim());

        for (const line of lines) {
          try {
            const result = JSON.parse(line);
            responseReceived = true;
            this.serverProcess.stdout.removeListener("data", onData);
            resolve(result);
            return;
          } catch (parseError) {
            // 忽略非 JSON 輸出
          }
        }
      };

      this.serverProcess.stdout.on("data", onData);
      this.serverProcess.stdin.write(JSON.stringify(command) + "\n");

      setTimeout(() => {
        if (!responseReceived) {
          responseReceived = true;
          this.serverProcess.stdout.removeListener("data", onData);
          reject(new Error("服務器響應超時"));
        }
      }, 60000);
    });
  }

  async _stopSherpaServer() {
    if (this.serverProcess) {
      const proc = this.serverProcess;
      try {
        await this._sendServerCommand({ action: "exit" });
      } catch (error) {
        proc.kill();
      }

      // 等待進程完全退出，確保釋放模型檔案鎖
      await new Promise((resolve) => {
        const exitHandler = () => resolve();
        proc.on('exit', exitHandler);
        proc.on('error', exitHandler);
        setTimeout(() => {
          proc.removeListener('exit', exitHandler);
          proc.removeListener('error', exitHandler);
          resolve();
        }, 5000);
      });

      if (this.serverProcess === proc) {
        this.serverProcess = null;
        this.serverReady = false;
        this.modelsInitialized = false;
      }
    }
  }

  async checkSherpaInstallation() {
    // 如果有緩存結果則返回
    if (this.sherpaInstalled !== null) {
      return this.sherpaInstalled;
    }

    // 打包版自帶 sherpa_server.exe（內含 sherpa-onnx），不需要也不該檢查 Python。
    // 注意：transcribeAudio 每次都會呼叫這裡 — 漏了這個分支會讓乾淨機器
    // （沒有 Python）的每一次辨識都誤報「Sherpa-ONNX 未安裝」。
    const bundledExe = this.getBundledServerExe();
    if (bundledExe && fs.existsSync(bundledExe)) {
      this.sherpaInstalled = { installed: true, version: "bundled" };
      return this.sherpaInstalled;
    }

    try {
      const pythonCmd = await this.findPythonExecutable();

      const result = await new Promise((resolve) => {
        const pythonEnv = this.buildPythonEnvironment();

        const checkProcess = spawn(
          pythonCmd,
          ["-c", 'import sherpa_onnx; print("OK")'],
          { env: pythonEnv }
        );

        let output = "";
        let errorOutput = "";

        checkProcess.stdout.on("data", (data) => {
          output += data.toString();
        });

        checkProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        checkProcess.on("close", (code) => {
          if (code === 0 && output.includes("OK")) {
            resolve({ installed: true, working: true });
          } else {
            this.logger.error &&
              this.logger.error("Sherpa-ONNX 檢查失敗", {
                code,
                output,
                errorOutput,
              });
            resolve({
              installed: false,
              working: false,
              error: errorOutput || output,
            });
          }
        });

        checkProcess.on("error", (error) => {
          resolve({ installed: false, working: false, error: error.message });
        });
      });

      this.sherpaInstalled = result;
      return result;
    } catch (error) {
      const errorResult = {
        installed: false,
        working: false,
        error: error.message,
      };
      this.sherpaInstalled = errorResult;
      return errorResult;
    }
  }

  async transcribeAudio(audioBlob, options = {}) {
    // 讀取雲端 ASR 設定
    let cloudAsrEnabled = false;
    let cloudAsrSettings = null;
    if (this.databaseManager) {
      cloudAsrSettings = this.databaseManager.getSetting("cloud_asr_settings", null);
      if (cloudAsrSettings && cloudAsrSettings.enabled) {
        cloudAsrEnabled = true;
      }
    }

    if (cloudAsrEnabled) {
      this.logger.info && this.logger.info("使用雲端服務 ASR 進行轉錄");
      const CloudAsrClient = require("./cloudAsrClient");
      const transcribedText = await CloudAsrClient.transcribe(cloudAsrSettings, audioBlob);
      
      const tempAudioPath = await this.createTempAudioFile(audioBlob);
      let persistedAudioPath = null;
      const saveAudioFiles = this.databaseManager
        ? this.databaseManager.getSetting("save_audio", this.databaseManager.getSetting("save_audio_files", true)) !== false
        : true;
      if ((options && (options.no_persist || options.save_audio === false)) || !saveAudioFiles) {
        this.cleanupTempFile(tempAudioPath).catch(() => {});
      } else {
        persistedAudioPath = this._persistAudioInBackground(tempAudioPath);
      }

      return {
        success: true,
        text: transcribedText.trim(),
        segments: null,
        raw_text: transcribedText,
        confidence: 0.99,
        language: "zh-CN",
        duration: 0,
        audio_path: persistedAudioPath,
      };
    }

    const status = await this.checkSherpaInstallation();
    if (!status.installed) {
      throw new Error("Sherpa-ONNX 未安裝。請先安裝 Sherpa-ONNX。");
    }

    if (!this.serverReady && this.initializationPromise) {
      this.logger.info && this.logger.info("等待 Sherpa 服務器就緒...");
      await this.initializationPromise;
    }

    const tempAudioPath = await this.createTempAudioFile(audioBlob);

    try {
      if (!this.serverReady) {
        throw new Error("Sherpa 服務器未就緒，請稍後重試");
      }

      this.logger.info &&
        this.logger.info("使用 Sherpa 服務器模式進行轉錄");
      const result = await this._sendServerCommand({
        action: "transcribe",
        audio_path: tempAudioPath,
        options: options,
      });

      if (!result.success) {
        throw new Error(result.error || "轉錄失敗");
      }

      // 保存原始錄音（永不丟失），供日後「重新辨識」使用。
      // 路徑先定好、複製放背景做（不擋住結果回傳 → 貼上更快）；
      // 複製完成後才刪暫存檔。
      // 檔案轉錄（逐字稿/SRT）逐段呼叫，no_persist 時不存錄音、只清暫存檔。
      // save_audio === false：使用者關掉「保存錄音檔」→ 不寫磁碟(省 SSD、不留存)，
      // 只清暫存;這筆就沒有 audio_path(之後不能重新辨識,但那是使用者的選擇)。
      let persistedAudioPath = null;
      const saveAudioFiles = this.databaseManager
        ? this.databaseManager.getSetting("save_audio", this.databaseManager.getSetting("save_audio_files", true)) !== false
        : true;
      if ((options && (options.no_persist || options.save_audio === false)) || !saveAudioFiles) {
        this.cleanupTempFile(tempAudioPath).catch(() => {});
      } else {
        persistedAudioPath = this._persistAudioInBackground(tempAudioPath);
      }

      return {
        success: true,
        text: (result.text || "").trim(),
        segments: result.segments, // SRT 模式：逐句時間軸 [{start,end,text}]
        raw_text: result.raw_text,
        confidence: result.confidence || 0.95,
        language: result.language || "zh-CN",
        duration: result.duration || 0,
        audio_path: persistedAudioPath,
      };
    } catch (error) {
      await this.cleanupTempFile(tempAudioPath);
      throw error;
    }
  }

  // 背景持久化錄音：立刻回傳目的路徑，複製與暫存清理非同步完成。
  _persistAudioInBackground(tempAudioPath) {
    try {
      const userDataPath = require("electron").app.getPath("userData");
      const audioDir = path.join(userDataPath, "audio");
      const destPath = path.join(audioDir, `rec_${crypto.randomUUID()}.wav`);
      (async () => {
        try {
          await fs.promises.mkdir(audioDir, { recursive: true });
          await fs.promises.copyFile(tempAudioPath, destPath);
        } catch (e) {
          this.logger.warn && this.logger.warn("保存錄音檔失敗:", e?.message || e);
        } finally {
          this.cleanupTempFile(tempAudioPath).catch(() => {});
        }
      })();
      return destPath;
    } catch (e) {
      this.cleanupTempFile(tempAudioPath).catch(() => {});
      return null;
    }
  }

  // 保留策略（建議 1）：刪掉 audio/ 裡超過 retentionDays 天的錄音檔，避免無限增長。
  // retentionDays <= 0 視為「永久保留」。被刪檔的歷史紀錄仍在,只是「重新辨識」會
  // 提示檔案不存在(既有的優雅處理)。開機時呼叫一次。
  async cleanupOldAudio(retentionDays) {
    try {
      const days = Number(retentionDays);
      if (!days || days <= 0) return { removed: 0 };
      const userDataPath = require("electron").app.getPath("userData");
      const audioDir = path.join(userDataPath, "audio");
      if (!fs.existsSync(audioDir)) return { removed: 0 };
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const files = await fs.promises.readdir(audioDir);
      let removed = 0;
      for (const f of files) {
        if (!f.toLowerCase().endsWith(".wav")) continue;
        const fp = path.join(audioDir, f);
        const st = await fs.promises.stat(fp).catch(() => null);
        if (st && st.mtimeMs < cutoff) {
          await fs.promises.unlink(fp).catch(() => {});
          removed++;
        }
      }
      if (removed && this.logger?.info) this.logger.info(`保留策略：清掉 ${removed} 個超過 ${days} 天的錄音檔`);
      return { removed };
    } catch (e) {
      this.logger?.warn && this.logger.warn("清理舊錄音失敗:", e?.message || e);
      return { removed: 0, error: e?.message };
    }
  }

  async createTempAudioFile(audioBlob) {
    const tempDir = os.tmpdir();
    const filename = `sherpa_audio_${crypto.randomUUID()}.wav`;
    const tempAudioPath = path.join(tempDir, filename);

    this.logger.info && this.logger.info("創建臨時文件:", tempAudioPath);

    let buffer;
    if (audioBlob instanceof ArrayBuffer) {
      buffer = Buffer.from(audioBlob);
    } else if (audioBlob instanceof Uint8Array) {
      buffer = Buffer.from(audioBlob);
    } else if (typeof audioBlob === "string") {
      buffer = Buffer.from(audioBlob, "base64");
    } else if (audioBlob && audioBlob.buffer) {
      buffer = Buffer.from(audioBlob.buffer);
    } else {
      throw new Error(`不支持的音頻數據類型: ${typeof audioBlob}`);
    }

    this.logger.debug && this.logger.debug("緩衝區創建，大小:", buffer.length);

    await fs.promises.writeFile(tempAudioPath, buffer);

    const stats = await fs.promises.stat(tempAudioPath);
    this.logger.info &&
      this.logger.info("臨時音頻文件創建:", {
        path: tempAudioPath,
        size: stats.size,
        isFile: stats.isFile(),
      });

    if (stats.size === 0) {
      throw new Error("音頻文件為空");
    }

    return tempAudioPath;
  }

  async cleanupTempFile(tempAudioPath) {
    try {
      await fs.promises.unlink(tempAudioPath);
    } catch (cleanupError) {
      // 臨時文件清理錯誤不是關鍵問題
    }
  }

  // 直接用既有檔案路徑辨識（給「重新辨識」用，不建暫存、不重複保存）
  async transcribeFilePath(audioPath, options = {}) {
    if (!this.serverReady && this.initializationPromise) {
      await this.initializationPromise;
    }
    if (!this.serverReady) {
      throw new Error("Sherpa 服務器未就緒");
    }
    const result = await this._sendServerCommand({
      action: "transcribe",
      audio_path: audioPath,
      options: options,
    });
    if (!result.success) {
      throw new Error(result.error || "轉錄失敗");
    }
    return {
      success: true,
      text: result.text.trim(),
      raw_text: result.raw_text,
      confidence: result.confidence || 0.95,
      language: result.language || "zh-CN",
    };
  }

  // 把暫存 WAV 複製到永久目錄（userData/audio），回傳路徑；失敗回 null 不影響辨識

  async checkStatus() {
    try {
      this.logger.info && this.logger.info("checkStatus 被調用", { serverReady: this.serverReady });

      if (this.serverReady) {
        const result = await this._sendServerCommand({ action: "status" });
        this.logger.info && this.logger.info("checkStatus 服務器返回", result);
        // 將 Python 返回的 initialized 映射到前端期望的 models_initialized
        return {
          ...result,
          models_initialized: result.initialized,
          server_ready: true,
        };
      } else {
        const installStatus = await this.checkSherpaInstallation();
        const modelStatus = await this.checkModelFiles();

        let error = "Sherpa-ONNX 未安裝";
        if (installStatus.installed) {
          if (!modelStatus.models_downloaded) {
            error = "模型文件未下載，請先下載模型";
          } else {
            error = "Sherpa 服務器正在啟動中...";
          }
        }

        return {
          success: installStatus.installed && modelStatus.models_downloaded,
          error: error,
          installed: installStatus.installed,
          models_downloaded: modelStatus.models_downloaded,
          missing_models: modelStatus.missing_models || [],
          initializing: this.initializationPromise !== null,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        installed: false,
        models_downloaded: false,
      };
    }
  }

  // =====================================================
  // 串流辨識 API
  // =====================================================

  /**
   * 初始化串流辨識會話
   * @param {Object} options - 選項
   * @param {number} options.sampleRate - 採樣率，預設 16000
   * @returns {Promise<{success: boolean, sessionId: string}>}
   */
  async streamingStart(options = {}) {
    const modelStatus = await this.ensureStreamingModelAvailable();
    if (!modelStatus.success) {
      return modelStatus;
    }

    if (!this.serverReady) {
      if (this.initializationPromise) {
        await this.initializationPromise;
      }
      if (!this.serverReady) {
        return { success: false, error: "Sherpa 服務器未就緒" };
      }
    }

    try {
      const sessionId = crypto.randomUUID();
      const result = await this._sendServerCommand({
        action: "stream_init",
        session_id: sessionId,
        options: {
          sample_rate: options.sampleRate || 16000,
          convert_ordinal_numbers: this.databaseManager
            ? this.databaseManager.getSetting("convert_ordinal_numbers", true)
            : false,
        },
      });

      if (result.success) {
        this.activeStreamSession = sessionId;
        this.logger.info && this.logger.info("串流會話已創建:", sessionId);
      }

      return result;
    } catch (error) {
      this.logger.error && this.logger.error("創建串流會話失敗:", error);
      return { success: false, error: error.message };
    }
  }

  // ===== 邊錄邊算（precog）=====
  // 錄音進行中先把已講完的段落解碼掉（同一顆 Paraformer，精度零損失），
  // 停止時 transcribeAudio 帶 use_precog 取用結果 → 長講停止延遲降一個數量級。
  // 操作模式：對文字做純轉換（簡繁互轉等），走 sherpa server 的 opencc
  async transformText(text, mode) {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "text_transform", mode, text });
  }

  // 操作模式「念出來」：Edge 神經網路語音，回傳 base64 MP3
  async tts(text, voice = "zh-TW-HsiaoChenNeural", rate = "+0%") {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "tts", text, voice, rate });
  }

  // 語音符號：把使用者自訂的 {觸發詞: 符號} 送進後端（即時生效）
  async setCustomEmojis(emojis) {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "set_custom_emojis", emojis: emojis || {} });
  }
  // 取得內建符號對照表（給設定頁顯示）
  async getEmojiMap() {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "get_emoji_map" });
  }

  async precogStart(profile = "standard") {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "precog_start", profile });
  }

  async precogFeed(audioB64) {
    if (!this.serverReady) return { success: false, error: "服務器未就緒" };
    return await this._sendServerCommand({ action: "precog_feed", audio_data: audioB64 });
  }

  async precogAbort() {
    if (!this.serverReady) return { success: true };
    try {
      return await this._sendServerCommand({ action: "precog_abort" });
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 發送音頻數據到串流會話
   * @param {string} audioData - Base64 編碼的音頻數據
   * @param {boolean} isFinal - 是否為最後一段
   * @returns {Promise<{success: boolean, partialText: string}>}
   */
  async streamingFeed(audioData, isFinal = false) {
    if (!this.activeStreamSession) {
      return { success: false, error: "沒有活動的串流會話" };
    }

    if (!this.serverReady) {
      return { success: false, error: "Sherpa 服務器未就緒" };
    }

    try {
      const result = await this._sendServerCommand({
        action: "stream_feed",
        session_id: this.activeStreamSession,
        audio_data: audioData,
        is_final: isFinal,
      });

      return result;
    } catch (error) {
      this.logger.error && this.logger.error("發送串流數據失敗:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 結束串流會話並獲取最終結果
   * @returns {Promise<{success: boolean, finalText: string, rawText: string}>}
   */
  async streamingEnd() {
    if (!this.activeStreamSession) {
      return { success: false, error: "沒有活動的串流會話" };
    }

    if (!this.serverReady) {
      return { success: false, error: "Sherpa 服務器未就緒" };
    }

    try {
      const result = await this._sendServerCommand({
        action: "stream_end",
        session_id: this.activeStreamSession,
      });

      this.activeStreamSession = null;
      this.logger.info && this.logger.info("串流會話已結束:", result);

      return result;
    } catch (error) {
      this.logger.error && this.logger.error("結束串流會話失敗:", error);
      this.activeStreamSession = null;
      return { success: false, error: error.message };
    }
  }

  /**
   * 預載串流模型以減少首次延遲
   * @returns {Promise<{success: boolean}>}
   */
  async preloadStreamingModel() {
    const modelStatus = await this.ensureStreamingModelAvailable();
    if (!modelStatus.success) {
      return modelStatus;
    }

    if (!this.serverReady) {
      if (this.initializationPromise) {
        await this.initializationPromise;
      }
      if (!this.serverReady) {
        return { success: false, error: "Sherpa 服務器未就緒" };
      }
    }

    try {
      const result = await this._sendServerCommand({
        action: "init_streaming",
      });

      this.logger.info && this.logger.info("串流模型預載結果:", result);
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("預載串流模型失敗:", error);
      return { success: false, error: error.message };
    }
  }

  // =====================================================
  // 熱詞功能 API
  // =====================================================

  /**
   * 取得熱詞設定
   * @returns {Promise<{success: boolean, enabled: boolean, score: number, words: string[]}>}
   */
  async getHotwords() {
    // 直接讀取 hotwords.txt（不依賴 sherpa server，GGUF 模式也能用）
    // 格式與 sherpa_server.py 一致：每行一個詞，# 開頭為註解
    try {
      const fs = require("fs");
      const path = require("path");
      const hotwordsPath = path.join(this.getUserDataPath(), "hotwords.txt");
      let words = [];
      if (fs.existsSync(hotwordsPath)) {
        const content = fs.readFileSync(hotwordsPath, "utf8");
        words = content.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
      }
      return { success: true, enabled: true, score: 1.5, words };
    } catch (error) {
      this.logger.error && this.logger.error("取得熱詞設定失敗:", error);
      return { success: false, error: error.message, words: [] };
    }
  }

  /**
   * 設定熱詞
   * @param {Object} config - 熱詞設定
   * @param {boolean} config.enabled - 是否啟用熱詞
   * @param {number} config.score - 熱詞提升分數 (1.0-3.0)
   * @param {string[]} config.words - 熱詞列表
   * @returns {Promise<{success: boolean}>}
   */
  async setHotwords(config) {
    // 直接寫入 hotwords.txt（不依賴 sherpa server，GGUF 模式也能用）
    // sherpa server 載入模型時會自動讀取此檔；重啟辨識後生效。
    try {
      const fs = require("fs");
      const path = require("path");
      const hotwordsPath = path.join(this.getUserDataPath(), "hotwords.txt");
      const words = Array.isArray(config.words) ? config.words.map(w => String(w).trim()).filter(Boolean) : [];
      const content = "# 熱詞列表 - 每行一個詞彙\n" + words.join("\n") + (words.length ? "\n" : "");
      fs.mkdirSync(path.dirname(hotwordsPath), { recursive: true });
      fs.writeFileSync(hotwordsPath, content, "utf8");
      this.logger.info && this.logger.info(`儲存 ${words.length} 個熱詞到 ${hotwordsPath}`);
      // 若 sherpa server 在線，同步套用即時生效
      if (this.serverReady) {
        try {
          await this._sendServerCommand({
            action: "set_hotwords",
            enabled: config.enabled !== false,
            score: config.score || 1.5,
            words,
          });
        } catch (e) { /* 同步失敗不影響本地儲存 */ }
      }
      // 雙向同步：設定-熱詞變更 → 同步到 AI 風格包的 custom_words
      try {
        if (this.databaseManager) {
          this.databaseManager.setSetting("custom_words", words);
        }
      } catch (e) { /* 同步失敗不影響熱詞儲存 */ }
      return { success: true, words };
    } catch (error) {
      this.logger.error && this.logger.error("設定熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 新增單一熱詞
   * @param {string} word - 要新增的熱詞
   * @returns {Promise<{success: boolean, words: string[]}>}
   */
  async addHotword(word) {
    if (!word || typeof word !== "string" || word.trim() === "") {
      return { success: false, error: "熱詞不能為空" };
    }

    try {
      // 先取得現有熱詞設定
      const currentConfig = await this.getHotwords();
      if (!currentConfig.success) {
        return currentConfig;
      }

      const words = currentConfig.words || [];
      const trimmedWord = word.trim();

      // 檢查是否已存在
      if (words.includes(trimmedWord)) {
        return { success: false, error: "熱詞已存在" };
      }

      // 加入新熱詞
      words.push(trimmedWord);

      // 設定新的熱詞列表
      const result = await this.setHotwords({
        enabled: currentConfig.enabled !== false,
        score: currentConfig.score || 1.5,
        words: words,
      });

      if (result.success) {
        return { success: true, words: words };
      }
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("新增熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 刪除單一熱詞
   * @param {string} word - 要刪除的熱詞
   * @returns {Promise<{success: boolean, words: string[]}>}
   */
  async removeHotword(word) {
    if (!word || typeof word !== "string") {
      return { success: false, error: "熱詞不能為空" };
    }

    try {
      // 先取得現有熱詞設定
      const currentConfig = await this.getHotwords();
      if (!currentConfig.success) {
        return currentConfig;
      }

      const words = currentConfig.words || [];
      const trimmedWord = word.trim();

      // 檢查是否存在
      const index = words.indexOf(trimmedWord);
      if (index === -1) {
        return { success: false, error: "熱詞不存在" };
      }

      // 移除熱詞
      words.splice(index, 1);

      // 設定新的熱詞列表
      const result = await this.setHotwords({
        enabled: currentConfig.enabled !== false,
        score: currentConfig.score || 1.5,
        words: words,
      });

      if (result.success) {
        return { success: true, words: words };
      }
      return result;
    } catch (error) {
      this.logger.error && this.logger.error("刪除熱詞失敗:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = SherpaManager;
