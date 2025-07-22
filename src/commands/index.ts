// コマンド定義のインデックスファイル
import type * as vscode from 'vscode'
import { registerStartClaudeCodeWithEnvCommand } from './claudeCode'
import { registerModelCommands } from './model'
import { registerOutputCommands } from './output'
import { registerServerCommands } from './server'

/**
 * 拡張機能で利用する全コマンドを一括登録します。
 * @param {vscode.ExtensionContext} context 拡張機能のグローバルコンテキスト
 */
export function registerCommands(context: vscode.ExtensionContext): void {
  // サーバー関連のコマンドを登録
  registerServerCommands(context)

  // モデル選択関連のコマンドを登録
  registerModelCommands(context)

  // 出力パネル関連のコマンドを登録
  registerOutputCommands(context)

  // Claude Code関連のコマンドを登録
  registerStartClaudeCodeWithEnvCommand(context)
}
