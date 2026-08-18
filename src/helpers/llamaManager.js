const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const LLAMA_MODEL_CONFIG = {
  name: "qwen3-asr-1.7b-gguf",
  expected_size: (1223 + 211) * 1024 * 1024,
  required_files: ["Qwen3-ASR-1.7B-Q4_K_M.gguf"],
  url: "https://huggingface.co/foryoung365/Qwen3-ASR-1.7B-Q4_K_M-GGUF/resolve/main/Qwen3-ASR-1.7B-Q4_K_M.gguf",
  mmproj_url: "https://huggingface.co/foryoung365/Qwen3-ASR-1.7B-Q4_K_M-GGUF/resolve/main/mmproj-Qwen3-ASR-1.7B-Q4_K_M.gguf",
  binary_url: "https://github.com/ggml-org/llama.cpp/releases/download/b9562/llama-b9562-bin-win-cuda-12.4-x64.zip",
  binary_filename: "llama-b9562-bin-win-cuda-12.4-x64.zip",
  cudart_url: "https://github.com/ggml-org/llama.cpp/releases/download/b9562/cudart-llama-bin-win-cuda-12.4-x64.zip",
  cudart_filename: "cudart-llama-bin-win-cuda-12.4-x64.zip",
  // 每個檔案的最小完整大小（bytes）——用於判斷「部分下載殘留」不算完成。
  // 採用實際檔案大小的 95% 作為下限，避免檔案大小微小差異造成誤判刪除。
  file_sizes: {
    "Qwen3-ASR-1.7B-Q4_K_M.gguf": Math.round(1282435168 * 0.95),
    "mmproj-Qwen3-ASR-1.7B-Q4_K_M.gguf": Math.round(221032992 * 0.95),
  },
};

class LlamaManager {
  constructor(logger = null, options = {}) {
    this.logger = logger || console;
    this.platform = options.platform || process.platform;
    this.userDataPath = options.userDataPath || null;
    this.projectRoot = options.projectRoot || path.join(__dirname, "..", "..");
    this.spawnFn = options.spawnFn || spawn;
    this.httpsGet = options.httpsGet || https.get;
    this.databaseManager = null;
    this.serverProcess = null;
    this.accelerationDetector = null;
    this.serverReady = false;
    this.initializationPromise = null;
  }

  setDatabaseManager(databaseManager) {
    this.databaseManager = databaseManager;
  }

  getModelConfig() {
    return LLAMA_MODEL_CONFIG;
  }

  getUserDataPath() {
    if (this.userDataPath) return this.userDataPath;
    try {
      return require("electron").app.getPath("userData");
    } catch (e) {
      return path.join(os.homedir(), ".soda2");
    }
  }

  getModelCachePath() {
    // 優先使用自訂模型目錄；否則用 userData/models
    const name = LLAMA_MODEL_CONFIG.name;
    const defaultModelDir = path.join(this.getUserDataPath(), "models", name);
    if (this.databaseManager) {
      const customDir = this.databaseManager.getSetting("custom_model_dir", "");
      if (customDir && !fs.existsSync(defaultModelDir)) {
        return path.join(customDir, name);
      }
    }
    return defaultModelDir;
  }

  getBinaryDir() {
    return path.join(this.getUserDataPath(), "llama", "bin");
  }

  getLlamaServerPath() {
    const exe = this.platform === "win32" ? "llama-server.exe" : "llama-server";
    return path.join(this.getBinaryDir(), exe);
  }

