import * as vscode from 'vscode'
import { serverManager } from '../server/manager'

function parseEnvString(envString: string): { [key: string]: string } {
  const env: { [key: string]: string } = {}
  if (!envString) {
    return env
  }

  // Regular expression to match key-value pairs in the format KEY=VALUE or KEY='VAL UE' spaces within
  const regex = /([^=\s]+)=(".*?"|'.*?'|\S+)/g
  let match = regex.exec(envString)
  while (match !== null) {
    const key = match[1]
    let value = match[2]

    // Remove quotes if value is quoted
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
    match = regex.exec(envString)
  }

  return env
}

export function registerStartClaudeCodeWithEnvCommand(
  context: vscode.ExtensionContext,
) {
  const command = 'vscode-lm-proxy.startClaudeCodeWithEnv'

  const commandHandler = async () => {
    if (!serverManager.isRunning()) {
      // If the server is not running, automatically start it
      try {
        await serverManager.start()
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }
    }

    const serverUrl = serverManager.getServerUrl()
    const defaultValue = `ANTHROPIC_BASE_URL=${serverUrl}/anthropic/claude`

    const envString = await vscode.window.showInputBox({
      prompt: 'Enter environment variables',
      placeHolder: 'KEY1=VALUE1 KEY2="VALUE 2"',
      title: 'Start Claude Code with Environment',
      value: defaultValue,
    })

    // User cancelled the input box
    if (envString === undefined) {
      return
    }

    const customEnv = parseEnvString(envString)

    const terminal = vscode.window.createTerminal({
      name: 'Claude Code Server',
      env: customEnv,
    })

    terminal.show()

    const startCommand = 'claude'
    terminal.sendText(startCommand, true) // true to execute the command immediately

    vscode.window.showInformationMessage(
      'Starting Claude Code in a new terminal with custom environment.',
    )
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(command, commandHandler),
  )
}
