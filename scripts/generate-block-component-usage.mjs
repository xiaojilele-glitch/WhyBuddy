import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const DESKTOP_FILE = path.join(
  ROOT,
  "client/src/pages/sliderule/live-runtime/block-registry.tsx"
);
const PHONE_FILE = path.join(
  ROOT,
  "client/src/pages/sliderule/live-runtime/phone-mobile/PhoneExperienceBlock.tsx"
);
const RUNTIME_DIR = path.join(ROOT, "client/src/pages/sliderule/live-runtime");
const OUTPUT_FILE = path.join(
  ROOT,
  "client/src/pages/sliderule/generated/block-component-usage.json"
);

const CATALOG_ARRAYS = new Map([
  ["base-catalog.tsx", "PC_BASE_COMPONENTS"],
  ["base-catalog-mobile.tsx", "MOBILE_BASE_COMPONENTS"],
  ["base-catalog-pro.tsx", "PRO_BASE_COMPONENTS"],
  ["base-catalog-custom.tsx", "CUSTOM_BASE_COMPONENTS"],
]);

/**
 * 自研组件的实现模块（2026-08-10）。
 *
 * 此前这份统计只认三个模块的 import——`antd` / `@ant-design/pro-components`
 * / `antd-mobile`。自定义档那 7 个组件（CodeEditor、SignaturePad…）**结构上
 * 永远统计不到**：它们不从这三个模块来。ECharts 是靠一条硬编码的标识符特例
 * （`LazyEchartsChart` → `ECharts`）混进来的，那说明这个盲区早就存在，只是
 * 用一条补丁盖住了一个。
 *
 * 这个盲区不是小数点问题：它让"接线做了没有"这件事在数字上完全看不出来。
 * 审目录时我据此得出「自定义档零引用」，那个结论当时是对的，但**即使有人接了
 * 也会得出同样的结论**——这种指标是靠不住的。
 *
 * 现在改成认这一个模块：从它导入的名字**就是**目录里的组件名（导出名与
 * `name` 字段一一对应，见 custom-components.tsx 的文件头）。
 */
const CUSTOM_COMPONENT_MODULE = "base-components/custom-components";

function sourceFile(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function propertyName(node) {
  if (!node) return undefined;
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
  )
    return node.text;
  return undefined;
}

function variableInitializer(source, variableName) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === variableName
      )
        return declaration.initializer;
    }
  }
  return undefined;
}

function objectLiteralName(object) {
  const nameProperty = object.properties.find(
    property =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === "name"
  );
  return nameProperty &&
    ts.isPropertyAssignment(nameProperty) &&
    ts.isStringLiteral(nameProperty.initializer)
    ? nameProperty.initializer.text
    : undefined;
}

function returnedObjectLiteral(fn) {
  if (!fn?.body) return undefined;
  if (ts.isParenthesizedExpression(fn.body) &&
      ts.isObjectLiteralExpression(fn.body.expression))
    return fn.body.expression;
  if (ts.isObjectLiteralExpression(fn.body)) return fn.body;
  return undefined;
}

/** `formItem("ProFormText", "文本框", …)` —— 名字是工厂的第几个入参，问工厂本人。 */
function helperCallName(element, source) {
  if (!ts.isCallExpression(element) || !ts.isIdentifier(element.expression))
    return undefined;
  const helper = variableInitializer(source, element.expression.text);
  const object = returnedObjectLiteral(helper);
  if (!object || !ts.isArrowFunction(helper)) return undefined;
  const nameProperty = object.properties.find(
    property =>
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)) &&
      propertyName(property.name) === "name"
  );
  if (!nameProperty) return undefined;
  const bound = ts.isShorthandPropertyAssignment(nameProperty)
    ? nameProperty.name.text
    : ts.isIdentifier(nameProperty.initializer)
      ? nameProperty.initializer.text
      : undefined;
  const index = helper.parameters.findIndex(
    parameter =>
      ts.isIdentifier(parameter.name) && parameter.name.text === bound
  );
  const argument = index >= 0 ? element.arguments[index] : undefined;
  return argument && ts.isStringLiteral(argument) ? argument.text : undefined;
}

