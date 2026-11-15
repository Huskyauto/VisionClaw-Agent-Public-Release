import ts from "typescript";

/** Syntactic evidence only: never executes source or resolves computed targets. */
export function analyzeSource(fileName: string, body: string): { imports: string[]; exports: string[] } {
  const source = ts.createSourceFile(fileName, body, ts.ScriptTarget.Latest, false);
  const imports: string[] = [];
  const exports = new Set<string>();
  const literal = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) imports.push(node.text);
  };
  function binding(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) exports.add(name.text);
    else for (const part of name.elements) if (ts.isBindingElement(part)) binding(part.name);
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
      literal(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal(node.argument.literal);
    else if (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
       (ts.isIdentifier(node.expression) && node.expression.text === "require"))) literal(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause))
        for (const element of statement.exportClause.elements) exports.add(element.name.text);
      else exports.add(statement.exportClause.name.text);
    }
    if (ts.isExportAssignment(statement)) exports.add("default");
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) exports.add("default");
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) binding(declaration.name);
    else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) && statement.name)
      exports.add(statement.name.text);
  }
  return { imports, exports: [...exports].sort() };
}
