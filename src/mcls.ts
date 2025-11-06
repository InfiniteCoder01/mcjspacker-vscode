import * as vscode from 'vscode';

export class TypedBrigadierArgument {
    type: string;
    name: string;

    constructor(type: string, name: string) {
        this.type = type;
        this.name = name;
    }
}

export interface BrigadierCommand {
    type: string;
    redirect?: string | string[];
    children?: { [key: string]: BrigadierCommand };
    executable?: boolean;
    parser?: string;
}

export class McLanguageServer implements vscode.CompletionItemProvider {
    commands_root: BrigadierCommand = { type: "root", children: {} };
    registries: {
        [key: string]: string[];
        item: string[];
        block: string[];
    } = {
        item: [],
        block: [],
    };

    tryParse(root: BrigadierCommand, line: string): {
        properties: { [key: string]: string };
        remainder: string;
        tip: BrigadierCommand;
    } {
        for (const name in root.children) {
            let command = root.children[name];
            while (command.redirect) command = root.children[command.redirect[0]];
            let properties: { [key: string]: string } = {};
            if (command.type == "literal") {
                if (!line.startsWith(name)) continue;
                line = line.substring(name.length).trimStart()
            } else if (command.type == "argument") {
                let argNumber = 1;
                if (command.parser == "minecraft:block_pos" || command.parser == "minecraft:vec3") argNumber = 3;
                else if (command.parser == "minecraft:rotation") argNumber = 2;
                let split = line.split(' ');
                if (split.length < argNumber + 1) continue;
                properties[name] = split.splice(0, argNumber).join(' ');
                line = split.join(' ').trimStart();
            }

            const parse = this.tryParse(command, line);
            parse.properties = {
                ...properties,
                ...parse.properties,
            };
            return parse;
        }

        return {
            properties: {},
            remainder: line,
            tip: root,
        };
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const documetnLine = document.lineAt(position.line);
        const line = documetnLine.text.substring(documetnLine.firstNonWhitespaceCharacterIndex, position.character);
        const parse = this.tryParse(this.commands_root, line);

        const documented = (label: string, kind: vscode.CompletionItemKind, doc: string) => {
            const completion = new vscode.CompletionItem(label, kind);
            completion.documentation = doc;
            return completion;
        };

        let completions: vscode.CompletionItem[] = [];
        for (const name in parse.tip.children) {
            let command = parse.tip.children[name];
            while (command.redirect) command = parse.tip.children[command.redirect[0]];
            if (command.type === "literal") completions.push(new vscode.CompletionItem(name, vscode.CompletionItemKind.Function));
            else if (command.parser == "minecraft:entity") completions.push( // TODO: Filter type and amount
                documented("@p", vscode.CompletionItemKind.EnumMember, "the nearest player"),
                documented("@r", vscode.CompletionItemKind.EnumMember, "a random player"),
                documented("@a", vscode.CompletionItemKind.EnumMember, "all players"),
                documented("@e", vscode.CompletionItemKind.EnumMember, "all entities"),
                documented("@s", vscode.CompletionItemKind.EnumMember, "the entity executing the command"),
                documented("@n", vscode.CompletionItemKind.EnumMember, "the nearest entity"),
            );
            else if (command.parser == "minecraft:block_pos" || command.parser == "minecraft:vec3") completions.push(
                new vscode.CompletionItem("~ ~ ~", vscode.CompletionItemKind.Value),
                new vscode.CompletionItem("^ ^ ^", vscode.CompletionItemKind.Value),
            );
            else if (command.parser == "minecraft:rotation") completions.push(
                new vscode.CompletionItem("~ ~", vscode.CompletionItemKind.Value),
            );
            else if (command.parser == "minecraft:item_stack") completions.push(
                ...this.registries.item.map(item => new vscode.CompletionItem(item, vscode.CompletionItemKind.EnumMember))
            );
            else if (command.parser == "minecraft:block_state" || command.parser == "minecraft:block_predicate") completions.push(
                ...this.registries.block.map(block => new vscode.CompletionItem(block, vscode.CompletionItemKind.EnumMember))
            );
        }

        return completions
            .filter(completion => (completion.insertText || completion.label).toString().startsWith(parse.remainder))
            .map(completion => {
                completion.commitCharacters = completion.commitCharacters || [];
                completion.commitCharacters.push(' ');
                return completion;
            });
    }
}