  downloadFile(url, destPath, progressCallback = null) {
    // 寫入 .part 暫存檔，完成後 rename 成目標檔。
    // 避免直接開目標檔時遇到 EPERM（殘留檔案被 Defender/ACL 鎖定），
    // 也讓部分下載的殘留檔不會被當成「已存在」。
    const partPath = destPath + ".part";
    this._forceDeletePath(partPath);
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(partPath);
      const finalize = (err) => {
        file.close(() => {
          if (err) {
            this._forceDeletePath(partPath);
            reject(err);
            return;
          }
          this._forceDeletePath(destPath);
          try {
            fs.renameSync(partPath, destPath);
            resolve();
          } catch (renameErr) {
            this._forceDeletePath(partPath);
            reject(renameErr);
          }
        });
      };
      const request = this.httpsGet(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          this._forceDeletePath(partPath);
          const location = response.headers.location;
          const next = location.startsWith("http") ? location : new URL(location, url).href;
          this.downloadFile(next, destPath, progressCallback).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          finalize(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }
        const total = Number(response.headers["content-length"] || 0);
        let downloaded = 0;
        response.on("data", (chunk) => {
          downloaded += chunk.length;
          if (progressCallback && total > 0) {
            progressCallback({ downloaded, total, progress: Math.round((downloaded / total) * 1000) / 10 });
          }
        });
        response.pipe(file);
        file.on("finish", () => finalize(null));
      });
      request.on("error", (error) => finalize(error));
      file.on("error", (error) => {
        request.destroy();
        finalize(error);
      });
    });
  }

  extractZip(zipPath, targetDir) {
    return new Promise((resolve, reject) => {
      if (this.platform === "win32") {
        const { execFile } = require("child_process");
        execFile("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force`], { windowsHide: true }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      } else {
        const { execFile } = require("child_process");
        execFile("unzip", ["-o", zipPath, "-d", targetDir], { windowsHide: true }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }
    });
  }

  _forceDeletePath(filePath) {
    try { fs.unlinkSync(filePath); return; } catch (e) { /* continue */ }
    try { fs.chmodSync(filePath, 0o777); fs.unlinkSync(filePath); return; } catch (e) { /* continue */ }
    if (this.platform === "win32") {
      try {
        execSync(`attrib -R "${filePath}" & del /F /Q /A "${filePath}"`, { windowsHide: true, stdio: "ignore", timeout: 10000 });
        return;
      } catch (e) { /* continue */ }
      try {
        execSync(`takeown /F "${filePath}" & icacls "${filePath}" /grant Everyone:F & del /F /Q /A "${filePath}"`, { windowsHide: true, stdio: "ignore", timeout: 10000 });
      } catch (e) { /* give up */ }
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
        if (e.code === "EPERM") {
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
      if (e.code === "ENOENT") return;
      this.logger.warn && this.logger.warn(`無法刪除目錄 ${dirPath}: ${e.message}`);
    }
  }

  _getExistingFileSize(filePath) {
    if (!fs.existsSync(filePath)) {
      this._forceDeletePath(filePath);
      return 0;
    }
    try {
      const st = fs.statSync(filePath);
      return st.size > 0 ? st.size : 0;
    } catch (e) {
      if (e.code === "EPERM") {
        this.logger.warn && this.logger.warn(`檔案權限異常，嘗試強制清除: ${filePath}`);
        this._forceDeletePath(filePath);
        return 0;
      }
      throw e;
    }
  }

  async ensureLlamaBinary(progressCallback = null) {
    const binPath = this.getLlamaServerPath();
    if (this._getExistingFileSize(binPath) > 0) {
      return { success: true, binaryPath: binPath, already_downloaded: true };
    }
    const config = this.getModelConfig();
    const zipPath = path.join(this.getBinaryDir(), config.binary_filename);
    await fs.promises.mkdir(this.getBinaryDir(), { recursive: true });
    await this.downloadFile(config.binary_url, zipPath, (p) => {
      if (progressCallback) progressCallback({ stage: "downloading-binary", model: "asr", progress: p.progress, overall_progress: Math.round(p.progress / 2) });
    });
    await this.extractZip(zipPath, this.getBinaryDir());
    this._forceDeletePath(zipPath);
    if (!fs.existsSync(binPath)) {
      throw new Error("llama.cpp 二進位解壓後未找到 llama-server");
    }
    if (progressCallback) {
      progressCallback({ stage: "finished", model: "asr", progress: 100, overall_progress: 50 });
    }
    return { success: true, binaryPath: binPath };
  }

  // CUDA 二進位（llama-b9562-bin-win-cuda）只含 ggml-cuda.dll，
  // 執行時還需要 cudart/cublas runtime DLL，官方放在獨立 zip 內。
  // 缺失時 llama-server 會退到純 CPU 模式。
  async ensureCudaRuntime(progressCallback = null) {
    const config = this.getModelConfig();
    const binDir = this.getBinaryDir();
    const cudartPath = path.join(binDir, "cudart64_12.dll");
    if (this._getExistingFileSize(cudartPath) > 0) {
      return { success: true, already_downloaded: true };
    }
    const zipPath = path.join(binDir, config.cudart_filename);
    await this.downloadFile(config.cudart_url, zipPath, (p) => {
      if (progressCallback) {
        progressCallback({ stage: "downloading-cudart", model: "asr", progress: p.progress, overall_progress: Math.round(p.progress / 2) });
      }
    });
    await this.extractZip(zipPath, binDir);
    this._forceDeletePath(zipPath);
    const required = ["cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"];
    for (const f of required) {
      if (this._getExistingFileSize(path.join(binDir, f)) <= 0) {
        return { success: false, error: `CUDA runtime DLL 缺失: ${f}` };
      }
    }
    return { success: true };
  }

  async ensureModelAvailable(progressCallback = null) {
    const status = await this.checkModelFiles();
    if (status.models_downloaded) {
      return { success: true, already_downloaded: true, model_path: status.details.model_path };
    }
    const config = this.getModelConfig();
    const targetDir = this.getModelCachePath();
    if (fs.existsSync(targetDir)) {
      this._removeDirectoryRecursive(targetDir);
    }
    await fs.promises.mkdir(targetDir, { recursive: true });
    let overallTotal = config.expected_size;
    let overallDownloaded = 0;
    const files = [];
    for (const f of config.required_files) files.push(f);
    if (config.mmproj_url) files.push(path.basename(config.mmproj_url));
    for (const filename of files) {
      const dest = path.join(targetDir, filename);
      const expectedSize = config.file_sizes && config.file_sizes[filename];
      const existing = this._getExistingFileSize(dest);
      if (existing > 0 && (!expectedSize || existing >= expectedSize)) {
        overallDownloaded += existing;
        continue;
      }
      if (existing > 0) {
        this._forceDeletePath(dest);
      }
      const url = filename.startsWith("mmproj")
        ? config.mmproj_url
        : config.url;
      await this.downloadFile(url, dest, (p) => {
        const currentOverall = overallDownloaded + p.downloaded;
        const pct = Math.min(99, Math.round((currentOverall / overallTotal) * 100));
        if (progressCallback) {
          progressCallback({ stage: "downloading", model: "asr", progress: pct, overall_progress: Math.round(50 + pct / 2) });
        }
      });
      const postSize = this._getExistingFileSize(dest);
      if (postSize === 0 || (expectedSize && postSize < expectedSize)) {
        this._forceDeletePath(dest);
        throw new Error(`下載的模型檔案不完整（${filename} 預期 ${expectedSize} bytes，實際 ${postSize} bytes）`);
      }
      overallDownloaded += postSize;
    }
    if (progressCallback) {
      progressCallback({ stage: "finished", model: "asr", progress: 100, overall_progress: 100 });
    }
    return { success: true, model_path: targetDir };
  }

  _isFileComplete(filePath, expectedSize) {
    const sz = this._getExistingFileSize(filePath);
    if (sz <= 0) return false;
    if (!expectedSize) return true;
    return sz >= expectedSize;
  }

  async checkModelFiles() {
    try {
      const modelPath = this.getModelCachePath();
      if (!fs.existsSync(modelPath)) {
        return {
          success: true,
          models_downloaded: false,
          missing_models: ["asr"],
          directory_exists: false,
          details: { model_path: modelPath, missing_files: [] },
        };
      }
      const config = this.getModelConfig();
      const missingFiles = [];
      for (const f of config.required_files) {
        if (!this._isFileComplete(path.join(modelPath, f), config.file_sizes && config.file_sizes[f])) missingFiles.push(f);
      }
      if (config.mmproj_url) {
        const m = path.basename(config.mmproj_url);
        if (!this._isFileComplete(path.join(modelPath, m), config.file_sizes && config.file_sizes[m])) missingFiles.push(m);
      }
      const allDownloaded = missingFiles.length === 0;
      return {
        success: true,
        models_downloaded: allDownloaded,
        missing_models: allDownloaded ? [] : ["asr"],
        directory_exists: true,
        details: { model_path: modelPath, missing_files: missingFiles },
      };
    } catch (error) {
      return { success: false, error: error.message, models_downloaded: false, missing_models: ["asr"], details: {} };
    }
  }

  async getDownloadProgress() {
    try {
      const config = this.getModelConfig();
      const modelPath = this.getModelCachePath();
      if (!fs.existsSync(modelPath)) {
        return { success: true, overall_progress: 0, models: { asr: { progress: 0, downloaded: 0, total: config.expected_size } } };
      }
      const mainFiles = [...config.required_files];
      if (config.mmproj_url) mainFiles.push(path.basename(config.mmproj_url));
      let fileSize = 0;
      for (const f of mainFiles) {
        const sz = this._getExistingFileSize(path.join(modelPath, f));
        if (sz > 0) fileSize += sz;
      }
      const progress = Math.min(100, (fileSize / config.expected_size) * 100);
      return {
        success: true,
        overall_progress: Math.round(progress * 10) / 10,
        models: { asr: { progress: Math.round(progress * 10) / 10, downloaded: fileSize, total: config.expected_size } },
      };
    } catch (error) {
      return { success: false, error: error.message, overall_progress: 0, models: {} };
    }
  }

  async deleteModelFiles() {
    const targetDir = this.getModelCachePath();
    if (fs.existsSync(targetDir)) {
      this._removeDirectoryRecursive(targetDir);
    }
    return { success: true };
  }

  getServerPort() {
    this.serverPort = this.serverPort || 8234;
    return this.serverPort;
  }

  async _waitForServerReady(timeoutMs = 60000) {
    const port = this.getServerPort();
    const deadline = Date.now() + timeoutMs;
    const http = require("http");
    const getFn = (this.httpsGet && this.httpsGet !== require("https").get) ? this.httpsGet : http.get;
    while (Date.now() < deadline) {
      try {
        const ok = await new Promise((resolve) => {
          const req = getFn({ host: "127.0.0.1", port, path: "/health", timeout: 1000 }, (res) => {
            if (res && res.resume) res.resume();
            resolve(res && res.statusCode === 200);
          });
          if (req && req.on) {
            req.on("error", () => resolve(false));
            req.on("timeout", () => { if (req.destroy) req.destroy(); resolve(false); });
          }
        });
        if (ok) return true;
      } catch (e) { /* retry */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  // 解碼音訊需要 ffprobe/ffmpeg。搜尋順序：llama 目錄 → 常見安裝路徑 → 系統 PATH。
  async _findFfmpeg() {
    const candidates = [
      path.join(this.getBinaryDir(), "ffprobe.exe"),
      path.join(this.getBinaryDir(), "ffmpeg", "bin", "ffprobe.exe"),
      "C:\\ffmpeg\\bin\\ffprobe.exe",
      "C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe",
      "C:\\Program Files\\Gyan.FFmpeg\\bin\\ffprobe.exe",
    ];
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const wingetRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
    if (fs.existsSync(wingetRoot)) {
      try {
        for (const entry of fs.readdirSync(wingetRoot)) {
          if (entry.toLowerCase().includes("ffmpeg")) {
            const pkg = path.join(wingetRoot, entry);
            const recurse = (dir) => {
              try {
                for (const sub of fs.readdirSync(dir)) {
                  if (sub.toLowerCase() === "ffprobe.exe") {
                    candidates.push(path.join(dir, sub));
                  }
                  const full = path.join(dir, sub);
                  if (fs.statSync(full).isDirectory()) recurse(full);
                }
              } catch (e) { /* ignore */ }
            };
            recurse(pkg);
          }
        }
      } catch (e) { /* ignore */ }
    }
    for (const c of candidates) {
      if (fs.existsSync(c)) return { success: true, ffmpegDir: path.dirname(c) };
    }
    try {
      const { execFileSync } = require("child_process");
      execFileSync("ffprobe", ["-version"], { windowsHide: true, stdio: "ignore" });
      return { success: true, ffmpegDir: null };
    } catch (e) {
      return { success: false, error: "找不到 ffmpeg/ffprobe，請安裝 FFmpeg 或下載靜態 build" };
    }
  }

  async ensureFfmpegAvailable() {
    const result = await this._findFfmpeg();
    if (result.success) return result;
    const ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
    const zipPath = path.join(this.getBinaryDir(), "ffmpeg-release-essentials.zip");
    await fs.promises.mkdir(this.getBinaryDir(), { recursive: true });
    await this.downloadFile(ffmpegUrl, zipPath);
    await this.extractZip(zipPath, path.join(this.getBinaryDir(), "ffmpeg"));
    this._forceDeletePath(zipPath);
    const ffmpegRoot = path.join(this.getBinaryDir(), "ffmpeg");
    const binDir = path.join(ffmpegRoot, "bin");
    const probe = path.join(binDir, "ffprobe.exe");
    if (!fs.existsSync(probe)) {
      // 有些 build 解壓結構是 ffmpeg-x.x-full_build/bin/ffprobe.exe
      let entries;
      try {
        entries = fs.readdirSync(ffmpegRoot);
      } catch (e) {
        entries = [];
      }
      const subdir = entries[0];
      if (subdir) {
        const nested = path.join(ffmpegRoot, subdir, "bin", "ffprobe.exe");
        if (fs.existsSync(nested)) {
          await fs.promises.mkdir(binDir, { recursive: true });
          for (const f of ["ffprobe.exe", "ffmpeg.exe"]) {
            const src = path.join(ffmpegRoot, subdir, "bin", f);
            if (fs.existsSync(src)) await fs.promises.copyFile(src, path.join(binDir, f));
          }
        }
      }
    }
    if (!fs.existsSync(path.join(binDir, "ffprobe.exe"))) {
      return { success: false, error: "下載 FFmpeg 後仍找不到 ffprobe.exe" };
    }
    return { success: true, ffmpegDir: binDir };
  }

  async startServer() {
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this._startServerInternal().catch((err) => {
      this.initializationPromise = null;
      throw err;
    });
    return this.initializationPromise;
  }

  async _startServerInternal() {
    if (this.serverProcess) return;
    const binaryStatus = await this.ensureLlamaBinary();
    const modelStatus = await this.ensureModelAvailable();
    if (!modelStatus.success) {
      throw new Error("模型未下載，無法啟動 llama-server");
    }
    // llama-server 解碼音訊需要 ffprobe/ffmpeg 在 PATH 或同目錄
    await this.ensureFfmpegAvailable();
    const config = this.getModelConfig();
    const args = ["-m", path.join(modelStatus.model_path, config.required_files[0])];
    if (config.mmproj_url) {
      args.push("--mmproj", path.join(modelStatus.model_path, path.basename(config.mmproj_url)));
    }
    args.push("--port", String(this.getServerPort()));
    args.push("--host", "127.0.0.1");
    args.push("--ctx-size", "4096");
    // 依 asr_acceleration 設定決定 GPU 加速（自動 / CPU / GPU）
    const acceleration = this.databaseManager
      ? this.databaseManager.getSetting("asr_acceleration", "auto")
      : "auto";
    const det = this.accelerationDetector || (this.accelerationDetector = new (require("./acceleration"))());
    const resolved = await det.resolveForEngine("llama", acceleration);
    if (resolved.ngl) {
      const cudaStatus = await this.ensureCudaRuntime();
      if (cudaStatus.success) {
        args.push("-ngl", "999");
        this.logger.info && this.logger.info("llama-server 啟用 GPU 加速（CUDA）");
      } else {
        this.logger.warn && this.logger.warn("CUDA runtime 不可用，llama-server 將以 CPU 運行:", cudaStatus.error);
      }
    } else {
      this.logger.info && this.logger.info("llama-server 以 CPU 模式運行");
    }
    if (resolved.warning) {
      this.logger.warn && this.logger.warn(resolved.warning);
    }

    const spawnEnv = Object.assign({}, process.env);
    const ffmpegDir = (await this._findFfmpeg()).ffmpegDir;
    if (ffmpegDir) {
      spawnEnv.PATH = ffmpegDir + path.delimiter + (spawnEnv.PATH || "");
    }
    // 將 ffprobe/ffmpeg 複製到 llama-server 同目錄（Windows 同目錄優先搜尋）
    if (ffmpegDir) {
      for (const f of ["ffprobe.exe", "ffmpeg.exe"]) {
        const src = path.join(ffmpegDir, f);
        if (fs.existsSync(src) && !fs.existsSync(path.join(path.dirname(binaryStatus.binaryPath), f))) {
          try { fs.copyFileSync(src, path.join(path.dirname(binaryStatus.binaryPath), f)); } catch (e) { /* ignore */ }
        }
      }
    }

    this.serverProcess = this.spawnFn(binaryStatus.binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: spawnEnv,
    });

    this.serverProcess.stdout && this.serverProcess.stdout.on("data", (data) => {
      this.logger.debug && this.logger.debug("llama-server stdout", { line: data.toString() });
    });
    this.serverProcess.stderr && this.serverProcess.stderr.on("data", (data) => {
      const text = data.toString();
      this.logger.debug && this.logger.debug("llama-server stderr", { line: text });
      if (text.includes("error") || text.includes("Error")) {
        this.logger.warn && this.logger.warn("llama-server 錯誤輸出", { text });
      }
    });
    const currentProc = this.serverProcess;
    this.serverProcess.on("close", (code) => {
      this.logger.warn && this.logger.warn("llama-server 進程退出", { code });
      if (this.serverProcess === currentProc) {
        this.serverProcess = null;
        this.serverReady = false;
      }
    });

    const ready = await this._waitForServerReady(120000);
    if (!ready) {
      this.logger.error && this.logger.error("llama-server 啟動超時");
      this.serverProcess.kill();
      this.serverProcess = null;
      throw new Error("llama-server 啟動超時（120 秒）");
    }
    this.serverReady = true;
    this.initializationPromise = null;
    this.logger.info && this.logger.info("llama-server 已就緒");
  }

  async stopServer() {
    this.initializationPromise = null;
    if (this.serverProcess) {
      try {
        this.serverProcess.kill();
      } catch (e) { /* ignore */ }
      this.serverProcess = null;
      this.serverReady = false;
    }
  }

  async restartServer() {
    try {
      await this.stopServer();
      await this.startServer();
      return { success: true, message: "llama-server 重啟成功" };
    } catch (error) {
      this.logger.error && this.logger.error("重啟 llama-server 失敗:", error);
      return { success: false, error: error.message };
    }
  }

  _persistAudio(blob) {
    try {
      const userDataPath = this.getUserDataPath();
      const audioDir = path.join(userDataPath, "audio");
      const destPath = path.join(audioDir, `rec_${require("crypto").randomUUID()}.wav`);
      (async () => {
        try {
          await fs.promises.mkdir(audioDir, { recursive: true });
          await fs.promises.writeFile(destPath, Buffer.from(blob));
        } catch (e) {
          this.logger.warn && this.logger.warn("保存錄音檔失敗:", e?.message || e);
        }
      })();
      return destPath;
    } catch (e) {
      this.logger.warn && this.logger.warn("保存錄音檔失敗:", e?.message || e);
      return null;
    }
  }

  // 清理 Qwen3-ASR 的輸出標記：模型會回傳 `language Chinese<asr_text>...` 之類的前綴，
  // 以及可能的 `<|endofasr|>` 尾綴。只保留實際轉錄文字。
  _cleanAsrText(rawText) {
    if (!rawText) return "";
    let text = rawText.trim();
    const asrIdx = text.indexOf("<asr_text>");
    if (asrIdx !== -1) {
      text = text.slice(asrIdx + "<asr_text>".length);
    }
    const endIdx = text.indexOf("<|endofasr|>");
    if (endIdx !== -1) {
      text = text.slice(0, endIdx);
    }
    text = text.replace(/<\|endoftext\|>/g, "").trim();
    return text;
  }

  _convertOrdinals(text) {
    if (!text) return text;
    const cnNum = { "零": "0", "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9" };
    // 類別 1：一點X 連續編號
    const dianMatches = [...text.matchAll(/一點([零一二三四五六七八九])/g)];
    if (dianMatches.length >= 2) {
      let out = text;
      for (let i = dianMatches.length - 1; i >= 0; i--) {
        const m = dianMatches[i];
        const n = cnNum[m[1]];
        out = out.slice(0, m.index) + "1." + n + out.slice(m.index + m[0].length);
      }
      return out.replace(/(?<=1\.[0-9])[，,、；;]+(?=1\.[0-9])/g, " ");
    }
    // 類別 2：一、二、三 列表
    const inWord = (start) => {
      const before1 = text.slice(Math.max(0, start - 1), start);
      const before2 = text.slice(Math.max(0, start - 2), start);
      return (before1 && "第星期週".includes(before1)) || before2 === "星期";
    };
    const itemMs = [...text.matchAll(/([一二三四五六七八九十])[、，,；;]/g)].filter(
      (m) => !inWord(m.index)
    );
    if (itemMs.length >= 2) {
      const lastEnd = itemMs[itemMs.length - 1].index + itemMs[itemMs.length - 1][0].length;
      const tailSlice = text.slice(lastEnd);
      const tailM = tailSlice.match(/^\s*([一二三四五六七八九十])\s*[。！？!?]?\s*$/);
      let tail = null;
      if (tailM) {
        const tStart = lastEnd + tailM.index + tailM[0].indexOf(tailM[1]);
        if (!inWord(tStart)) {
          tail = [tStart, tailM[1]];
        }
      }
      const starts = itemMs.map((m) => [m.index, m[1]]);
      if (tail) starts.push(tail);
      if (starts.filter(([, c]) => cnNum[c]).length < 2) return text;
      const regionEnd = tail ? tail[0] + 1 : lastEnd;
      const chars = [...text];
      for (let i = itemMs[0].index; i < regionEnd; i++) {
        if ("、，,；;".includes(chars[i])) chars[i] = " ";
      }
      for (const [i, c] of starts) {
        const n = cnNum[c];
        if (n) chars[i] = n + ".";
      }
      return chars.join("").replace(/ +/g, " ").trim();
    }
    return text;
  }

  async transcribeAudio(audioBlob, options = {}) {
    try {
      if (!this.serverReady) {
        await this.startServer();
      }
      const port = this.getServerPort();
      const http = require("http");
      const b64 = Buffer.from(audioBlob).toString("base64");

      // 熱詞：從 hotwords.txt 讀取（與 sherpa 共用同一來源），加入轉錄 prompt 影響辨識
      let hotwordsHint = "";
      try {
        const fs = require("fs");
        const path = require("path");
        const hotwordsPath = path.join(this.getUserDataPath(), "hotwords.txt");
        if (fs.existsSync(hotwordsPath)) {
          const words = fs.readFileSync(hotwordsPath, "utf8")
            .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
          if (words.length) {
            hotwordsHint = " Pay attention to these terms: " + words.join(", ") + ".";
          }
        }
      } catch (e) {
        this.logger.warn && this.logger.warn("讀取熱詞失敗:", e.message || e);
      }

      // PoC 確認：input_audio.data 必須是純 base64（無 data: 前綴），format 用 wav
      const payload = JSON.stringify({
        messages: [
          { role: "system", content: "You are an advanced multilingual Speech-to-Text model. Accurately transcribe the audio into text in its original spoken language. Preserve English words and proper nouns (brands, names, technical terms) exactly as spoken — do NOT transliterate them into Chinese. Ignore background noise, filler words, and stutters where possible, and format the final output with correct grammar and capitalization." },
          { role: "user", content: [
            { type: "text", text: "Transcribe the audio." + hotwordsHint },
            { type: "input_audio", input_audio: { data: b64, format: "wav" } },
          ] },
        ],
        max_tokens: 512,
        temperature: 0,
      });

      const response = await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
      });

      let text = "";
      if (response.status === 200) {
        try {
          const json = JSON.parse(response.body);
          text = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || "";
        } catch (e) {
          this.logger.warn && this.logger.warn("解析 llama-server 回應失敗", { body: response.body });
        }
      } else {
        throw new Error(`llama-server 轉錄失敗 HTTP ${response.status}: ${response.body.slice(0, 200)}`);
      }
      this.logger.info && this.logger.info("llama-server 轉錄原始回應", { status: response.status, bodyLen: response.body.length, textLen: text.length, textPreview: String(text).slice(0, 80) });

      text = this._cleanAsrText(text);

      // 語音符號：GGUF 模式不啟動 sherpa server，改在 JS 端套用（內建 + 自訂）
      try {
        const { applyEmoji } = require("./emojiText");
        const customEmojis = this.databaseManager
          ? this.databaseManager.getSetting("custom_emojis", {})
          : {};
        text = applyEmoji(text, customEmojis && typeof customEmojis === "object" ? customEmojis : {});
      } catch (e) {
        this.logger.warn && this.logger.warn("套用語音符號失敗:", e.message || e);
      }

      // 中文序數轉阿拉伯數字（依設定，預設關）
      const convertOrdinalsEnabled = this.databaseManager
        ? this.databaseManager.getSetting("convert_ordinal_numbers", false)
        : false;
      if (convertOrdinalsEnabled) {
        text = this._convertOrdinals(text);
      }

      let audio_path = null;
      const saveAudioFiles = this.databaseManager
        ? this.databaseManager.getSetting("save_audio", this.databaseManager.getSetting("save_audio_files", true)) !== false
        : true;
      if (!(options && (options.no_persist || options.save_audio === false)) && saveAudioFiles) {
        audio_path = this._persistAudio(audioBlob);
      }

      return {
        success: true,
        text: text.trim(),
        segments: null,
        raw_text: text,
        confidence: 0.95,
        language: "zh-CN",
        duration: 0,
        audio_path,
      };
    } catch (error) {
      throw error;
    }
  }

  async transcribeFilePath(audioPath, options = {}) {
    if (!this.serverReady) {
      await this.startServer();
    }
    const audioBlob = await fs.promises.readFile(audioPath);
    const result = await this.transcribeAudio(audioBlob, options);
    return {
      success: true,
      text: result.text.trim(),
      raw_text: result.raw_text,
      confidence: result.confidence || 0.95,
      language: result.language || "zh-CN",
    };
  }
}

module.exports = LlamaManager;
