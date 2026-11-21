[English](README.md) · **简体中文**

# MiniMeters Mobile

[MiniMeters](https://minimeters.app) 的手机端仪表盘，用 Expo + React Native 构建。
桌面端（JUCE 插件 / 独立运行版，在 `../MiniMetersMobileServer`）负责采集音频，通过 WebSocket 推流原始
PCM 帧；本应用在手机上用 Skia 重绘这些表头。

## 下载（Android）

从 [Releases](https://github.com/SOMWHY/minimeters-mobile/releases/latest) 取最新 APK：

1. 下载 `minimeters-mobile-<version>-arm64.apk` 和 `SHA256SUMS.txt`。
2. 可选但建议 —— 校验下载：
   ```powershell
   certutil -hashfile minimeters-mobile-<version>-arm64.apk SHA256
   ```
   结果必须与 `SHA256SUMS.txt` 里那一行一致。
3. 安装。Android 会提示「来源未知」以及「未经 Play Protect 扫描」—— 这是预期的，本应用不通过 Google Play
   分发。允许安装并选择「仍要安装」。
4. 打开应用，扫描桌面插件或独立运行版窗口上显示的二维码。

环境要求：Android 8.0+、**仅 arm64**（没有发布 32 位或 x86 构建）、手机与电脑在同一局域网、
桌面端 TCP 8422 可达。

音频不会离开你的设备：手机只通过局域网接收原始 PCM。见 [`PRIVACY.zh-CN.md`](PRIVACY.zh-CN.md)。

## 架构

```
桌面端 (JUCE)                          手机端 (Expo)
  音频回调 ──▶ AudioBlockQueue ──▶ WebSocket :8422/ws ──▶ PcmSocketClient
                                                                │ 最新一帧
  分析 + Skia 模块  ◀── @minimetermobile/ui ◀── usePcmStream ◀───┘  (30 Hz 轮询)
```

- **`@minimetermobile/ui`**（`../react-native-minimeters-library`）拥有全部可视化：波形、频谱、声谱、
  VU、LUFS、示波器，以及网格/布局模型。
- **本应用**拥有传输层、主题装配、仪表盘布局持久化，以及设置小球。除了把线性值映射到模块刻度，
  它不做任何 DSP。
- **同一时刻只有一帧在途**：客户端只保留最新一帧，界面按定时器取走，所以 30 fps 的流不会压垮渲染预算。

## 开始开发

```bash
npm install
npx expo start          # Metro；在真机或模拟器上打开
```

组件库是 workspace 符号链接且 `main = dist/`，所以改完它的源码要重新构建：

```bash
cd ../react-native-minimeters-library && npm run build
```

### 配对

桌面窗口会显示二维码，以及同样的文字信息：

```
Address: 192.168.1.20:8422
Path: /ws
Token: <短期配对令牌>
```

- **扫二维码**（相机），或者
- **手动输入地址** —— 输入 `192.168.1.20:8422` 和令牌。也接受裸主机名（默认端口 8422）、
  `ws://host:port/ws` 形式的 URL、方括号包裹的 IPv6 字面量，或者把整段二维码 JSON 粘进地址栏。

首次握手会签发设备令牌，之后启动不必再扫二维码。二维码令牌会过期，设备令牌不会。

Windows 防火墙必须放行入站 TCP **8422**，手机才能连上桌面端。

## 平台支持

| 平台 | 状态 | 说明 |
| --- | --- | --- |
| **Android (arm64)** | ✅ 真机验证 —— 参考平台 | 全屏模式通过 `expo-navigation-bar` 隐藏状态栏和导航栏；边缘滑动可临时唤出 |
| **iOS 16+** | ⚠️ 代码就绪，**未在真机验证** | 项目手上没有 iPhone 或 Mac。`Info.plist` 已声明局域网权限和 ATS 局域网例外（两者都必需，见下）；iOS 的 JS bundle 和配置内省都能干净构建。Skia/Metal 渲染、安全区、局域网权限弹窗均未验证 |
| **鸿蒙 4.x / EMUI**（基于 AOSP） | ⚠️ 预期可用 —— 未测 | 仍能装 APK。关掉纯净模式，再装 `preview` 的 APK。手动配对入口就是为这种情况加的 |
| **鸿蒙 NEXT 5.0+** | ❌ 不支持 | 没有 AOSP 层，APK 装不上；需要原生 `.hap`（RNOH）。卓易通/出境易 这类兼容层有时能跑 APK，但功能会缺失 |
| **Web** | ❌ 不支持 | `react-native-skia` 需要 CanvasKit，而且仪表盘依赖原生布局度量 |

细节、证据，以及移植到鸿蒙 NEXT 的代价：[`docs/platform-support.zh-CN.md`](docs/platform-support.zh-CN.md)。

### iOS 专有配置

有两个键是必需的，且已经写在 `app.json` 里：

| 键 | 缺少时的后果 |
| --- | --- |
| `NSLocalNetworkUsageDescription` | iOS 14+ 会静默阻断局域网访问；RN 只会报 `Network request failed` |
| `NSAppTransportSecurity.NSAllowsLocalNetworking` | ATS 会拒绝明文 `ws://` 连接 |

### 构建

`eas.json` 定义了五个 profile：

| Profile | 产物 | 需要 Apple 账号 |
| --- | --- | --- |
| `development` | 开发客户端（内部） | 否 |
| `preview` | **可安装的 APK** —— 内部测试，走 `preview` OTA 通道 | 否 |
| `release` | **公开发布的 APK** —— GitHub Releases，走 `production` OTA 通道，versionCode 自增 | 否 |
| `preview-simulator` | 未签名的 iOS 模拟器 `.app` —— 可在浏览器（Appetize/BrowserStack）或租用的 Mac 上运行 | **否** |
| `production` | app bundle（Play）/ 已签名 IPA | iOS 需要 |

```bash
npx eas build --profile release --platform android     # 公开发布 APK
npx eas build --profile preview --platform android     # 内部测试 APK
npx eas build --profile preview-simulator --platform ios
```

发版流程（密钥、校验和、GitHub Release、OTA）：[`docs/RELEASING.md`](docs/RELEASING.md)。

## 开发

```bash
npm run test            # jest
npx tsc --noEmit        # 类型
npx expo lint
npx expo export --platform android   # 抓打包回归
```

Jest 与 Skia 是隔离的：组件测试深引 `@minimetermobile/ui/dist/...`，渲染模块主体的屏幕测试则
mock 掉 `./module-bodies`。

## 已知缺口

- iOS 和鸿蒙从未在真机上跑过（见平台支持矩阵）。
- 帧率切片（波形 20 Hz / 频谱 15 Hz / 表头 10 Hz）—— 引擎目前仍然每 33 ms 帧做一次 FFT。
- VU/LUFS 用的是指数毫秒弹道，而不是 dB 域的 24 dB/s 释放。
- 波形历史窗口是 3 秒。

## 参与贡献

见 [`CONTRIBUTING.zh-CN.md`](CONTRIBUTING.zh-CN.md)。
