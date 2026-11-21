[English](CONTRIBUTING.md) · **简体中文**

# 参与贡献

谢谢你看这个项目。本仓库是 MiniMeters Mobile 的手机端：一个 Expo / React Native 应用，通过局域网从桌面
插件接收原始 PCM，并用 Skia 绘制表头。

## 动手之前

- **职责边界。** 所有可视化都在 `@minimetermobile/ui`
  （[`../react-native-minimeters-library`](../react-native-minimeters-library)）。本应用负责传输层、主题装配、
  布局持久化和设置小球。改动「表头长什么样」属于组件库，不属于这里。
- **先开 issue**。比修 bug 更大的改动都先开 issue。
- **许可。** MIT。提交 PR 即表示你同意你的贡献同样以 MIT 授权。

## 环境准备

```bash
npm install
npx expo start
```

组件库是 workspace 符号链接且 `main = dist/`，所以本应用想看到它的最新源码，必须先构建：

```bash
cd ../react-native-minimeters-library && npm run build
```

## 检查项

提 PR 前这四项都要跑：

```bash
npm run test             # jest
npx tsc --noEmit         # 类型
npx expo lint
npx expo export --platform android   # 打包回归
```

`expo export` 不是客套：它是唯一能抓到 Metro 解析失败、或者只在生产 bundle 里才炸的 Skia 引用的检查。

## 测试

- Jest 与 Skia 是刻意隔离的。组件库根入口会拉进 `react-native-skia` 的 ESM 构建，Jest 无法转换，
  所以组件测试走深引（`@minimetermobile/ui/dist/dashboard`、`.../dist/theme`），而渲染模块主体的
  屏幕测试会 mock 掉 `./module-bodies`。
- `test/setup.js` 提供 AsyncStorage 的 mock。
- `DashboardGrid` 在测量到宽度之前不渲染任何东西；测试用
  `fireEvent(getByTestId('dashboard-grid'), 'layout', {...})` 把宽度推进去。
- React Native Testing Library 14 的 `render()` 返回**Promise** —— 必须 `await`，否则拿到的对象没有查询方法。
- `Pressable` 的 `props.onPress` 不是函数，请用 `fireEvent.press`。

## 约定

- 提交信息用 Conventional Commits：`feat(scope): ...`、`fix(scope): ...`、`docs`、`refactor`、
  `test`、`chore`。一个提交只做一件事。
- **原生改动必须升版本号。** `runtimeVersion.policy` 是 `appVersion`，所以图标、启动页、新增原生模块、
  权限变化都必须在 `app.json` 里 bump `version`。不 bump 意味着 OTA 更新会被发布到一个没有任何已安装
  应用报告的 runtime 上 —— 悄无声息地谁都收不到。
- 新增原生依赖必须在 PR 里说明：它会让所有已安装版本的 OTA 失效。
- 应用是双语的：所有面向用户的文案都走 `src/i18n`，不允许内联硬编码。

## Pull Request

- 写清你在什么机型、什么 Android 版本上测过。只在模拟器上验证过就明确说出来。
- 用户能看见的改动请附截图或录屏。
- 合并前由维护者跑检查并构建一次真机包；请不要自己合并自己的 PR。

## 报 bug

请附上：

- 手机型号、Android/iOS 版本、应用版本（在设置面板里可见）
- 桌面端：插件还是独立运行版，以及它的版本
- 应用显示的状态：已连接 / 重连中 / 具体哪句配对错误
- 桌面窗口状态行里的 `Network` 是不是 `unavailable`

连接失败几乎总是桌面端的问题：端口被另一个实例占着，或者 Windows 防火墙拦了入站 TCP 8422。
