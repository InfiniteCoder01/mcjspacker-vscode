import * as vscode from 'vscode';
import { regex } from 'regex';

import { TypedBrigadierArgument, BrigadierCommand, McLanguageServer } from './mcls';
import * as commands from './commands_data/commands.json';
import * as registries from './commands_data/registries.json';

export function activate(context: vscode.ExtensionContext) {
    const provider = new McLanguageServer();
    provider.commands_root = commands;
    provider.registries = registries;

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'mcfunction' },
            provider,
            ' '
        )
    );

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'javascript' },
            new McJsLanguageServer(provider),
            ' '
        )
    );
}

// TODO: Fix this regex
const BLOCK_REGEX = regex('g')`
(?<prefix>\w+(\.\w+)*\s*[\`])
(?<content>[^\`]*)
[\`]
`;

class McJsLanguageServer implements vscode.CompletionItemProvider {
    provider: McLanguageServer;

    constructor(provider: McLanguageServer) { this.provider = provider; }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const codeBlock = this.getMCFBlockCode(document, position);
        if (!codeBlock) return [];

        const [virtualDocument, virtualPosition, offset] = codeBlock;
        const completions = await this.provider.provideCompletionItems(virtualDocument, virtualPosition, token, context);

        for (const i in completions) {
            const convertPosition = (pos: vscode.Position) => document.positionAt(virtualDocument.offsetAt(pos) + offset);
            if (completions[i].range instanceof vscode.Range) {
                completions[i].range = new vscode.Range(
                    convertPosition(completions[i].range.start),
                    convertPosition(completions[i].range.end)
                );
            } else if (completions[i].range) {
                completions[i].range = {
                    inserting: new vscode.Range(
                        convertPosition(completions[i].range.inserting.start),
                        convertPosition(completions[i].range.inserting.end)
                    ),
                    replacing: new vscode.Range(
                        convertPosition(completions[i].range.replacing.start),
                        convertPosition(completions[i].range.replacing.end)
                    ),
                };
            }
        }

        return completions;
    }

    private getMCFBlockCode(document: vscode.TextDocument, position: vscode.Position): [vscode.TextDocument, vscode.Position, number] | null {
        const text = document.getText();
        const offset = document.offsetAt(position);

        for (const match of text.matchAll(BLOCK_REGEX)) {
            if (!match.groups) continue;
            const textStart = match.index + match.groups.prefix.length;
            const textEnd = textStart + match.groups.content.length;
            if (textStart > offset) return null;
            if (textEnd < offset) continue;

            const text = match.groups.content;
            const lines = text.split('\n');
            let lineOffsets = [];
            let vdocOffset = 0;
            for (const line of lines) {
                lineOffsets.push(vdocOffset);
                vdocOffset += line.length + 1;
            }

            const virtualDocument: vscode.TextDocument = {
                ...document,
                languageId: 'mcfunction',
                lineCount: lines.length,
                lineAt(line: number | vscode.Position): vscode.TextLine {
                    if (line instanceof vscode.Position) line = line.line;
                    let firstNonWhitespaceCharacterIndex = 0;
                    while (firstNonWhitespaceCharacterIndex < lines[line].length && lines[line][firstNonWhitespaceCharacterIndex].trim().length == 0) firstNonWhitespaceCharacterIndex++;
                    return {
                        lineNumber: line,
                        text: lines[line],
                        range: new vscode.Range(
                            new vscode.Position(line, 0),
                            new vscode.Position(line, lines[line].length),
                        ),
                        rangeIncludingLineBreak: new vscode.Range(
                            new vscode.Position(line, 0),
                            new vscode.Position(line, lines[line].length + (line < lines.length ? 1 : 0)),
                        ),
                        firstNonWhitespaceCharacterIndex,
                        isEmptyOrWhitespace: firstNonWhitespaceCharacterIndex == lines[line].length,
                    };
                },
                offsetAt: function (position: vscode.Position): number {
                    return lineOffsets[position.line] + position.character;
                },
                positionAt: function (offset: number): vscode.Position {
                    const line = lineOffsets.findIndex((lineOffset, index) => offset >= lineOffset && offset <= lineOffset + lines[index].length);
                    return new vscode.Position(line, offset - lineOffsets[line])
                },
                getText: function (range?: vscode.Range): string {
                    if (!range) return text;
                    return text.substring(virtualDocument.offsetAt(range.start), virtualDocument.offsetAt(range.end) - 1);
                },
                getWordRangeAtPosition: function (position: vscode.Position, regex?: RegExp): vscode.Range | undefined {
                    throw new Error('Function not implemented.');
                },
                validateRange: function (range: vscode.Range): vscode.Range {
                    throw new Error('Function not implemented.');
                },
                validatePosition: function (position: vscode.Position): vscode.Position {
                    throw new Error('Function not implemented.');
                },
            };

            const virtualPosition = virtualDocument.positionAt(document.offsetAt(position) - textStart);
            return [virtualDocument, virtualPosition, textStart];
        }

        return null;
    }
}