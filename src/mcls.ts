import * as vscode from 'vscode';

export class TypedBrigadierArgument {
    type: string;
    name: string;

    constructor(type: string, name: string) {
        this.type = type;
        this.name = name;
    }
}

export class BrigadierCommand {
    argument: string | TypedBrigadierArgument;
    callable: boolean = false;
    next: BrigadierCommand[] = [];

    constructor(argument: string | TypedBrigadierArgument, callable: boolean) {
        this.argument = argument;
        this.callable = callable;
    }

    parse(line: string): {
        properties: { [key: string]: string };
        remainder: string;
        next: BrigadierCommand[];
    } | null {
        let properties: { [key: string]: string } = {};
        if (typeof this.argument === "string") {
            if (!line.startsWith(this.argument)) return null;
            line = line.substring(this.argument.length).trimStart();
        } else {
            // TODO
            let split = line.split(' ');
            if (split.length < 2) return null;
            split.push(split.splice(1).join(' '));
            console.log(split, this.argument)
            properties[this.argument.name] = split[0];
            line = split[1].trimStart();
        }

        for (const command of this.next) {
            const match = command.parse(line);
            if (match) {
                match.properties = {
                    ...properties,
                    ...match.properties,
                };
                return match;
            }
        }
        return {
            properties,
            remainder: line,
            next: this.next,
        }
    }

    getCompletions(remainder: string): vscode.CompletionItem[] {
        const documented = (label: string, kind: vscode.CompletionItemKind, doc: string) => {
            const completion = new vscode.CompletionItem(label, kind);
            completion.documentation = doc;
            return completion;
        }

        let completions: vscode.CompletionItem[] = [];
        if (typeof this.argument === "string") completions = [new vscode.CompletionItem(this.argument, vscode.CompletionItemKind.Function)];
        else if (this.argument.type == "EntityArgument") completions = [
            documented("@p", vscode.CompletionItemKind.EnumMember, "the nearest player"),
            documented("@r", vscode.CompletionItemKind.EnumMember, "a random player"),
            documented("@a", vscode.CompletionItemKind.EnumMember, "all players"),
            documented("@e", vscode.CompletionItemKind.EnumMember, "all entities"),
            documented("@s", vscode.CompletionItemKind.EnumMember, "the entity executing the command"),
            documented("@n", vscode.CompletionItemKind.EnumMember, "the nearest entity"),
        ];

        return completions.filter(completion => (completion.insertText || completion.label).toString().startsWith(remainder));
    }
}

export class McLanguageServer implements vscode.CompletionItemProvider {
    commands: BrigadierCommand = new BrigadierCommand("", false);

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const documetnLine = document.lineAt(position.line);
        const line = documetnLine.text.substring(documetnLine.firstNonWhitespaceCharacterIndex, position.character);
        const command = this.commands.parse(line)!;
        console.log(command);
        const completions = command.next.flatMap(cmd => cmd.getCompletions(command.remainder));
        return completions.map(completion => {
            completion.commitCharacters = completion.commitCharacters || [];
            completion.commitCharacters.push(' ');
            return completion;
        })
    }
}
