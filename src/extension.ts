import * as vscode from 'vscode';
import { regex } from 'regex';
import * as fs from 'node:fs';

import { TypedBrigadierArgument, BrigadierCommand, McLanguageServer } from './mcls';

export function activate(context: vscode.ExtensionContext) {
    const provider = new McLanguageServer();
    fs.readFile(context.asAbsolutePath('commands.txt'), (err, data) => {
        if (err) throw err;
        const lines = data.toString().split('\n');
        lines.splice(0, 1), lines.pop();

        let currentNodes: BrigadierCommand[][] = [[new BrigadierCommand('', false)]];
        let argumentTypes = new Set();
        for (const line of lines) {
            const tline = line.trimStart();
            const depth = (line.length - tline.length) / 2;
            currentNodes.splice(depth);

            let currentNodeVariants = currentNodes[depth - 1];
            const inlineNodes = tline.split('    >    ');
            for (const inlineNode of inlineNodes) {
                const variants = inlineNode.split(' | ');
                const nextNodeVariants = variants.map(variant => {
                    const callable = variant.endsWith('()');
                    if (callable) variant = variant.substring(0, variant.length - 2);

                    if (variant.startsWith('"') && variant.endsWith('"')) {
                        return new BrigadierCommand(variant.substring(1, variant.length - 1), callable);
                    }

                    argumentTypes.add(variant.split(' ')[0]);
                    return new BrigadierCommand(new TypedBrigadierArgument(
                        variant.split(' ')[0],
                        variant.split(' ')[1]
                    ), callable);
                });

                for (const variant of currentNodeVariants) variant.next.push(...nextNodeVariants);
                currentNodeVariants = nextNodeVariants;
            }

            currentNodes.push(currentNodeVariants);
        }

        provider.commands.next.push(...currentNodes[0][0].next);
    });

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