function unwrapAs(expression) {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) || ts.isParenthesizedExpression(current))
  )
    current = current.expression;
  return current;
}

/** `...([["money", …], …] as …).map(([vt]) => ({ name: `ProField.${vt}` }))` */
function spreadMappedNames(element) {
  if (!ts.isSpreadElement(element)) return [];
  const call = unwrapAs(element.expression);
  if (
    !ts.isCallExpression(call) ||
    !ts.isPropertyAccessExpression(call.expression) ||
    call.expression.name.text !== "map"
  )
    return [];
  const rows = unwrapAs(call.expression.expression);
  const callback = call.arguments[0];
  const object = ts.isArrowFunction(callback)
    ? returnedObjectLiteral(callback)
    : undefined;
  if (!ts.isArrayLiteralExpression(rows) || !object) return [];

  const parameter = callback.parameters[0]?.name;
  const slots = ts.isArrayBindingPattern(parameter)
    ? parameter.elements.map(binding =>
        ts.isBindingElement(binding) && ts.isIdentifier(binding.name)
          ? binding.name.text
          : undefined
      )
    : [];
  const nameProperty = object.properties.find(
    property =>
      ts.isPropertyAssignment(property) && propertyName(property.name) === "name"
  );
  if (!nameProperty || !ts.isPropertyAssignment(nameProperty)) return [];
  const template = nameProperty.initializer;
  if (!ts.isTemplateExpression(template)) return [];

  const names = [];
  for (const row of rows.elements) {
    if (!ts.isArrayLiteralExpression(row)) continue;
    let text = template.head.text;
    let resolved = true;
    for (const span of template.templateSpans) {
      const slot = ts.isIdentifier(span.expression)
        ? slots.indexOf(span.expression.text)
        : -1;
      const value = slot >= 0 ? row.elements[slot] : undefined;
      if (!value || !ts.isStringLiteral(value)) {
        resolved = false;
        break;
      }
      text += value.text + span.literal.text;
    }
    if (resolved) names.push(text);
  }
  return names;
}

/**
 * 目录里的组件名。
 *
 * 三种写法都要认（2026-08-10）：对象字面量、`formItem(…)` 工厂调用、以及
 * `...[…].map(…)` 批量展开。此前只认第一种，于是 218 条目录只读出 176 条——
 * 漏掉的 42 条正好是 32 个 ProForm 控件 + 10 个 ProField 只读字段。
 *
 * 漏读的后果不是少几行：`knownNames` 同时是「渲染了但目录里没有」这条护栏的
 * 判据，也是 `memberQualified` 的查表依据。名单缺一块，护栏就会把真实存在的
 * 条目当成不存在，统计里那些条目则永远是零引用。这已经是同一处度量在同一天
 * 里第三次因为盲区给出错误结论了（前两次：自定义档、spread 登记的 43 个区块）。
 *
 * 所以除了补齐读法，还把读到的名单写进产物的 `audit.catalogComponents`，由
 * ssot-parity 用运行时真正的 `BASE_COMPONENTS` 对账——下次再漏，红的是测试，
 * 而不是某个我据此下的结论。
 */
function catalogNames() {
  const names = new Set();
  const directory = path.join(
    ROOT,
    "client/src/pages/sliderule/base-components"
  );
  for (const [file, variableName] of CATALOG_ARRAYS) {
    const source = sourceFile(path.join(directory, file));
    const initializer = variableInitializer(source, variableName);
    if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
      throw new Error(`${variableName} array not found in ${file}`);
    }
    for (const element of initializer.elements) {
      const name = ts.isObjectLiteralExpression(element)
        ? objectLiteralName(element)
        : helperCallName(element, source);
      if (name) {
        names.add(name);
        continue;
      }
      const mapped = spreadMappedNames(element);
      if (mapped.length > 0) {
        for (const value of mapped) names.add(value);
        continue;
      }
      throw new Error(
        `${variableName} 里有一条读不出组件名的条目（${file}:${
          source.getLineAndCharacterOfPosition(element.getStart()).line + 1
        }）。目录多了一种写法就要在 catalogNames 里认，否则这条会静默漏掉。`
      );
    }
  }
  return names;
}

