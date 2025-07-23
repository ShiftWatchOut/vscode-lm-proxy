import * as vscode from 'vscode'
import { serverManager } from '../server/manager'

interface EnvVariable {
  key: string
  value: string
  description?: string
}

interface EnvQuickPickItem extends vscode.QuickPickItem {
  envVariable?: EnvVariable
  isAddNew?: boolean
  isDynamic?: boolean
}

const ENV_STORAGE_KEY = 'claudeCode.savedEnvVariables'
const LAST_SELECTION_KEY = 'claudeCode.lastSelectedEnvVariables'

function getSavedEnvVariables(context: vscode.ExtensionContext): EnvVariable[] {
  return context.globalState.get<EnvVariable[]>(ENV_STORAGE_KEY, [])
}

function saveSavedEnvVariables(
  context: vscode.ExtensionContext,
  variables: EnvVariable[],
): void {
  context.globalState.update(ENV_STORAGE_KEY, variables)
}

function getLastSelectedVariables(
  context: vscode.ExtensionContext,
): EnvVariable[] {
  return context.globalState.get<EnvVariable[]>(LAST_SELECTION_KEY, [])
}

function saveLastSelectedVariables(
  context: vscode.ExtensionContext,
  variables: EnvVariable[],
): void {
  context.globalState.update(LAST_SELECTION_KEY, variables)
}

function isVariableEqual(a: EnvVariable, b: EnvVariable): boolean {
  return (
    a.key === b.key && a.value === b.value && a.description === b.description
  )
}

function isVariableSelected(
  variable: EnvVariable,
  lastSelected: EnvVariable[],
): boolean {
  return lastSelected.some(selected => isVariableEqual(variable, selected))
}

function getDynamicEnvVariables(): EnvVariable[] {
  const serverUrl = serverManager.getServerUrl()
  return [
    {
      key: 'ANTHROPIC_BASE_URL',
      value: `${serverUrl}/anthropic/claude`,
      description: '(Auto-generated) Anthropic API base URL',
    },
    {
      key: 'OPENAI_BASE_URL',
      value: `${serverUrl}/openai/v1`,
      description: '(Auto-generated) OpenAI API base URL',
    },
  ]
}

function detectConflicts(variables: EnvVariable[]): string[] {
  const keyCount = new Map<string, number>()
  for (const variable of variables) {
    keyCount.set(variable.key, (keyCount.get(variable.key) || 0) + 1)
  }

  return Array.from(keyCount.entries())
    .filter(([_, count]) => count > 1)
    .map(([key, _]) => key)
}

async function promptForNewVariable(
  context: vscode.ExtensionContext,
): Promise<EnvVariable | undefined> {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter environment variable name',
    placeHolder: 'VARIABLE_NAME',
    validateInput: value => {
      if (!value.trim()) {
        return 'Variable name cannot be empty'
      }
      if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
        return 'Variable name should contain only uppercase letters, numbers, and underscores'
      }
      return undefined
    },
  })

  if (!key) {
    return undefined
  }

  const value = await vscode.window.showInputBox({
    prompt: `Enter value for ${key}`,
    placeHolder: 'Variable value',
  })

  if (value === undefined) {
    return undefined
  }

  const description = await vscode.window.showInputBox({
    prompt: `Enter description for ${key} (optional)`,
    placeHolder: 'Description (optional)',
  })

  const newVariable: EnvVariable = {
    key,
    value,
    description: description || undefined,
  }

  const savedVariables = getSavedEnvVariables(context)

  // Check for exact match (same key, value, and description)
  const exactMatch = savedVariables.find(v => isVariableEqual(v, newVariable))
  if (exactMatch) {
    // Variable already exists with same values, no action needed
    vscode.window.showInformationMessage(
      `Environment variable "${key}" already exists with the same values.`,
    )
    return newVariable
  }

  // Check for key conflict (same key but different value/description)
  const existingIndex = savedVariables.findIndex(v => v.key === key)
  if (existingIndex >= 0) {
    const existingVar = savedVariables[existingIndex]
    const choice = await vscode.window.showWarningMessage(
      `Environment variable "${key}" already exists with different value.\nExisting: ${existingVar.value}\nNew: ${newVariable.value}\n\nWhat would you like to do?`,
      'Update Existing',
      'Add as New',
      'Cancel',
    )

    if (choice === 'Update Existing') {
      savedVariables[existingIndex] = newVariable
    } else if (choice === 'Add as New') {
      savedVariables.push(newVariable)
    } else {
      return undefined
    }
  } else {
    savedVariables.push(newVariable)
  }

  saveSavedEnvVariables(context, savedVariables)
  vscode.window.showInformationMessage(
    `Environment variable "${key}" saved successfully.`,
  )

  return newVariable
}

