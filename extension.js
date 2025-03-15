const vscode = require('vscode');

let luaTempDoc = null;

async function getOrCreateLuaTempDoc() {
    if (!luaTempDoc || luaTempDoc.isClosed) {
        luaTempDoc = await vscode.workspace.openTextDocument({
            language: 'lua',
            content: '',
            uri: vscode.Uri.parse(`untitled:luaTempDoc_${Date.now()}.lua`)
        });
    }
    return luaTempDoc;
}

function activate(context) {
    context.subscriptions.push(
        vscode.languages.setLanguageConfiguration('ldx', {
            brackets: [['<', '>'], ['{', '}']],
            autoClosingPairs: [
                { open: '<', close: '>' },
                { open: '{', close: '}' },
                { open: '"', close: '"' }
            ],
            surroundingPairs: [
                ['<', '>'],
                ['{', '}'],
                ['"', '"']
            ],
            onEnterRules: [
                {
                    beforeText: /^\s*<[A-Za-z]+[^>]*[^/]>$/,
                    afterText: /^\s*<\/[A-Za-z]+>$/,
                    action: { indent: 'indent', appendText: '\n\t' }
                }
            ]
        })
    );

    const selector = { language: 'ldx', scheme: 'file' };

    const completionProvider = vscode.languages.registerCompletionItemProvider(
        selector,
        {
            async provideCompletionItems(document, position, token, context) {
                const enableLuaCompletion = vscode.workspace.getConfiguration('ldx').get('enableLuaCompletion', true);

                if (!enableLuaCompletion) {
                    return [];
                }

                if (!document || document.lineCount === 0 || 
                    position.line < 0 || position.line >= document.lineCount || 
                    position.character < 0) {
                    return [];
                }

                let line;
                try {
                    line = document.lineAt(position.line).text;
                } catch (e) {
                    return [];
                }

                const range = document.getWordRangeAtPosition(position, /{[^}]*}/);

                if (range && line.includes('{') && line.includes('}')) {
                    const luaText = line.substring(range.start.character + 1, range.end.character - 1);

                    if (!luaText.trim()) {
                        return [];
                    }

                    const luaDoc = await getOrCreateLuaTempDoc();

                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        new vscode.Position(0, 0),
                        new vscode.Position(luaDoc.lineCount, 0)
                    );
                    edit.replace(luaDoc.uri, fullRange, luaText);
                    await vscode.workspace.applyEdit(edit);

                    const luaCompletions = await vscode.commands.executeCommand(
                        'vscode.executeCompletionItemProvider',
                        luaDoc.uri,
                        new vscode.Position(0, position.character - range.start.character - 1)
                    );

                    const completions = [];
                    if (luaCompletions) {
                        const items = luaCompletions instanceof vscode.CompletionList ? luaCompletions.items : luaCompletions;
                        for (const item of items) {
                            const newItem = new vscode.CompletionItem(
                                item.label,
                                item.kind || vscode.CompletionItemKind.Text
                            );
                            newItem.detail = item.detail || '';
                            newItem.documentation = item.documentation || '';
                            newItem.insertText = item.insertText || item.label;
                            completions.push(newItem);
                        }
                    }

                    return completions;
                }
                return [];
            }
        },
        '.', ' ', ':'
    );

    context.subscriptions.push(completionProvider);
}

function deactivate() {
    if (luaTempDoc && !luaTempDoc.isClosed) {
        luaTempDoc = null;
    }
}

module.exports = {
    activate,
    deactivate
};