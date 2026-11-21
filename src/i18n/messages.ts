/**
 * Every user-visible string in the app, in both supported languages.
 *
 * Flat keys on purpose: a nested tree would let two languages drift into
 * different shapes, and `MessageKey` is derived from the Chinese table — adding a
 * key there and forgetting English is a compile error, not a blank label in the
 * field.
 *
 * Not translated on purpose: theme names (Midnight / Ice / Ember are proper
 * names) and unit symbols (dB, Hz, LUFS, ms).
 */

export const LOCALES = ['zh', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh';

const zh = {
  'dashboard.loading': '加载中…',

  'panel.fullscreen': '全屏',
  'panel.settingsA11y': '仪表盘设置',  'panel.theme': '主题',
  'panel.language': '语言',

  'panel.scanQr': '扫描插件二维码',
  'panel.enterManual': '手动输入地址',
  'panel.cancelManual': '取消手动输入',
  'panel.manualHint': '这两个值都印在电脑端二维码旁边。',
  'panel.addressPlaceholder': '192.168.1.20:8422',
  'panel.tokenPlaceholder': '配对码',
  'panel.connect': '连接',
  'panel.editLayout': '编辑布局',
  'panel.done': '完成',
  'panel.resetLayout': '重置布局',
  'panel.disconnect': '断开连接',

  'status.connected': '已连接',
  'status.error': '连接出错',
  'status.idle': '未连接',

  /** The plugin changed the protocol; only a re-pair (or a newer build) helps. */
  'banner.protocol': '插件和手机对音频格式的理解不一致。',
  /** Socket died mid-stream. */
  'banner.unreachable': '与插件的连接已断开。',
  /** The server rejected the token and we can re-authenticate with a stored one. */
  'banner.reauth': '配对码已过期，请重新扫描插件上的二维码。',
  'banner.reauthNoToken':
    '配对码已过期，而这台手机没有保存过设备凭证 —— 请重新扫描二维码；如果仍然失败，请升级电脑端的插件。',
  'banner.reconnecting': '正在重连…（第 {attempt} 次）',
  'banner.error': '错误：{detail}',
  'banner.protocolError': '协议错误：{detail}',

  'update.available': '有新版本',
  'update.updating': '正在更新…',
  'update.apply': '更新',
  'update.installA11y': '安装更新',
  'update.dismissA11y': '忽略本次更新',

  'scanner.title': '扫描插件二维码',
  'scanner.cancel': '取消',

  'scanError.unsupportedVersion': '这个配对码的版本不受支持。',
  'scanError.invalidPayload': '这不是有效的 MiniMeters 配对码。',
  'scanError.invalidToken': '请填写二维码旁边显示的配对码。',
  'scanError.invalidAddress': '请填写电脑端地址，例如 192.168.1.20:8422。',
} as const;

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  'dashboard.loading': 'Loading dashboard…',

  'panel.fullscreen': 'Fullscreen',
  'panel.settingsA11y': 'Dashboard settings',
  'panel.theme': 'Theme',
  'panel.language': 'Language',

  'panel.scanQr': 'Scan plugin QR code',
  'panel.enterManual': 'Enter address manually',
  'panel.cancelManual': 'Cancel manual entry',
  'panel.manualHint': 'Both values are printed next to the QR code in the desktop app.',
  'panel.addressPlaceholder': '192.168.1.20:8422',
  'panel.tokenPlaceholder': 'Pairing token',
  'panel.connect': 'Connect',
  'panel.editLayout': 'Edit layout',
  'panel.done': 'Done',
  'panel.resetLayout': 'Reset layout',
  'panel.disconnect': 'Disconnect',

  'status.connected': 'Connected',
  'status.error': 'Connection error',
  'status.idle': 'Not connected',

  'banner.protocol': 'The plugin and the phone disagree about the audio format.',
  'banner.unreachable': 'Lost the connection to the plugin.',
  'banner.reauth': 'The pairing code expired. Scan the plugin QR code again.',
  'banner.reauthNoToken':
    'The pairing code expired and this phone has no device token stored — scan the QR code again; if it keeps failing, update the server build.',
  'banner.reconnecting': 'Reconnecting… (attempt {attempt})',
  'banner.error': 'Error: {detail}',
  'banner.protocolError': 'Protocol error: {detail}',

  'update.available': 'Update available',
  'update.updating': 'Updating…',
  'update.apply': 'Update',
  'update.installA11y': 'Install update',
  'update.dismissA11y': 'Dismiss update',

  'scanner.title': 'Scan the plugin QR code',
  'scanner.cancel': 'Cancel',

  'scanError.unsupportedVersion': 'This pairing code uses an unsupported version.',
  'scanError.invalidPayload': 'This is not a valid MiniMeters pairing code.',
  'scanError.invalidToken': 'Enter the pairing token shown next to the QR code.',
  'scanError.invalidAddress': 'Enter the desktop address, for example 192.168.1.20:8422.',
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { zh, en };
