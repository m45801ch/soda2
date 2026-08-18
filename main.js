// 修復 VSCode/Claude Code 內開發 Electron 應用的問題
// 這些環境基於 Electron，會繼承 ELECTRON_RUN_AS_NODE=1，導致 Electron API 無法使用
delete process.env.ELECTRON_RUN_AS_NODE;

// 載入環境變數
require("dotenv").config();

const { app, globalShortcut, BrowserWindow, ipcMain, Menu, session } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

// 导入日志管理器
const LogManager = require("./src/helpers/logManager");

// 初始化日志管理器
const logger = new LogManager();

// 添加全局错误处理
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  if (error.code === "EPIPE") {
    return;
  }
  logger.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", { promise, reason });
});

// 导入助手模块
const EnvironmentManager = require("./src/helpers/environment");
const WindowManager = require("./src/helpers/windowManager");
const DatabaseManager = require("./src/helpers/database");
const ClipboardManager = require("./src/helpers/clipboard");
const SherpaManager = require("./src/helpers/sherpaManager");
const TrayManager = require("./src/helpers/tray");
const HotkeyManager = require("./src/helpers/hotkeyManager");
const IPCHandlers = require("./src/helpers/ipcHandlers");
const { TypelessManager } = require("./src/helpers/typelessManager");

// 设置生产环境PATH
function setupProductionPath() {
  logger.info('设置生产环境PATH', {
    platform: process.platform,
    nodeEnv: process.env.NODE_ENV,
    currentPath: process.env.PATH
  });

  if (process.platform === 'darwin' && process.env.NODE_ENV !== 'development') {
    const commonPaths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      '/Library/Frameworks/Python.framework/Versions/3.12/bin',
      '/Library/Frameworks/Python.framework/Versions/3.11/bin',
      '/Library/Frameworks/Python.framework/Versions/3.10/bin',
      '/Library/Frameworks/Python.framework/Versions/3.9/bin',
      '/Library/Frameworks/Python.framework/Versions/3.8/bin',
      // 添加更多可能的Python路径
      '/opt/homebrew/opt/python@3.11/bin',
      '/opt/homebrew/opt/python@3.10/bin',
      '/opt/homebrew/opt/python@3.9/bin',
      '/usr/local/opt/python@3.11/bin',
      '/usr/local/opt/python@3.10/bin',
      '/usr/local/opt/python@3.9/bin'
    ];
    
    const currentPath = process.env.PATH || '';
    const pathsToAdd = commonPaths.filter(p => !currentPath.includes(p));
    
    if (pathsToAdd.length > 0) {
      const newPath = `${currentPath}:${pathsToAdd.join(':')}`;
      process.env.PATH = newPath;
      logger.info('PATH已更新', {
        添加的路径: pathsToAdd,
        新PATH: newPath
      });
    } else {
      logger.info('PATH无需更新，所有路径已存在');
    }
  } else if (process.platform === 'win32' && process.env.NODE_ENV !== 'development') {
    // Windows平台的Python路径设置
    const commonPaths = [
      'C:\\Python311\\Scripts',
      'C:\\Python311',
      'C:\\Python310\\Scripts',
      'C:\\Python310',
      'C:\\Python39\\Scripts',
      'C:\\Python39',
      'C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Python\\Python311\\Scripts',
      'C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Python\\Python311',
      'C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Python\\Python310\\Scripts',
      'C:\\Users\\' + require('os').userInfo().username + '\\AppData\\Local\\Programs\\Python\\Python310'
    ];
    
    const currentPath = process.env.PATH || '';
    const pathsToAdd = commonPaths.filter(p => !currentPath.includes(p));
    
    if (pathsToAdd.length > 0) {
      const newPath = `${currentPath};${pathsToAdd.join(';')}`;
      process.env.PATH = newPath;
      logger.info('Windows PATH已更新', {
        添加的路径: pathsToAdd,
        新PATH: newPath
      });
    }
  }
}

// 在初始化管理器之前设置PATH
setupProductionPath();