function createProject() {
  const configFile = ts.findConfigFile(
    ROOT,
    ts.sys.fileExists,
    "tsconfig.json"
  );
  if (!configFile) throw new Error("tsconfig.json not found");
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n")
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configFile)
  );
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
}

function importDeclarationOf(node) {
  let current = node;
  while (current && !ts.isImportDeclaration(current)) current = current.parent;
  return current && ts.isImportDeclaration(current) ? current : undefined;
}

/**
 * 成员档条目：目录里叫 `ProFormText.Password` / `ProField.money` /
 * `StatisticCard.Group`，代码里是 `ProFormText` 这个导入名加一次属性访问。
 * 只看导入名的话，这类条目**永远统计不到**——和 ProForm 折叠是同一种病。
 */
function memberQualified(identifier, base, knownNames) {
  const parent = identifier.parent;
  if (
    parent &&
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === identifier
  ) {
    const qualified = `${base}.${parent.name.text}`;
    if (knownNames.has(qualified)) return qualified;
  }
  return base;
}

function componentIdFromImport(identifier, symbol, device, knownNames) {
  for (const declaration of symbol?.declarations ?? []) {
    if (!ts.isImportSpecifier(declaration)) continue;
    const importDeclaration = importDeclarationOf(declaration);
    if (
      !importDeclaration ||
      !ts.isStringLiteral(importDeclaration.moduleSpecifier) ||
      declaration.isTypeOnly ||
      importDeclaration.importClause?.isTypeOnly
    )
      continue;
    const moduleName = importDeclaration.moduleSpecifier.text;
    // 自研组件是 pc 档（目录里 platform: "pc"），只在桌面侧计数。
    if (device === "desktop" && moduleName.endsWith(CUSTOM_COMPONENT_MODULE)) {
      const custom = declaration.propertyName?.text ?? declaration.name.text;
      return memberQualified(identifier, custom, knownNames);
    }
    const supported =
      device === "desktop"
        ? moduleName === "antd" || moduleName === "@ant-design/pro-components"
        : moduleName === "antd-mobile";
    if (!supported) continue;
    const imported = declaration.propertyName?.text ?? declaration.name.text;
    if (imported === "theme") return undefined;
    /**
     * 此前这里把所有 `ProForm*` 折叠成一个 `ProForm`（2026-08-10 之前）。
     * 注释里的理由是"目录刻意把它们建模成一个 ProForm 能力"——那个理由**过期
     * 了**：目录现在逐个列了 `ProFormText`/`ProFormDigit`/… 36 条独立条目。
     * 折叠的后果是这 36 条**结构上永远统计不到**：`block-registry.tsx` 明明
     * 导入并渲染了 ProFormText、ProFormDigit，图里记的却是 ProForm，于是它们
     * 在"零引用"名单里躺着——和自定义档那个盲区一模一样的错。
     *
     * 保留的只有 EditableProTable 这一条：CellEditorTable / RowEditorTable 是
     * 本地包装件，目录里没有它们，指向的确实是同一个可编辑表格能力。
     */
    const normalized =
      device === "desktop" &&
      (imported === "CellEditorTable" || imported === "RowEditorTable")
        ? "EditableProTable"
        : imported;
    return memberQualified(
      identifier,
      device === "phone" ? `M.${normalized}` : normalized,
      knownNames
    );
  }
  return undefined;
}

/** 图表宿主模块。三个入口都指向它，见 referencesEchartsHost。 */
const ECHARTS_HOST_MODULE = "live-runtime/EchartsChart";

