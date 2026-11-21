[English](platform-support.md) · **简体中文**

# 平台支持

哪些是真跑过的，哪些只是构建过，以及那些今天跑不了应用的平台还需要什么。

状态快照：2026-11-21。

## 概览

| 平台 | 能跑应用 | 真机验证 | 卡在哪 |
| --- | --- | --- | --- |
| Android | 能 | 能 | — |
| iOS 16+ | 能（已构建，未安装） | **不能** | 项目手上没有 iPhone/Mac |
| 鸿蒙 4.x / EMUI | 能（APK） | **不能** | 需要一台华为测试机 |
| 鸿蒙 NEXT 5.0+ | **不能** | 不能 | 没有 AOSP 层；需要 `.hap` |
| Web | 不能 | — | Skia 需要 CanvasKit；布局假设原生度量 |

## Android —— 已验证

参考平台。端到端验证过：配对（扫码与手动）、推流、全部七个模块、布局编辑、主题切换、全屏开关，
以及布局/小球在重启后的持久化。

说明：

- 全屏通过 `expo-navigation-bar` 的 `setVisibilityAsync` 同时隐藏两个系统栏。近期 Android 强制 edge-to-edge
  之后，隐藏是唯一受支持的行为，边缘滑动可临时唤出系统栏。在 `AppState` → `active` 时重新应用，
  卸载时恢复。
- 预测性返回已关闭（`android.predictiveBackGestureEnabled: false`）。

## iOS —— 已构建，未真机验证

在没有 Mac 和 iPhone 的前提下能查的都查了：

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 配置插件生成了正确的 `Info.plist` | `npx expo config --type introspect` | `NSLocalNetworkUsageDescription`、`NSAppTransportSecurity.NSAllowsLocalNetworking`、`NSCameraUsageDescription` 均存在 |
| iOS JS bundle 能构建 | `npx expo export --platform ios` | `entry-*.hbc`，4.4 MB Hermes 字节码 |
| 类型 / 测试 / lint | `tsc --noEmit`、`jest`、`expo lint` | 干净 |

**未验证**（需要真机或模拟器）：Metal 上的 Skia 渲染、刘海屏设备的安全区、真实的局域网权限弹窗、
手势行为，以及全屏开关对状态栏的实际效果。

有两个 `Info.plist` 键是必需的 —— 缺了它们，同一 Wi-Fi 下的手机根本配不上对，而且失败只会表现为一句
干巴巴的 `Network request failed`：

```json
"NSLocalNetworkUsageDescription": "…",
"NSAppTransportSecurity": { "NSAllowsLocalNetworking": true }
```

第一个是 iOS 14+ 的局域网隐私弹窗；第二个是让明文 `ws://` 能访问局域网地址的 ATS 例外。
`NSAllowsLocalNetworking` 比 `NSAllowsArbitraryLoads` 窄得多，这一点对 App Store 审核很重要。

### 真机验证 iOS 的几条路，按成本从低到高

1. **借别人的 iPhone + Expo Go** —— `npx expo start --tunnel`，对方扫码即可。能验证 Skia、配对、
   全屏。免费。
2. **浏览器里跑未签名的模拟器构建** —— `npx eas build -p ios --profile preview-simulator` 产出 `.app`，
   上传到 Appetize.io 或 BrowserStack App Live。**不需要 Apple 账号**（模拟器构建不签名）。
3. **租用云 Mac** —— MacinCloud / MacStadium / 云端 macOS 实例，大致 ¥1–3/小时。最接近真实调试：
   Xcode 模拟器 + 活的 Metro 连接。
4. **二手 iPhone SE（二代/三代）** —— 几百块，最耐用。但装签名构建仍需 Apple 开发者账号
   （$99/年）才能用 TestFlight/ad-hoc。

## 鸿蒙 4.x / EMUI —— 预期可用，未测

大约 Mate 60 一代及以前的华为设备仍带 AOSP 兼容层，所以 APK 能装，行为也跟 Android 一样。
用户唯一要做的是关掉纯净模式（设置 → 系统和更新 → 纯净模式）并允许安装未知来源应用。

测试方式：`npx eas build --profile preview --platform android`（`preview` profile 出 `.apk`），
传到手机安装即可。

**手动配对**入口正是为这条路加的：相机被禁或不存在的设备，仍然可以靠输入二维码旁边印的地址和令牌
完成配对。

## 鸿蒙 NEXT 5.0+ —— 不支持

鸿蒙 NEXT 移除了 AOSP 层、ART 运行时和 Java SDK，APK 完全装不上（`无法打开文件` / 格式不支持）。
原生应用是用 ArkTS + ArkUI 写的 `.hap` 包。

三条路，成本递增：

1. **不做，把它写进文档。** 目前推荐这条。
2. **兼容层。** 华为有文档的卓易通，以及部分地区可用的出境易，都能跑 Android 应用。APK 可能装得上，
   但会丢相机、通知、后台执行或 DRM 中的一部分。手动配对能让应用在这种模式下可用；把它当 best effort。
3. **真正移植 HAP。** 这是另一个工程，不是一个构建开关：

   - OpenHarmony 上的 React Native 是 RNOH（`gitee.com/openharmony-sig/ohos_react_native`），与上游
     React Native 是两条发布线。主线移植基于 RN 0.72.5。
   - 社区的 Expo 桥（`expo-harmony`）面向 Expo SDK 55 + RNOH 0.84.1。本项目是
     **Expo SDK 58 / RN 0.88.1** —— 版本对不上。
   - `@shopify/react-native-skia` 有 OpenHarmony 移植（`@react-native-ohos/react-native-skia`），但停留在
     1.3.7 / RN 0.77 那一代，比本应用使用的版本更旧。
   - 所有可视化都是 Skia，没有降级渲染器。

   动手之前，先用一个屏幕的 spike 验证风险：在 DevEco Studio 模拟器上，用硬编码缓冲区驱动一个 Skia
   渲染的波形。如果这都跑不起来，移植就不值得再评估。

## Web —— 不支持

`expo export --platform web` 也许能产出 bundle，但 `react-native-skia` 需要 CanvasKit 的 WASM 构建，
而且 `useDashboardLayout` / 小球依赖原生窗口度量。这不是目标平台。
