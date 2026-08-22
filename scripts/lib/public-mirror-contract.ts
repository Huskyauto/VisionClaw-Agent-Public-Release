import * as ts from "typescript";

type ContractResult = { ok: true; message: string } | { ok: false; message: string };

type ExportedSymbol =
  | { kind: "function"; name: string; signature: string }
  | { kind: "interface"; name: string; signature: string; members: Map<string, string> }
  | { kind: "type"; name: string; signature: string }
  | { kind: "value"; name: string; signature: string };

function isExported(node: ts.Node): boolean {
  return !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function isDefaultExport(node: ts.Node): boolean {
  return !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

function contractText(text: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind !== ts.SyntaxKind.SemicolonToken) tokens.push(scanner.getTokenText());
  }
  return tokens.join(" ");
}

function declarationName(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function typeParametersContract(typeParameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined): string {
  if (!typeParameters || typeParameters.length === 0) return "";
  return `<${typeParameters.map((parameter) => contractText(parameter.getText())).join(", ")}>`;
}

function heritageContract(heritageClauses: ts.NodeArray<ts.HeritageClause> | undefined): string {
  if (!heritageClauses || heritageClauses.length === 0) return "";
  return heritageClauses
    .map((clause) => `${ts.tokenToString(clause.token) ?? ts.SyntaxKind[clause.token]} ${clause.types.map((type) => contractText(type.getText())).join(", ")}`)
    .join(" ");
}

function interfaceMemberContract(member: ts.TypeElement): [string, string] | null {
  if (ts.isPropertySignature(member)) {
    const name = declarationName(member.name);
    if (!name || !member.type) return null;
    const readonly = member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ? "readonly " : "";
    return [name, `${readonly}${name}${member.questionToken ? "?" : ""}: ${contractText(member.type.getText())}`];
  }
  if (ts.isMethodSignature(member)) {
    const name = declarationName(member.name);
    if (!name || !member.type || member.parameters.some((parameter) => !parameter.type)) return null;
    const params = member.parameters.map((parameter) => contractText(parameter.getText())).join(", ");
    return [
      name,
      `${name}${member.questionToken ? "?" : ""}${typeParametersContract(member.typeParameters)}(${params}) => ${contractText(member.type.getText())}`,
    ];
  }
  if (ts.isIndexSignatureDeclaration(member)) {
    return ["[index]", contractText(member.getText())];
  }
  return null;
}

function functionContract(node: ts.FunctionDeclaration): string {
  const params = node.parameters.map((parameter) => contractText(parameter.getText())).join(", ");
  const returnType = node.type ? contractText(node.type.getText()) : "unknown";
  return `${typeParametersContract(node.typeParameters)}(${params}) => ${returnType}`;
}

function valueContract(declaration: ts.VariableDeclaration, declarationList: ts.VariableDeclarationList): string | null {
  if (!declaration.type) return null;
  const declarationKind =
    declarationList.flags & ts.NodeFlags.Const ? "const" : declarationList.flags & ts.NodeFlags.Let ? "let" : "var";
  return `${declarationKind}: ${contractText(declaration.type.getText())}`;
}

function readExports(source: string, fileName: string): { symbols: Map<string, ExportedSymbol>; error?: string } {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) {
    return { symbols: new Map(), error: `could not parse ${fileName}: ${sourceFile.parseDiagnostics[0].messageText}` };
  }

  const symbols = new Map<string, ExportedSymbol>();
  const unsupported: string[] = [];
  const addSymbol = (symbol: ExportedSymbol): void => {
    if (symbols.has(symbol.name)) {
      unsupported.push(`duplicate exported declaration "${symbol.name}"`);
      return;
    }
    symbols.set(symbol.name, symbol);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      unsupported.push("default export assignment");
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      unsupported.push("re-export declaration");
      continue;
    }
    if (isDefaultExport(statement)) {
      unsupported.push("default export declaration");
      continue;
    }
    if (!isExported(statement)) continue;

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      if (!statement.type || statement.parameters.some((parameter) => !parameter.type)) {
        unsupported.push(`exported function "${statement.name.text}" has an unannotated signature`);
        continue;
      }
      addSymbol({ kind: "function", name: statement.name.text, signature: functionContract(statement) });
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      const members = new Map<string, string>();
      for (const member of statement.members) {
        const contract = interfaceMemberContract(member);
        if (!contract) {
          unsupported.push(`interface ${statement.name.text} member ${ts.SyntaxKind[member.kind]}`);
          continue;
        }
        if (members.has(contract[0])) {
          unsupported.push(`interface ${statement.name.text} has duplicate member "${contract[0]}"`);
          continue;
        }
        members.set(...contract);
      }
      addSymbol({
        kind: "interface",
        name: statement.name.text,
        signature: `${typeParametersContract(statement.typeParameters)}${heritageContract(statement.heritageClauses) ? ` ${heritageContract(statement.heritageClauses)}` : ""}`,
        members,
      });
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      addSymbol({
        kind: "type",
        name: statement.name.text,
        signature: `${typeParametersContract(statement.typeParameters)} = ${contractText(statement.type.getText())}`,
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = declarationName(declaration.name);
        if (!name) {
          unsupported.push(`variable ${ts.SyntaxKind[declaration.name.kind]}`);
          continue;
        }
        const signature = valueContract(declaration, statement.declarationList);
        if (!signature) {
          unsupported.push(`exported value "${name}" has no explicit type`);
          continue;
        }
        addSymbol({ kind: "value", name, signature });
      }
      continue;
    }

    unsupported.push(ts.SyntaxKind[statement.kind]);
  }

  if (unsupported.length > 0) {
    return {
      symbols,
      error: `${fileName} has unsupported export declaration(s): ${unsupported.join(", ")}. Extend the public-mirror contract guard before releasing.`,
    };
  }

  return { symbols };
}