/**
 * 这个标识符是不是**图表宿主**（2026-08-10 从认名字改成认模块）。
 *
 * 此前判据是两个写死的名字：`LazyEchartsChart` / `PhoneLazyEchartsChart`。
 * 于是第三个入口——`analysis-dependency-blocks.tsx` 的
 * `import EchartsChart from "./EchartsChart"`——认不出来，13 个分析图区块
 * 一个 ECharts 都没统计到。
 *
 * 认名字这件事本身就是个补丁：本文件开头那段注释已经写过"ECharts 是靠一条
 * 硬编码的标识符特例混进来的，那说明这个盲区早就存在，只是用一条补丁盖住了
 * 一个"。**盖住了一个，第三个来的时候照样漏。** 所以改成认模块——不管有人
 * 起什么名字、包不包一层 React.lazy，从 EchartsChart 来的就是图表宿主。
 */
function referencesEchartsHost(identifier) {
  const declaration = identifier.parent;
  // ① 直接 import：`import EchartsChart from "./EchartsChart"`
  const importDeclaration = importDeclarationOf(identifier);
  if (
    importDeclaration &&
    ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
    importDeclaration.moduleSpecifier.text.endsWith("EchartsChart")
  )
    return true;
  // ② React.lazy 包一层：`const LazyEchartsChart = React.lazy(() => import("./EchartsChart"))`
  let current = declaration;
  while (current && !ts.isVariableDeclaration(current)) current = current.parent;
  if (current?.initializer) {
    let dynamic;
    const scan = node => {
      if (dynamic || !node) return;
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text.endsWith("EchartsChart")
      ) {
        dynamic = true;
        return;
      }
      ts.forEachChild(node, scan);
    };
    scan(current.initializer);
    if (dynamic) return true;
  }
  return false;
}

function isRuntimeDeclaration(declaration) {
  const file = path.resolve(declaration.getSourceFile().fileName);
  return file === RUNTIME_DIR || file.startsWith(`${RUNTIME_DIR}${path.sep}`);
}

function dependencyReader(program, device, knownNames) {
  const checker = program.getTypeChecker();

  return (root, skip) => {
    const found = new Set();
    const visitedNodes = new Set();
    const visitedSymbols = new Set();

    const visitSymbol = symbol => {
      if (!symbol || visitedSymbols.has(symbol)) return;
      visitedSymbols.add(symbol);

      for (const declaration of symbol.declarations ?? []) {
        if (isRuntimeDeclaration(declaration)) visit(declaration);
        /**
         * **简写属性**要再问一次值符号（2026-08-10）。
         *
         *     export const ANALYSIS_DEPENDENCY_RENDERERS = {
         *       FunnelConversionChart, HistogramDistributionChart, …
         *     };
         *
         * `getSymbolAtLocation` 落在简写名字上给的是**属性符号**，它的声明就是
         * 这条简写本身——顺着它走一圈又回到同一个标识符，到此为止，那个
         * `const FunnelConversionChart = props => …` 永远走不到。
         * TS 为这件事专门开了 `getShorthandAssignmentValueSymbol`。
         *
         * 后果是这 13 个分析图区块的依赖**全是空的**：它们声明了
         * `uses: ["ECharts", "Card", "Empty"]`，图里一个都没有。ECharts 在
         * 统计里显示"被用到"，靠的是别处那条 LazyEchartsChart 标识符特例——
         * 又一次"补丁盖住了一个，盲区还在"。
         */
        if (ts.isShorthandPropertyAssignment(declaration)) {
          visitSymbol(checker.getShorthandAssignmentValueSymbol(declaration));
        }
      }

      if (symbol.flags & ts.SymbolFlags.Alias) {
        const target = checker.getAliasedSymbol(symbol);
        if (target !== symbol) visitSymbol(target);
      }
    };

    const visit = node => {
      if (!node || visitedNodes.has(node) || skip?.has(node)) return;
      visitedNodes.add(node);

      if (ts.isIdentifier(node)) {
        if (referencesEchartsHost(node)) found.add("ECharts");

        const symbol = checker.getSymbolAtLocation(node);
        const component = componentIdFromImport(node, symbol, device, knownNames);
        if (component) {
          found.add(component);
          return;
        }
        visitSymbol(symbol);
      }

      ts.forEachChild(node, visit);
    };

    visit(root);
    return [...found].sort((a, b) => a.localeCompare(b));
  };
}

