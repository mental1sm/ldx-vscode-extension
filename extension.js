const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function getInheritedAttributes(tag, mappings) {
    const result = new Set();
    
    function collectDermaAttributes(currentTag) {
        if (!currentTag || !mappings.inheritance[currentTag]) return;

        if (mappings.dermaMappings[currentTag]) {
            mappings.dermaMappings[currentTag].forEach(attr => result.add(attr));
        }

        const parents = mappings.inheritance[currentTag];
        if (parents) {
            parents.forEach(parent => collectDermaAttributes(parent));
        }
    }
    
    collectDermaAttributes(tag);
    return Array.from(result);
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const jsonPath = path.join(context.extensionPath, 'derma-mappings.json');
    const mappings = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    const tags = Object.keys(mappings.dermaMappings);
    const attributes = Object.keys(mappings.baseMappings).filter(
        key => !key.startsWith('_')
    );

    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'ldx',
        {
            provideCompletionItems(document, position) {
                const line = document.lineAt(position.line);
                const linePrefix = line.text.substr(0, position.character);
                const lineSuffix = line.text.substr(position.character);

                // Проверяем количество открытых скобок "{"
                const isInsideLuaCode = (() => {
                    let openBrackets = 0;
                    let fullTextBefore = '';
                    for (let i = position.line; i >= 0; i--) {
                        const currentLineText = i === position.line ? linePrefix : document.lineAt(i).text;
                        fullTextBefore = currentLineText + '\n' + fullTextBefore;
                        for (let char of currentLineText) {
                            if (char === '{') openBrackets++;
                            if (char === '}') openBrackets--;
                        }
                    }
                    return openBrackets >= 2;
                })();

                // Проверяем, находимся ли внутри [& ... &] в Lua-коде
                const isInsideLuaLdx = (() => {
                    if (!isInsideLuaCode) return false;
                    let fullTextBefore = '';
                    for (let i = position.line; i >= 0; i--) {
                        const currentLineText = i === position.line ? linePrefix : document.lineAt(i).text;
                        fullTextBefore = currentLineText + '\n' + fullTextBefore;
                    }
                    const openLdx = fullTextBefore.lastIndexOf('[&');
                    const closeLdx = fullTextBefore.lastIndexOf('&]');
                    return openLdx !== -1 && (closeLdx === -1 || closeLdx < openLdx);
                })();

                // Проверяем, находимся ли внутри Lua-кода атрибута (после = и внутри {})
                const isInsideAttributeLua = (() => {
                    let fullTextBefore = '';
                    for (let i = position.line; i >= 0; i--) {
                        const currentLineText = i === position.line ? linePrefix : document.lineAt(i).text;
                        fullTextBefore = currentLineText + '\n' + fullTextBefore;
                    }
                    const lastTagStart = fullTextBefore.lastIndexOf('<');
                    if (lastTagStart === -1) return false;
                    const tagText = fullTextBefore.substring(lastTagStart);
                    const lastEquals = tagText.lastIndexOf('=');
                    if (lastEquals === -1) return false;
                    const afterEquals = tagText.substring(lastEquals + 1);
                    let openBrackets = 0;
                    for (let char of afterEquals) {
                        if (char === '{') openBrackets++;
                        if (char === '}') openBrackets--;
                    }
                    return openBrackets > 0;
                })();

                // Проверяем, хотим ли мы вставить новый тег (сразу после "<")
                if (linePrefix.trim().endsWith('<') && (!isInsideLuaCode || isInsideLuaLdx)) {
                    return tags.map(tag => {
                        const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Class);
                        const hasClosingBracket = lineSuffix.trim().startsWith('>');
                        item.insertText = new vscode.SnippetString(hasClosingBracket ? `${tag}$1` : `${tag}$1>`);
                        item.detail = `Derma component: ${tag}`;
                        item.documentation = new vscode.MarkdownString(
                            `Supported attributes: ${getInheritedAttributes(tag, mappings).join(', ')}`
                        );
                        return item;
                    });
                }

                // Проверяем контекст для атрибутов: ищем незакрытый тег в предыдущих строках
                let fullPrefix = linePrefix;
                let currentLine = position.line;
                let openTagMatch = fullPrefix.match(/<([A-Za-z]+)(?:\s+[^>]*)?$/);
                while (!openTagMatch && currentLine > 0) {
                    currentLine--;
                    fullPrefix = document.lineAt(currentLine).text + '\n' + fullPrefix;
                    openTagMatch = fullPrefix.match(/<([A-Za-z]+)(?:\s+[^>]*)?$/);
                }

                // Если нашли открытый тег и мы внутри него (после пробела или перед атрибутом), и не в Lua-коде атрибута
                if (openTagMatch && (linePrefix.match(/\s+$/) || linePrefix.match(/<([A-Za-z]+)$/)) && (!isInsideLuaCode || isInsideLuaLdx) && !isInsideAttributeLua) {
                    const currentTag = openTagMatch[1];
                    const supportedAttributes = getInheritedAttributes(currentTag, mappings);

                    return attributes
                        .filter(attr => supportedAttributes.includes(attr))
                        .map(attr => {
                            const mapping = mappings.baseMappings[attr];
                            const item = new vscode.CompletionItem(attr, vscode.CompletionItemKind.Property);

                            switch (mapping.mapType) {
                                case 'property':
                                    item.kind = vscode.CompletionItemKind.Property;
                                    break;
                                case 'classFunc':
                                    item.kind = vscode.CompletionItemKind.Method;
                                    break;
                                case 'func':
                                    item.kind = vscode.CompletionItemKind.Function;
                                    break;
                                default:
                                    item.kind = vscode.CompletionItemKind.Property;
                            }

                            if (mapping.noArgs) {
                                item.insertText = attr;
                            } else {
                                item.insertText = new vscode.SnippetString(`${attr}={\$1}`);
                            }

                            item.detail = `${mapping.method} (${mapping.mapType})`;
                            item.documentation = new vscode.MarkdownString(
                                `Maps to: \`${mapping.mapType === 'property' ? '.' : ':'}${mapping.method}\``
                            );
                            return item;
                        });
                }

                // Автодополнение директив вне тегов, но не в Lua-коде (и не в LDX внутри Lua)
                const isInsideTag = fullPrefix.match(/<[^>]*$/);
                if (!isInsideTag && !isInsideLuaCode) {
                    return [
                        {
                            label: 'MAP',
                            kind: vscode.CompletionItemKind.Keyword,
                            detail: 'Directive: Requires table in arg\nshortcuts: $INDEX $ITEM',
                            insertText: new vscode.SnippetString('MAP(${1:arg}) [${2:}]'),
                            documentation: new vscode.MarkdownString('Usage: `MAP((table) [\nexpression\n]`')
                        },
                        {
                            label: 'IF',
                            kind: vscode.CompletionItemKind.Keyword,
                            detail: 'Directive: Conditional rendering',
                            insertText: new vscode.SnippetString('IF(${1:arg}) [${2:}]'),
                            documentation: new vscode.MarkdownString('Usage: `IF={condition}` - Renders component if condition is true.')
                        },
                        {
                            label: 'INJECT',
                            kind: vscode.CompletionItemKind.Keyword,
                            detail: 'Directive: Injects content or logic',
                            insertText: new vscode.SnippetString('INJECT(${1:arg})'),
                            documentation: new vscode.MarkdownString('Usage: `INJECT={content}` - Injects content or logic into the component.')
                        }
                    ];
                }

                return [];
            }
        },
        '<', ' ', 'M', 'I' // Триггеры: "<" для тегов, пробел для атрибутов, "M" и "I" для директив
    );

    context.subscriptions.push(completionProvider);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};