export function registerManageEnvVariablesCommand(
  context: vscode.ExtensionContext,
) {
  const command = 'vscode-lm-proxy.manageEnvVariables'

  const commandHandler = async () => {
    const savedVariables = getSavedEnvVariables(context)

    if (savedVariables.length === 0) {
      const choice = await vscode.window.showInformationMessage(
        'No saved environment variables found.',
        'Add New Variable',
      )
      if (choice === 'Add New Variable') {
        await promptForNewVariable(context)
      }
      return
    }

    interface ManageQuickPickItem extends vscode.QuickPickItem {
      envVariable?: EnvVariable
      isAddNew?: boolean
      action?: 'edit' | 'delete'
      index?: number
    }

    const quickPickItems: ManageQuickPickItem[] = [
      ...savedVariables.map((envVar, index) => ({
        label: `$(bookmark) ${envVar.key}`,
        description: envVar.description || 'Saved environment variable',
        detail: envVar.value,
        envVariable: envVar,
        index,
      })),
      {
        label: '$(plus) Add new environment variable',
        description: 'Create and save a new environment variable',
        isAddNew: true,
      },
    ]

    const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: 'Select an environment variable to manage',
      title: 'Manage Environment Variables',
    })

    if (!selectedItem) {
      return
    }

    if (selectedItem.isAddNew) {
      await promptForNewVariable(context)
      return
    }

    if (selectedItem.envVariable && selectedItem.index !== undefined) {
      const action = await vscode.window.showQuickPick(
        [
          {
            label: '$(edit) Edit',
            description: 'Edit this environment variable',
            action: 'edit' as const,
          },
          {
            label: '$(trash) Delete',
            description: 'Delete this environment variable',
            action: 'delete' as const,
          },
        ],
        {
          placeHolder: `What would you like to do with ${selectedItem.envVariable.key}?`,
          title: 'Environment Variable Actions',
        },
      )

      if (!action) {
        return
      }

      if (action.action === 'delete') {
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to delete the environment variable "${selectedItem.envVariable.key}"?`,
          { modal: true },
          'Delete',
          'Cancel',
        )

        if (confirm === 'Delete') {
          const updatedVariables = savedVariables.filter(
            (_, i) => i !== selectedItem.index,
          )
          saveSavedEnvVariables(context, updatedVariables)
          vscode.window.showInformationMessage(
            `Environment variable "${selectedItem.envVariable.key}" deleted successfully.`,
          )
        }
      } else if (action.action === 'edit') {
        const newKey = await vscode.window.showInputBox({
          prompt: 'Enter environment variable name',
          value: selectedItem.envVariable.key,
          validateInput: value => {
            if (!value.trim()) {
              return 'Variable name cannot be empty'
            }
            if (!/^[A-Z_][A-Z0-9_]*$/.test(value)) {
              return 'Variable name should contain only uppercase letters, numbers, and underscores'
            }
            return undefined
          },
        })

        if (!newKey) {
          return
        }

        const newValue = await vscode.window.showInputBox({
          prompt: `Enter value for ${newKey}`,
          value: selectedItem.envVariable.value,
        })

        if (newValue === undefined) {
          return
        }

        const newDescription = await vscode.window.showInputBox({
          prompt: `Enter description for ${newKey} (optional)`,
          value: selectedItem.envVariable.description || '',
        })

        const updatedVariable: EnvVariable = {
          key: newKey,
          value: newValue,
          description: newDescription || undefined,
        }

        const updatedVariables = [...savedVariables]
        updatedVariables[selectedItem.index] = updatedVariable
        saveSavedEnvVariables(context, updatedVariables)

        vscode.window.showInformationMessage(
          `Environment variable "${newKey}" updated successfully.`,
        )
      }
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(command, commandHandler),
  )
}

export function registerStartClaudeCodeWithEnvCommand(
  context: vscode.ExtensionContext,
) {
  const command = 'vscode-lm-proxy.startClaudeCodeWithEnv'

  const commandHandler = async () => {
    if (!serverManager.isRunning()) {
      try {
        await serverManager.start()
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }
    }

    const savedVariables = getSavedEnvVariables(context)
    const dynamicVariables = getDynamicEnvVariables()
    const lastSelectedVariables = getLastSelectedVariables(context)

    const quickPickItems: EnvQuickPickItem[] = [
      ...dynamicVariables.map(envVar => ({
        label: `$(gear) ${envVar.key}`,
        description: envVar.description,
        detail: envVar.value,
        envVariable: envVar,
        isDynamic: true,
        picked: isVariableSelected(envVar, lastSelectedVariables),
      })),
      ...savedVariables.map(envVar => ({
        label: `$(bookmark) ${envVar.key}`,
        description: envVar.description || 'Saved environment variable',
        detail: envVar.value,
        envVariable: envVar,
        picked: isVariableSelected(envVar, lastSelectedVariables),
      })),
      {
        label: '$(plus) Add new environment variable',
        description: 'Create and save a new environment variable',
        isAddNew: true,
      },
    ]

    const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
      canPickMany: true,
      placeHolder:
        'Select environment variables to include (previous selection restored)',
      title: 'Environment Variables for Claude Code',
    })

    if (!selectedItems) {
      return
    }

    const selectedVariables: EnvVariable[] = []

    for (const item of selectedItems) {
      if (item.isAddNew) {
        const newVariable = await promptForNewVariable(context)
        if (newVariable) {
          selectedVariables.push(newVariable)
        }
      } else if (item.envVariable) {
        selectedVariables.push(item.envVariable)
      }
    }

    const conflicts = detectConflicts(selectedVariables)
    if (conflicts.length > 0) {
      const conflictMessage = `Warning: Conflicting environment variables detected:\n${conflicts.map(c => `• ${c}`).join('\n')}\n\nThe last occurrence will be used. Continue?`
      const choice = await vscode.window.showWarningMessage(
        conflictMessage,
        { modal: true },
        'Continue',
        'Cancel',
      )
      if (choice !== 'Continue') {
        return
      }
    }

    const customEnv: { [key: string]: string } = {}
    for (const variable of selectedVariables) {
      customEnv[variable.key] = variable.value
    }

    // Save current selection for next time
    saveLastSelectedVariables(context, selectedVariables)

    const terminal = vscode.window.createTerminal({
      name: 'Claude Code Server',
      env: customEnv,
    })

    terminal.show()
    terminal.sendText('claude', true)

    const envCount = selectedVariables.length
    vscode.window.showInformationMessage(
      `Starting Claude Code with ${envCount} environment variable${envCount === 1 ? '' : 's'}.`,
    )
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(command, commandHandler),
  )
}