function unwrapObject(expression) {
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (ts.isCallExpression(expression)) {
    for (const argument of expression.arguments) {
      const object = unwrapObject(argument);
      if (object) return object;
    }
  }
  return undefined;
}

/**
 * 展开 `BLOCK_DEFINITIONS` 里的批量登记（2026-08-10）。
 *
 * 359 个区块里有 43 个不是逐条写在定义表里的，而是四条 spread 批量塞进去的：
 *
 *     ...Object.fromEntries(Object.entries(DATA_GOVERNANCE_RENDERERS).map(
 *       ([type, render]) => [type, { render, uses: [...], phone: true }]))
 *
 * 此前这份统计只认 `ts.isPropertyAssignment`，这 43 个**整体不在图里**——
 * 包括上一个提交专门为了消化 Cascader / TreeSelect / Transfer 而加的三个区块。
 * 于是那三个组件仍然显示成"零引用"，而"基础组件利用率"这个数字本身是低估的。
 * 用一个漏掉 12% 区块的图去论证"哪些组件没人用"，结论不成立。
 *
 * 展开靠的是这四个模块共有的形状：一张 `configs` 字面量（键=区块类型），
 * 一个工厂函数 `createXxxBlock(config)`，工厂体内 `switch (config.variant)`。
 * 所以逐块依赖是**能分得开**的，不必给一组区块记同一坨组件：
 *
 *   某块的依赖 = 工厂里 switch 之外的公共部分（Card/Empty 这类外壳）
 *              ∪ 它那个 variant 的 case 分支
 *
 * 配置向导那一组没有 variant——一个 policy 驱动的工厂，十几个区块画的确实是
 * 同一棵树。那种情况退回整份工厂体，因为那就是事实。
 */
