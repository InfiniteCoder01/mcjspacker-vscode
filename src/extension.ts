import * as vscode from 'vscode';
import { regex } from 'regex';
import * as mcf from '@spyglassmc/mcfunction'

let completer;

export function activate(context: vscode.ExtensionContext) {
    const provider = new McFunctionCompletionProvider();
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'javascript' },
            provider,
            ' '
        )
    );
}

const BLOCK_REGEX = regex('g')`
(?<prefix>\w+(\.\w+)*\s*[\`])
(?<content>[^\`]*)
[\`]
`;

class McFunctionCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        let code_block = this.getMCFBlockCode(document, position);
        if (!code_block) return [];

        let [content, offset] = code_block;
        const virtualDocument = await vscode.workspace.openTextDocument({
            language: 'mcfunction',
            content,
        });
        const virtualPosition = virtualDocument.positionAt(document.offsetAt(position) - offset);

        const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            virtualDocument.uri,
            virtualPosition,
            context.triggerCharacter,
        );

        const items = completions.items;
        for (let i in items) {
            const convertPosition = pos => document.positionAt(virtualDocument.offsetAt(pos) + offset);
            if (items[i].range instanceof vscode.Range) {
                items[i].range = new vscode.Range(
                    convertPosition(items[i].range.start),
                    convertPosition(items[i].range.end)
                );
            } else if (items[i].range) {
                items[i].range = {
                    inserting: new vscode.Range(
                        convertPosition(items[i].range.inserting.start),
                        convertPosition(items[i].range.inserting.end)
                    ),
                    replacing: new vscode.Range(
                        convertPosition(items[i].range.replacing.start),
                        convertPosition(items[i].range.replacing.end)
                    ),
                };
            }
        }
        return items;
    }

    private getMCFBlockCode(document: vscode.TextDocument, position: vscode.Position): [string, number] | null {
        const text = document.getText();
        const offset = document.offsetAt(position);

        for (const match of text.matchAll(BLOCK_REGEX)) {
            if (!match.groups) continue;
            const textStart = match.index + match.groups.prefix.length;
            const textEnd = textStart + match.groups.content.length;
            if (textStart > offset) return null;
            if (textEnd < offset) continue;
            return [match.groups.content, textStart];
        }

        return null;
    }
}