/**
 * Fail closed when a generated public-mirror replacement no longer implements
 * every private module API that the copied mirror can import.
 *
 * Mirror-only exports are allowed: sanitized fixtures may expose deprecated
 * compatibility helpers until copied consumers stop referencing them.
 */
export function compareMirrorContract(
  privateSource: string,
  mirrorSource: string,
  modulePath: string,
): ContractResult {
  const upstream = readExports(privateSource, `private/${modulePath}`);
  const mirror = readExports(mirrorSource, `mirror/${modulePath}`);
  if (upstream.error) return { ok: false, message: upstream.error };
  if (mirror.error) return { ok: false, message: mirror.error };
  if (upstream.symbols.size === 0 || mirror.symbols.size === 0) {
    return { ok: false, message: `${modulePath} has an empty exported surface (fail closed)` };
  }

  for (const [name, expected] of upstream.symbols) {
    const actual = mirror.symbols.get(name);
    if (!actual) {
      return { ok: false, message: `${modulePath}: missing exported ${expected.kind} "${name}" in public mirror stub` };
    }
    if (actual.kind !== expected.kind) {
      return {
        ok: false,
        message: `${modulePath}: exported "${name}" is ${actual.kind} in public mirror but ${expected.kind} upstream`,
      };
    }
    if ((expected.kind === "function" || expected.kind === "type") && actual.signature !== expected.signature) {
      return {
        ok: false,
        message: `${modulePath}: exported ${expected.kind} "${name}" signature drifted (upstream ${expected.signature}; mirror ${actual.signature})`,
      };
    }
    if (expected.kind === "interface" && actual.kind === "interface") {
      if (actual.signature !== expected.signature) {
        return {
          ok: false,
          message: `${modulePath}: exported interface "${name}" signature drifted (upstream ${expected.signature}; mirror ${actual.signature})`,
        };
      }
      for (const [memberName, memberContract] of expected.members) {
        const mirrorMember = actual.members.get(memberName);
        if (!mirrorMember) {
          return {
            ok: false,
            message: `${modulePath}: exported interface "${name}" is missing member "${memberName}" in public mirror stub`,
          };
        }
        if (mirrorMember !== memberContract) {
          return {
            ok: false,
            message: `${modulePath}: exported interface "${name}" member "${memberName}" drifted (upstream ${memberContract}; mirror ${mirrorMember})`,
          };
        }
      }
    }
    if (expected.kind === "value" && actual.kind === "value" && expected.signature !== actual.signature) {
      return {
        ok: false,
        message: `${modulePath}: exported value "${name}" signature drifted (upstream ${expected.signature}; mirror ${actual.signature})`,
      };
    }
  }

  return {
    ok: true,
    message: `${modulePath}: public mirror implements all ${upstream.symbols.size} upstream exported contract member(s)`,
  };
}