function objectEntriesArgument(node) {
  let found;
  const visit = current => {
    if (found || !current) return;
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === "Object" &&
      current.expression.name.text === "entries" &&
      current.arguments.length > 0
    ) {
      found = current.arguments[0];
      return;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function declaredValue(checker, expression) {
  if (!expression || !ts.isIdentifier(expression)) return expression;
  let symbol = checker.getSymbolAtLocation(expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(symbol);
    if (target !== symbol) symbol = target;
  }
  for (const declaration of symbol?.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer)
      return declaration.initializer;
    if (ts.isFunctionDeclaration(declaration)) return declaration;
  }
  return expression;
}

/** 跟着 `Object.fromEntries(Object.entries(X).map(…))` 一路回溯到源头的对象字面量。 */
function resolveKeyMap(checker, expression, depth = 0) {
  if (!expression || depth > 6) return undefined;
  const value = declaredValue(checker, expression);
  if (ts.isObjectLiteralExpression(value)) return value;
  const entries = objectEntriesArgument(value);
  if (!entries || entries === expression) return undefined;
  return resolveKeyMap(checker, entries, depth + 1);
}

/** 在渲染器映射的初始化式里找那个 `createXxx(config)` 工厂调用。 */
function resolveFactory(checker, expression) {
  const value = declaredValue(checker, expression);
  let factory;
  const visit = node => {
    if (factory || !node) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const declaration = declaredValue(checker, node.expression);
      if (
        declaration &&
        declaration !== node.expression &&
        (ts.isFunctionDeclaration(declaration) ||
          ts.isArrowFunction(declaration) ||
          ts.isFunctionExpression(declaration))
      ) {
        factory = declaration;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(value);
  return factory;
}

/**
 * 把工厂体拆成「公共外壳」+「每个 variant 的分支」。
 *
 * 空 case 体沿用手机侧那条穿透规则：`case "a": case "b": …` 里 a 借 b 的依赖。
 */
function factoryDependencies(factory, readDependencies) {
  const caseBlocks = [];
  const collect = node => {
    if (ts.isCaseBlock(node)) caseBlocks.push(node);
    ts.forEachChild(node, collect);
  };
  collect(factory);

  const shell = readDependencies(factory, new Set(caseBlocks));
  const byVariant = new Map();
  for (const caseBlock of caseBlocks) {
    const clauses = caseBlock.clauses;
    for (let index = 0; index < clauses.length; index += 1) {
      const clause = clauses[index];
      if (!ts.isCaseClause(clause) || !ts.isStringLiteral(clause.expression))
        continue;
      const group = [clause];
      let cursor = index;
      while (group.at(-1)?.statements.length === 0 && cursor + 1 < clauses.length) {
        cursor += 1;
        group.push(clauses[cursor]);
      }
      const existing = byVariant.get(clause.expression.text) ?? [];
      byVariant.set(clause.expression.text, [
        ...new Set([...existing, ...group.flatMap(node => readDependencies(node))]),
      ]);
    }
  }
  return { shell, byVariant, whole: readDependencies(factory) };
}

/** 配置条目上的 `variant: "schema"`，工厂靠它分支。没有就是整份工厂一个样。 */
function variantOf(property) {
  if (!ts.isObjectLiteralExpression(property.initializer)) return undefined;
  const variant = property.initializer.properties.find(
    item => ts.isPropertyAssignment(item) && propertyName(item.name) === "variant"
  );
  return variant &&
    ts.isPropertyAssignment(variant) &&
    ts.isStringLiteral(variant.initializer)
    ? variant.initializer.text
    : undefined;
}

function spreadBlocks(checker, spread, readDependencies) {
  const keyMap = resolveKeyMap(checker, objectEntriesArgument(spread.expression));
  if (!keyMap) return undefined;

  const produced = spread.expression;
  let renderExpression;
  const findRender = node => {
    if (renderExpression || !node) return;
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "render")
      renderExpression = node.initializer;
    else if (
      ts.isShorthandPropertyAssignment(node) &&
      propertyName(node.name) === "render"
    )
      renderExpression = node.name;
    else ts.forEachChild(node, findRender);
  };
  findRender(produced);
  if (!renderExpression) return undefined;

  // `X_RENDERERS[type]` 取下标基；`{ render }` 这种解构则渲染器映射就是被 entries 的那张表。
  const rendererMap = ts.isElementAccessExpression(renderExpression)
    ? renderExpression.expression
    : objectEntriesArgument(produced);
  const factory = rendererMap && resolveFactory(checker, rendererMap);
  if (!factory) return undefined;

  const { shell, byVariant, whole } = factoryDependencies(factory, readDependencies);
  let phone = false;
  const findPhone = node => {
    if (phone || !node) return;
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "phone" &&
      node.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      phone = true;
      return;
    }
    ts.forEachChild(node, findPhone);
  };
  findPhone(produced);

  const blocks = new Map();
  for (const property of keyMap.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const blockType = propertyName(property.name);
    if (!blockType) continue;
    const variant = variantOf(property);
    const dependencies =
      variant && byVariant.has(variant)
        ? [...new Set([...shell, ...byVariant.get(variant)])]
        : whole;
    blocks.set(blockType, [...dependencies].sort((a, b) => a.localeCompare(b)));
  }
  return { blocks, phone };
}

function desktopBlocks(program, knownNames) {
  const source = program.getSourceFile(DESKTOP_FILE);
  if (!source) throw new Error("desktop registry source not found in program");
  const readDependencies = dependencyReader(program, "desktop", knownNames);
  const definitions = variableInitializer(source, "BLOCK_DEFINITIONS");
  const object = definitions && unwrapObject(definitions);
  if (!object) throw new Error("BLOCK_DEFINITIONS object not found");

  const checker = program.getTypeChecker();
  const blocks = new Map();
  const phoneEnabled = new Set();
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      const expanded = spreadBlocks(checker, property, readDependencies);
      if (!expanded) {
        throw new Error(
          `BLOCK_DEFINITIONS spread could not be expanded: ${property.getText().slice(0, 120)}`
        );
      }
      for (const [blockType, dependencies] of expanded.blocks) {
        blocks.set(blockType, dependencies);
        if (expanded.phone) phoneEnabled.add(blockType);
      }
      continue;
    }
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isObjectLiteralExpression(property.initializer)
    )
      continue;
    const blockType = propertyName(property.name);
    const renderProperty = property.initializer.properties.find(
      item =>
        ts.isPropertyAssignment(item) && propertyName(item.name) === "render"
    );
    if (
      !blockType ||
      !renderProperty ||
      !ts.isPropertyAssignment(renderProperty)
    )
      continue;
    blocks.set(blockType, readDependencies(renderProperty.initializer));
    const phoneProperty = property.initializer.properties.find(
      item =>
        ts.isPropertyAssignment(item) && propertyName(item.name) === "phone"
    );
    if (
      phoneProperty &&
      ts.isPropertyAssignment(phoneProperty) &&
      phoneProperty.initializer.kind === ts.SyntaxKind.TrueKeyword
    )
      phoneEnabled.add(blockType);
  }
  return { blocks, phoneEnabled };
}