// 計算 BUILD 版本標記（git short hash + 啟動時間），方便確認「現在跑哪一版」
function getBuildInfo() {
  let commit = "unknown";
  try {
    commit = require("child_process")
      .execSync("git rev-parse --short HEAD", {
        cwd: __dirname,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .toString()
      .trim();
  } catch (e) {
    commit = "n/a";
  }
  return { commit, version: app.getVersion(), startedAt: new Date().toISOString() };
}
const BUILD_INFO = getBuildInfo();
logger.info(
  `🏷️ BUILD ququ v${BUILD_INFO.version} commit=${BUILD_INFO.commit} started=${BUILD_INFO.startedAt}`
);

// 用户数据目录环境变量将在 app ready 后设置

// 初始化管理器
const environmentManager = new EnvironmentManager();
const databaseManager = new DatabaseManager();
const clipboardManager = new ClipboardManager(logger); // 传递logger实例
const sherpaManager = new SherpaManager(logger); // 传递logger实例
const LlamaManager = require("./src/helpers/llamaManager");
const hotkeyManager = new HotkeyManager(logger);
const typelessManager = new TypelessManager(logger);

// 初始化数据库
const dataDirectory = environmentManager.ensureDataDirectory();
databaseManager.initialize(dataDirectory);

// 連結資料庫設定至模型管理器，並建立預設模型根目錄
sherpaManager.setDatabaseManager(databaseManager);
const llamaManager = new LlamaManager(logger);
llamaManager.setDatabaseManager(databaseManager);

// 若當前模型是 whisper 但檔案不完整則降級到 sense_voice
const currentModel = databaseManager.getSetting('asr_model_type', 'paraformer');
if (currentModel === 'whisper') {
  const fs = require('fs');
  const whisperDir = path.join(__dirname, 'model', 'sherpa-onnx-whisper-small');
  const tokensFile = path.join(whisperDir, 'small-tokens.txt');
  if (fs.existsSync(whisperDir) && (!fs.existsSync(tokensFile) || (fs.existsSync(tokensFile) && fs.statSync(tokensFile).size === 0))) {
    databaseManager.setSetting('asr_model_type', 'sense_voice');
    logger.info('Whisper 模型不完整，自動降級到 sense_voice');
  }
}
try {
  const fs = require("fs");
  const defaultModelDir = path.join(__dirname, "model");
  if (!fs.existsSync(defaultModelDir)) {
    fs.mkdirSync(defaultModelDir, { recursive: true });
    logger.info(`建立預設模型目錄: ${defaultModelDir}`);
  }
} catch (e) {
  logger.warn("建立預設模型目錄失敗:", e.message);
}


// 崩潰救援：若上次錄音中途被砍，把遺留的音訊救回歷史（標「未轉錄」）
try {
  require("./src/helpers/recovery").recoverOnStartup(databaseManager, logger);
} catch (e) {
  logger && logger.warn && logger.warn("崩潰救援啟動檢查失敗:", e?.message || e);
}

// 自動清理過期舊錄音檔
try {
  require("./src/helpers/recovery").cleanOldRecordings(databaseManager, logger);
} catch (e) {
  logger && logger.warn && logger.warn("自動清理舊錄音檔啟動失敗:", e?.message || e);
}

// 初始化 windowManager，傳入 databaseManager 以支援設定讀取
const windowManager = new WindowManager(databaseManager);
const trayManager = new TrayManager();

// IPC处理器将在 app ready 后初始化
let ipcHandlers = null;

// 主应用启动函数
async function startApp() {
  // 麥克風權限：交由 Chromium/Windows 默認處理（與 dev 一致）。
  // 切勿註冊 setPermissionRequestHandler 攔截 media —— 那會繞過 Windows 對
  // 每個 exe 的系統麥克風授權，導致新安裝的 exe 拿到 live 但系統層靜音的 stream。
  // （Windows 按 exe 記錄麥克風權限；首次 getUserMedia 需彈系統授權窗，
  //   攔截 handler 會吞掉這個流程。）

  // Content-Security-Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "connect-src 'self' http://localhost:* ws://localhost:*; " +
          "img-src 'self' data:; " +
          "font-src 'self'",
        ],
      },
    });
  });

  // 在 app ready 后初始化 IPC 处理器
  if (!ipcHandlers) {
    ipcHandlers = new IPCHandlers({
      environmentManager,
      databaseManager,
      clipboardManager,
      sherpaManager,
      llamaManager,
      windowManager,
      hotkeyManager,
      typelessManager,
      logger,
    });
  }

  logger.info('应用启动开始', {
    nodeEnv: process.env.NODE_ENV,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    appVersion: app.getVersion()
  });

  // 注释掉 accessibility 支持 - 可能干扰文本插入
  // try {
  //   app.setAccessibilitySupportEnabled(true);
  //   logger.info('✅ 已启用 Electron accessibility 支持');
  // } catch (error) {
  //   logger.warn('⚠️ 启用 accessibility 支持失败:', error.message);
  // }

  // 记录系统信息
  logger.info('系统信息', logger.getSystemInfo());

  // 开发模式下添加小延迟让Vite正确启动
  if (process.env.NODE_ENV === "development") {
    logger.info('开发模式，等待Vite启动...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // 确保macOS上dock可见
  if (process.platform === 'darwin' && app.dock) {
    app.dock.show();
    logger.info('macOS Dock已显示');
  }

  // 移除預設應用選單列（Win/Linux）：按 Alt 會啟動選單列、把右 Alt 的 keyup 吃掉，
  // 導致錄音 toggle 卡在「錄音中」停不下來（採自 PR #14 jaylooloomi 的觀察）。
  // 跟我們既有的 gap<600 解鎖是不同根因、互補。Mac 保留全域選單（Cmd 系快捷鍵需要）。
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  // 在启动时初始化 Sherpa 管理器（不等待以避免阻塞）
  logger.info('开始初始化 Sherpa 管理器...');
  sherpaManager.initializeAtStartup().catch((err) => {
    logger.warn("Sherpa 在启动时不可用，这不是关键问题", err);
  });

  // 啟動時同步熱詞：hotwords.txt（設定-熱詞）為唯一來源 → 同步到 custom_words（風格包）
  try {
    sherpaManager.getHotwords().then((res) => {
      if (res && res.success && Array.isArray(res.words)) {
        databaseManager.setSetting("custom_words", res.words);
        logger.info('啟動熱詞同步完成:', `${res.words.length} 個`);
      }
    }).catch(() => {});
  } catch (e) {
    logger.warn("啟動熱詞同步失敗:", e.message || e);
  }

  if (databaseManager.getSetting("asr_model_type", "paraformer") === "qwen3_asr_gguf") {
    llamaManager.checkModelFiles().then((status) => {
      if (status && status.models_downloaded) {
        llamaManager.startServer().catch((err) => {
          logger.warn("llama-server 啟動失敗（不阻擋應用）:", err && err.message);
        });
      } else {
        logger.info("GGUF 模型未下載，等待使用者在設定中手動下載");
      }
    }).catch((err) => {
      logger.warn("檢查 GGUF 模型檔案失敗:", err && err.message);
    });
  }

  // 保留策略（建議 1）：開機清掉超過保留天數的舊錄音，避免無限增長 + 減少 SSD 寫入。
  try {
    const retentionDays = databaseManager.getSetting('audio_retention_days', 30);
    sherpaManager.cleanupOldAudio(retentionDays).catch(() => {});
  } catch (e) { /* 不擋啟動 */ }

  // 创建主窗口
  try {
    logger.info('创建主窗口...');
    await windowManager.createMainWindow();
    logger.info('主窗口创建成功');
  } catch (error) {
    logger.error("创建主窗口时出错:", error);
  }

  // 创建控制面板窗口
  try {
    logger.info('创建控制面板窗口...');
    await windowManager.createControlPanelWindow();
    logger.info('控制面板窗口创建成功');
  } catch (error) {
    logger.error("创建控制面板窗口时出错:", error);
  }

  // 預先建立 TypeLess 錄音指示器視窗（避免第一次按 ALT 時才建立造成的延遲與競爭）
  windowManager.createTypelessIndicatorWindow().catch(() => {});

  // 緊急重置熱鍵（用 globalShortcut — Electron 內建 API，不吃 keyup 掉落）。
  // 當 uiohook 因高負載/錄影吞掉 keyup/keydown 時，按 Ctrl+Shift+F9 可直接
  // 強制重置 TypelessManager 狀態 + 停止錄音 + 隱藏指示器 + 通知渲染層。
  // 不受 uiohook 異常影響的獨立保險路徑。
  try {
    const emergencyResetAccelerator = 'CommandOrControl+Shift+F9';
    globalShortcut.register(emergencyResetAccelerator, () => {
      logger.info('緊急重置熱鍵觸發');
      typelessManager.forceReset();
      windowManager.hideTypelessIndicator();
      // 向所有視窗發送緊急重置事件
      BrowserWindow.getAllWindows().forEach((w) => {
        if (!w.isDestroyed()) w.webContents.send('emergency-reset');
      });
      logger.info('緊急重置完成: forceReset + hideIndicator + broadcast');
    });
    logger.info(`緊急重置熱鍵已註冊: ${emergencyResetAccelerator}`);
  } catch (e) {
    logger.warn('緊急重置熱鍵註冊失敗:', e.message);
  }

  // 啟動時預先載入 TypeLess 觸發鍵設定並啟用全域監聽（避開渲染端重複註冊與焦點競爭）
  try {
    const triggerId = databaseManager.getSetting('typeless_trigger', 'default');
    typelessManager.setTriggerById(triggerId);
    const aiOptTrigger = databaseManager.getSetting('ai_optimize_trigger', 'none');
    typelessManager.setAiOptimizeTrigger(aiOptTrigger);
    typelessManager.enable();
    logger.info(`啟動時已啟用 TypeLess 模式，觸發鍵設為 ${triggerId}，AI 優化錄音觸發鍵設為 ${aiOptTrigger}`);
  } catch (e) {
    logger.warn('啟動時啟用 TypeLess 失敗:', e.message);
  }

  // 同步開機啟動設定到系統中
  try {
    const autoStart = databaseManager.getSetting('auto_start', false);
    const autoStartMinimized = databaseManager.getSetting('auto_start_minimized', true);
    app.setLoginItemSettings({
      openAtLogin: !!autoStart,
      path: process.execPath,
      args: autoStartMinimized ? ["--hidden"] : []
    });
    logger.info("開機自啟動設定同步完成:", { autoStart, autoStartMinimized });
  } catch (e) {
    logger.warn("開機自啟動設定同步失敗:", e.message);
  }

  // 自動備份：若開啟且超過 24h 未備份，寫備份檔到雲端同步資料夾
  try {
    const autoBackup = databaseManager.getSetting('backup_auto_enable', false);
    const cloudDir = databaseManager.getSetting('backup_cloud_dir', '');
    if (autoBackup && cloudDir) {
      const lastAuto = databaseManager.getSetting('backup_last_auto', null);
      const now = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1000;
      if (!lastAuto || now - new Date(lastAuto).getTime() >= DAY_MS) {
        const fs = require("fs");
        const path = require("path");
        if (fs.existsSync(cloudDir)) {
          const { exportBackupToDir } = require("./src/helpers/backup");
          const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
          const filename = `soda2-backup-${ts}.json`;
          const result = await exportBackupToDir({ databaseManager, dir: cloudDir, filename });
          if (result.success) {
            databaseManager.setSetting('backup_last_auto', new Date(now).toISOString());
            logger.info('自動備份完成:', result.path);
          } else {
            logger.warn('自動備份失敗:', result.error);
          }
        } else {
          logger.warn('自動備份跳過：雲端資料夾不存在', cloudDir);
        }
      }
    }
  } catch (e) {
    logger.warn('自動備份失敗:', e.message || e);
  }

  // 設置托盘
  logger.info('设置系统托盘...');
  trayManager.setWindows(
    windowManager.mainWindow,
    windowManager.controlPanelWindow
  );
  trayManager.setWindowManager(windowManager);
  trayManager.setCreateControlPanelCallback(() =>
    windowManager.createControlPanelWindow()
  );
  await trayManager.createTray();
  logger.info('系统托盘设置完成');

  logger.info('应用启动完成');
}

// 單一實例鎖定 - 防止多開
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 已有實例在運行，直接退出
  logger.info('偵測到另一個實例正在運行，退出');
  app.quit();
} else {
  // 收到第二個實例的請求時，聚焦現有視窗
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    logger.info('收到第二個實例請求，聚焦現有視窗');
    const mainWindow = windowManager.mainWindow;
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 应用事件处理器
  app.whenReady().then(() => {
    // 设置用户数据目录环境变量，供Python脚本使用
    process.env.ELECTRON_USER_DATA = app.getPath('userData');
    logger.info('设置用户数据目录环境变量', {
      ELECTRON_USER_DATA: process.env.ELECTRON_USER_DATA
    });
    startApp();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // close-to-tray 是「隱藏」主視窗不是「銷毀」，視窗物件還在 → getAllWindows 不為 0。
  // 舊邏輯只在「全部視窗被銷毀(=== 0)」才重建，導致 Mac 點 dock 圖示叫不回隱藏的主視窗
  // （issue #16）。改成：主視窗還在就 show + focus，真的沒了才重建。
  const win = windowManager.mainWindow;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    windowManager.createMainWindow();
  }
});

app.on("before-quit", () => {
  // 從 dock 右鍵「結束」或 Cmd+Q 退出時，標記為「真正退出」，否則 close handler 會把它
  // 當成一般關閉 → preventDefault + hide → Mac 上「關不掉、結束沒反應」（issue #16）。
  windowManager.isQuitting = true;
});

app.on("will-quit", () => {
  llamaManager.stopServer().catch(() => {});
  globalShortcut.unregisterAll();
  typelessManager.cleanup();
});

// 导出管理器供其他模块使用
module.exports = {
  environmentManager,
  windowManager,
  databaseManager,
  clipboardManager,
  sherpaManager,
  trayManager,
  hotkeyManager,
  typelessManager,
  logger
};