function phoneBlocks(program, knownBlockTypes, knownNames) {
  const phoneDirectory = path.dirname(PHONE_FILE);
  const sources = program.getSourceFiles().filter(source => {
    const file = path.resolve(source.fileName);
    return (
      (file === phoneDirectory ||
        file.startsWith(`${phoneDirectory}${path.sep}`)) &&
      !file.includes(`${path.sep}__tests__${path.sep}`)
    );
  });
  if (sources.length === 0)
    throw new Error("phone renderer sources not found in program");
  const readDependencies = dependencyReader(program, "phone", knownNames);
  const checker = program.getTypeChecker();
  const blocks = new Map();

  const merge = (blockType, dependencies) => {
    const existing = blocks.get(blockType) ?? [];
    blocks.set(
      blockType,
      [...new Set([...existing, ...dependencies])].sort((a, b) =>
        a.localeCompare(b)
      )
    );
  };

  /**
   * 手机档不是只有一个 switch（2026-08-10）。
   *
   * `PhoneExperienceBlock` 在进 switch 之前先串了六个「查表派发」：
   *
   *     const wizard = renderConfigurationWizardPhoneBlock(props);
   *     if (wizard !== undefined) return wizard;
   *
   * 每个背后是一张 `Object.fromEntries(Object.entries(POLICIES).map(…))`。
   * 此前这里只认 `case "X":`，于是这类区块的手机依赖**一个都读不到**。
   *
   * 六组里有五组恰好在各自的手机文件里也写了 switch，被 case 那条路顺带扫到，
   * 于是盲区只在配置向导这一组露头——16 个向导查不到手机组件，被
   * "phone-enabled 却没有手机组件" 那条护栏拦下。我一度据此断定这 16 个
   * **没有手机渲染器**，还去摘了 `phone: true`。是错的：它们有
   * PHONE_CONFIGURATION_WIZARD_RENDERERS，只是这份统计看不见。
   *
   * 所以按形状认这张表，而不是靠"碰巧还写了 switch"兜底。
   */
  const mappedRenderers = source => {
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const keyMap = resolveKeyMap(
          checker,
          objectEntriesArgument(declaration.initializer)
        );
        const factory = resolveFactory(checker, declaration.initializer);
        if (!keyMap || !factory) continue;
        const { shell, byVariant, whole } = factoryDependencies(
          factory,
          readDependencies
        );
        for (const property of keyMap.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const blockType = propertyName(property.name);
          if (!blockType || !knownBlockTypes.has(blockType)) continue;
          const variant = variantOf(property);
          merge(
            blockType,
            variant && byVariant.has(variant)
              ? [...shell, ...byVariant.get(variant)]
              : whole
          );
        }
      }
    }
  };

  const visit = node => {
    if (ts.isCaseBlock(node)) {
      const clauses = node.clauses;
      for (let index = 0; index < clauses.length; index += 1) {
        const clause = clauses[index];
        if (
          !ts.isCaseClause(clause) ||
          !ts.isStringLiteral(clause.expression) ||
          !knownBlockTypes.has(clause.expression.text)
        )
          continue;

        const nodes = [clause];
        let cursor = index;
        while (
          nodes.at(-1)?.statements.length === 0 &&
          cursor + 1 < clauses.length
        ) {
          cursor += 1;
          nodes.push(clauses[cursor]);
        }
        const dependencies = new Set(
          nodes.flatMap(candidate => readDependencies(candidate))
        );
        merge(clause.expression.text, dependencies);
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const source of sources) {
    mappedRenderers(source);
    visit(source);
  }
  return blocks;
}

function buildUsage() {
  const program = createProject();
  const knownNames = catalogNames();
  const { blocks: desktop, phoneEnabled } = desktopBlocks(program, knownNames);
  const phone = phoneBlocks(program, new Set(desktop.keys()), knownNames);
  const unknown = new Set();
  for (const values of [...desktop.values(), ...phone.values()]) {
    for (const value of values) if (!knownNames.has(value)) unknown.add(value);
  }
  if (unknown.size > 0) {
    throw new Error(
      `Rendered components missing from the base catalog: ${[...unknown]
        .sort((a, b) => a.localeCompare(b))
        .join(", ")}`
    );
  }
  const actual = values => values.filter(value => knownNames.has(value));
  for (const [type, values] of desktop) desktop.set(type, actual(values));
  for (const [type, values] of phone) phone.set(type, actual(values));
  const missingPhoneDependencies = [...phoneEnabled]
    .filter(type => (phone.get(type) ?? []).length === 0)
    .sort((a, b) => a.localeCompare(b));
  if (missingPhoneDependencies.length > 0) {
    throw new Error(
      `Phone-enabled blocks without traced mobile components: ${missingPhoneDependencies.join(", ")}`
    );
  }

  const types = [...new Set([...desktop.keys(), ...phone.keys()])].sort(
    (a, b) => a.localeCompare(b)
  );
  return {
    version: 2,
    generatedFrom: [
      "live-runtime/block-registry.tsx and its local imports",
      "live-runtime/phone-mobile/PhoneExperienceBlock.tsx and its local imports",
    ],
    audit: {
      method: "typescript-symbol-graph",
      renderedButNotCataloged: [...unknown].sort((a, b) => a.localeCompare(b)),
      // 由 ssot-parity 对着运行时的 BASE_COMPONENTS 对账，见 catalogNames 的注释。
      catalogComponents: [...knownNames].sort((a, b) => a.localeCompare(b)),
      phoneEnabledBlocks: [...phoneEnabled].sort((a, b) => a.localeCompare(b)),
    },
    blocks: Object.fromEntries(
      types.map(type => [
        type,
        { desktop: desktop.get(type) ?? [], phone: phone.get(type) ?? [] },
      ])
    ),
  };
}

const serialized = `${JSON.stringify(buildUsage(), null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUTPUT_FILE)
    ? fs.readFileSync(OUTPUT_FILE, "utf8")
    : "";
  if (current.replace(/\r\n/g, "\n") !== serialized) {
    console.error(
      "Block-to-component usage is stale. Run: pnpm usage:generate"
    );
    process.exitCode = 1;
  } else {
    console.log("Block-to-component usage matches the renderer symbol graph.");
  }
} else {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, serialized);
  console.log(`Generated ${path.relative(ROOT, OUTPUT_FILE)}`);
}
