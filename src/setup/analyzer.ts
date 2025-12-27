/**
 * Setup Analyzer - Project analysis for repository setup needs
 *
 * This module extends the ProjectInfo from context/enricher.ts with setup-specific
 * analysis, detecting CI needs, linters, formatters, type checkers, and project structure.
 *
 * Key capabilities:
 * - Detects CI pipeline needs (build, test, lint, typecheck, security, coverage)
 * - Identifies installed linters, formatters, and type checkers
 * - Finds entry points and source structure
 * - Provides smart defaults based on project type
 */

import * as fs from "fs";
import * as path from "path";
import { ProjectInfo, ContextEnricher } from "../context/enricher.js";
import { validateProjectDir } from "../utils/security.js";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * CI pipeline needs detection
 */
export interface CINeeds {
  /** Whether the project needs a build step */
  build: boolean;
  /** Whether the project has tests to run */
  test: boolean;
  /** Whether the project has linting configured */
  lint: boolean;
  /** Whether the project has type checking configured */
  typecheck: boolean;
  /** Whether security scanning is recommended */
  security: boolean;
  /** Whether code coverage is configured */
  coverage: boolean;
}

/**
 * Detected development tools
 */
export interface DetectedTools {
  /** Detected linters (eslint, ruff, clippy, etc.) */
  linters: string[];
  /** Detected formatters (prettier, black, rustfmt, etc.) */
  formatters: string[];
  /** Detected type checkers (tsc, mypy, etc.) */
  typeCheckers: string[];
}

/**
 * Entry point information
 */
export interface EntryPoint {
  /** Path to the entry point file */
  path: string;
  /** Type of entry point */
  type: "main" | "binary" | "library" | "module" | "script" | "test";
  /** Optional name (e.g., binary name) */
  name?: string;
}

/**
 * Source structure analysis
 */
export interface SourceStructure {
  /** Primary source directories */
  srcDirs: string[];
  /** Test directories */
  testDirs: string[];
  /** Documentation directories */
  docDirs: string[];
  /** Configuration files found */
  configFiles: string[];
  /** Whether this appears to be a monorepo */
  isMonorepo: boolean;
  /** Workspace package paths (if monorepo) */
  workspacePackages: string[];
}

/**
 * Complete setup analysis result
 */
export interface SetupAnalysis {
  /** Base project information from enricher */
  projectInfo: ProjectInfo;
  /** CI pipeline needs */
  ciNeeds: CINeeds;
  /** Detected development tools */
  detectedTools: DetectedTools;
  /** Project entry points */
  entryPoints: EntryPoint[];
  /** Source structure analysis */
  sourceStructure: SourceStructure;
  /** Timestamp of analysis */
  analyzedAt: string;
}

// ============================================================================
// Detection Constants
// ============================================================================

/**
 * Linter detection patterns
 */
const LINTER_INDICATORS: Record<string, { files: string[]; deps: string[] }> = {
  eslint: {
    files: [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs", ".eslintrc.mjs", "eslint.config.js", "eslint.config.mjs"],
    deps: ["eslint"],
  },
  biome: {
    files: ["biome.json", "biome.jsonc"],
    deps: ["@biomejs/biome"],
  },
  oxlint: {
    files: [".oxlintrc.json"],
    deps: ["oxlint"],
  },
  ruff: {
    files: ["ruff.toml", ".ruff.toml"],
    deps: ["ruff"],
  },
  pylint: {
    files: [".pylintrc", "pylintrc"],
    deps: ["pylint"],
  },
  flake8: {
    files: [".flake8", "setup.cfg"],
    deps: ["flake8"],
  },
  clippy: {
    files: [], // Clippy is detected via Cargo.toml
    deps: [],
  },
  golangci: {
    files: [".golangci.yml", ".golangci.yaml", ".golangci.toml", ".golangci.json"],
    deps: [],
  },
};

/**
 * Formatter detection patterns
 */
const FORMATTER_INDICATORS: Record<string, { files: string[]; deps: string[] }> = {
  prettier: {
    files: [".prettierrc", ".prettierrc.js", ".prettierrc.json", ".prettierrc.yaml", ".prettierrc.yml", "prettier.config.js", "prettier.config.mjs"],
    deps: ["prettier"],
  },
  biome: {
    files: ["biome.json", "biome.jsonc"],
    deps: ["@biomejs/biome"],
  },
  black: {
    files: ["pyproject.toml"], // Check for [tool.black] section
    deps: ["black"],
  },
  isort: {
    files: [".isort.cfg", "pyproject.toml"],
    deps: ["isort"],
  },
  rustfmt: {
    files: ["rustfmt.toml", ".rustfmt.toml"],
    deps: [],
  },
  gofmt: {
    files: [], // Built into Go
    deps: [],
  },
};

/**
 * Type checker detection patterns
 */
const TYPECHECKER_INDICATORS: Record<string, { files: string[]; deps: string[] }> = {
  typescript: {
    files: ["tsconfig.json", "tsconfig.*.json"],
    deps: ["typescript"],
  },
  mypy: {
    files: ["mypy.ini", ".mypy.ini", "pyproject.toml"],
    deps: ["mypy"],
  },
  pyright: {
    files: ["pyrightconfig.json"],
    deps: ["pyright"],
  },
  pytype: {
    files: [],
    deps: ["pytype"],
  },
};

/**
 * Coverage tool detection patterns
 */
const COVERAGE_INDICATORS: Record<string, { files: string[]; deps: string[] }> = {
  c8: {
    files: [],
    deps: ["c8"],
  },
  nyc: {
    files: [".nycrc", ".nycrc.json"],
    deps: ["nyc"],
  },
  istanbul: {
    files: [],
    deps: ["istanbul"],
  },
  "coverage.py": {
    files: [".coveragerc", "pyproject.toml"],
    deps: ["coverage"],
  },
  tarpaulin: {
    files: [],
    deps: [],
  },
};

/**
 * Common documentation directories
 */
const DOC_DIRECTORIES = ["docs", "doc", "documentation", "wiki"];

/**
 * Common config file patterns
 */
const CONFIG_FILE_PATTERNS = [
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  ".eslintrc*",
  ".prettierrc*",
  "vite.config.*",
  "webpack.config.*",
  "rollup.config.*",
  "jest.config.*",
  "vitest.config.*",
  ".github/workflows/*",
];

// ============================================================================
// SetupAnalyzer Class
// ============================================================================

/**
 * SetupAnalyzer - Analyzes projects for setup and configuration needs
 *
 * Usage:
 * ```typescript
 * const analysis = await analyzeProjectForSetup("/path/to/project");
 * console.log(analysis.ciNeeds);
 * console.log(analysis.detectedTools);
 * ```
 */
export class SetupAnalyzer {
  private readonly projectDir: string;
  private readonly enricher: ContextEnricher;
  private packageJson: Record<string, unknown> | null = null;
  private pyprojectToml: string | null = null;
  private cargoToml: string | null = null;

  constructor(projectDir: string) {
    this.projectDir = validateProjectDir(projectDir);
    this.enricher = new ContextEnricher(projectDir);
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Perform complete setup analysis for the project
   */
  async analyze(): Promise<SetupAnalysis> {
    // Load common config files for analysis
    await this.loadConfigFiles();

    // Get base project info from enricher
    const projectInfo = this.enricher.detectProjectInfo();

    // Perform setup-specific analysis
    const detectedTools = this.detectTools(projectInfo);
    const ciNeeds = this.detectCINeeds(projectInfo, detectedTools);
    const entryPoints = this.findEntryPoints(projectInfo);
    const sourceStructure = this.analyzeSourceStructure(projectInfo);

    return {
      projectInfo,
      ciNeeds,
      detectedTools,
      entryPoints,
      sourceStructure,
      analyzedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // Config File Loading
  // ==========================================================================

  /**
   * Load common configuration files for analysis
   */
  private async loadConfigFiles(): Promise<void> {
    // Load package.json
    const packageJsonPath = path.join(this.projectDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        this.packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      } catch {
        // Ignore parse errors
      }
    }

    // Load pyproject.toml
    const pyprojectPath = path.join(this.projectDir, "pyproject.toml");
    if (fs.existsSync(pyprojectPath)) {
      try {
        this.pyprojectToml = fs.readFileSync(pyprojectPath, "utf-8");
      } catch {
        // Ignore read errors
      }
    }

    // Load Cargo.toml
    const cargoPath = path.join(this.projectDir, "Cargo.toml");
    if (fs.existsSync(cargoPath)) {
      try {
        this.cargoToml = fs.readFileSync(cargoPath, "utf-8");
      } catch {
        // Ignore read errors
      }
    }
  }

  // ==========================================================================
  // Tool Detection
  // ==========================================================================

  /**
   * Detect linters, formatters, and type checkers
   */
  detectTools(projectInfo: ProjectInfo): DetectedTools {
    const linters = this.detectLinters(projectInfo);
    const formatters = this.detectFormatters(projectInfo);
    const typeCheckers = this.detectTypeCheckers(projectInfo);

    return {
      linters,
      formatters,
      typeCheckers,
    };
  }

  /**
   * Detect installed linters
   */
  private detectLinters(projectInfo: ProjectInfo): string[] {
    const detected: string[] = [];

    for (const [linter, indicators] of Object.entries(LINTER_INDICATORS)) {
      // Check for config files
      for (const file of indicators.files) {
        if (this.fileExists(file)) {
          detected.push(linter);
          break;
        }
      }

      // Check for dependencies (Node.js)
      if (projectInfo.type === "nodejs" && this.packageJson) {
        if (this.hasDependency(indicators.deps)) {
          if (!detected.includes(linter)) {
            detected.push(linter);
          }
        }
      }

      // Check for Python dependencies in pyproject.toml
      if (projectInfo.type === "python" && this.pyprojectToml) {
        for (const dep of indicators.deps) {
          if (this.pyprojectToml.includes(dep)) {
            if (!detected.includes(linter)) {
              detected.push(linter);
            }
          }
        }
      }
    }

    // Rust-specific: Clippy is typically available by default
    if (projectInfo.type === "rust" && this.cargoToml) {
      detected.push("clippy");
    }

    // Go-specific: golangci detection
    if (projectInfo.type === "go") {
      for (const file of LINTER_INDICATORS.golangci.files) {
        if (this.fileExists(file)) {
          detected.push("golangci");
          break;
        }
      }
    }

    return [...new Set(detected)]; // Remove duplicates
  }

  /**
   * Detect installed formatters
   */
  private detectFormatters(projectInfo: ProjectInfo): string[] {
    const detected: string[] = [];

    for (const [formatter, indicators] of Object.entries(FORMATTER_INDICATORS)) {
      // Check for config files
      for (const file of indicators.files) {
        if (this.fileExists(file)) {
          // Special case: biome config detected for both linter and formatter
          if (formatter === "biome") {
            detected.push(formatter);
          } else if (formatter === "black" && file === "pyproject.toml") {
            // Check if [tool.black] section exists
            if (this.pyprojectToml?.includes("[tool.black]")) {
              detected.push(formatter);
            }
          } else {
            detected.push(formatter);
          }
          break;
        }
      }

      // Check for dependencies
      if (projectInfo.type === "nodejs" && this.packageJson) {
        if (this.hasDependency(indicators.deps)) {
          if (!detected.includes(formatter)) {
            detected.push(formatter);
          }
        }
      }

      // Check for Python dependencies
      if (projectInfo.type === "python" && this.pyprojectToml) {
        for (const dep of indicators.deps) {
          if (this.pyprojectToml.includes(dep)) {
            if (!detected.includes(formatter)) {
              detected.push(formatter);
            }
          }
        }
      }
    }

    // Rust-specific: rustfmt is typically available by default
    if (projectInfo.type === "rust" && this.cargoToml) {
      detected.push("rustfmt");
    }

    // Go-specific: gofmt is built-in
    if (projectInfo.type === "go") {
      detected.push("gofmt");
    }

    return [...new Set(detected)];
  }

  /**
   * Detect installed type checkers
   */
  private detectTypeCheckers(projectInfo: ProjectInfo): string[] {
    const detected: string[] = [];

    for (const [checker, indicators] of Object.entries(TYPECHECKER_INDICATORS)) {
      // Check for config files
      for (const file of indicators.files) {
        // Handle glob patterns for tsconfig (e.g., tsconfig.*.json)
        if (file.includes("*")) {
          try {
            const files = fs.readdirSync(this.projectDir);
            if (files.some(f => /^tsconfig\..*\.json$/.test(f))) {
              detected.push(checker);
              break;
            }
          } catch {
            // Skip on read error
          }
        } else if (this.fileExists(file)) {
          if (checker === "mypy" && file === "pyproject.toml") {
            // Check if [tool.mypy] section exists
            if (this.pyprojectToml?.includes("[tool.mypy]")) {
              detected.push(checker);
            }
          } else {
            detected.push(checker);
          }
          break;
        }
      }

      // Check for dependencies
      if (projectInfo.type === "nodejs" && this.packageJson) {
        if (this.hasDependency(indicators.deps)) {
          if (!detected.includes(checker)) {
            detected.push(checker);
          }
        }
      }

      // Check for Python dependencies
      if (projectInfo.type === "python" && this.pyprojectToml) {
        for (const dep of indicators.deps) {
          if (this.pyprojectToml.includes(dep)) {
            if (!detected.includes(checker)) {
              detected.push(checker);
            }
          }
        }
      }
    }

    return [...new Set(detected)];
  }

  // ==========================================================================
  // CI Needs Detection
  // ==========================================================================

  /**
   * Detect CI pipeline needs based on project type and tooling
   */
  detectCINeeds(projectInfo: ProjectInfo, tools: DetectedTools): CINeeds {
    const ciNeeds: CINeeds = {
      build: false,
      test: false,
      lint: false,
      typecheck: false,
      security: false,
      coverage: false,
    };

    // Build detection
    ciNeeds.build = this.detectBuildNeed(projectInfo);

    // Test detection
    ciNeeds.test = this.detectTestNeed(projectInfo);

    // Lint detection - based on detected linters
    ciNeeds.lint = tools.linters.length > 0;

    // Typecheck detection - based on detected type checkers
    ciNeeds.typecheck = tools.typeCheckers.length > 0;

    // Security scanning - recommend for all production projects
    ciNeeds.security = this.detectSecurityNeed(projectInfo);

    // Coverage detection
    ciNeeds.coverage = this.detectCoverageNeed(projectInfo);

    return ciNeeds;
  }

  /**
   * Detect if the project needs a build step
   */
  private detectBuildNeed(projectInfo: ProjectInfo): boolean {
    // TypeScript projects need building
    if (this.fileExists("tsconfig.json")) {
      return true;
    }

    // Check package.json for build script
    if (this.packageJson) {
      const scripts = this.packageJson.scripts as Record<string, string> | undefined;
      if (scripts?.build) {
        return true;
      }
    }

    // Rust and Go projects need building
    if (projectInfo.type === "rust" || projectInfo.type === "go") {
      return true;
    }

    // Java projects need building
    if (projectInfo.type === "java") {
      return true;
    }

    // Check for common build config files
    const buildConfigFiles = [
      "webpack.config.js",
      "vite.config.ts",
      "vite.config.js",
      "rollup.config.js",
      "rollup.config.mjs",
      "esbuild.config.js",
    ];
    for (const file of buildConfigFiles) {
      if (this.fileExists(file)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect if the project has tests
   */
  private detectTestNeed(projectInfo: ProjectInfo): boolean {
    // Check for test directories
    const testDirs = ["test", "tests", "__tests__", "spec", "specs"];
    for (const dir of testDirs) {
      if (this.directoryExists(dir)) {
        return true;
      }
    }

    // Check package.json for test script
    if (this.packageJson) {
      const scripts = this.packageJson.scripts as Record<string, string> | undefined;
      if (scripts?.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
        return true;
      }
    }

    // Check for test framework dependencies
    const testDeps = ["jest", "vitest", "mocha", "ava", "tap", "playwright", "cypress"];
    if (this.hasDependency(testDeps)) {
      return true;
    }

    // Python: check for pytest or unittest
    if (projectInfo.type === "python") {
      if (this.pyprojectToml?.includes("pytest")) {
        return true;
      }
    }

    // Rust: cargo test is always available
    if (projectInfo.type === "rust") {
      return true;
    }

    // Go: go test is always available
    if (projectInfo.type === "go") {
      // Check for _test.go files
      return this.hasFilesMatching("**/*_test.go");
    }

    return false;
  }

  /**
   * Detect if security scanning is recommended
   */
  private detectSecurityNeed(projectInfo: ProjectInfo): boolean {
    // Recommend security scanning for all projects with dependencies
    if (this.packageJson) {
      const deps = this.packageJson.dependencies as Record<string, string> | undefined;
      if (deps && Object.keys(deps).length > 0) {
        return true;
      }
    }

    // Python projects with dependencies
    if (this.pyprojectToml?.includes("[project.dependencies]")) {
      return true;
    }

    // Rust projects with dependencies
    if (this.cargoToml?.includes("[dependencies]")) {
      return true;
    }

    // Go modules
    if (projectInfo.type === "go" && this.fileExists("go.mod")) {
      return true;
    }

    return false;
  }

  /**
   * Detect if coverage is configured
   */
  private detectCoverageNeed(projectInfo: ProjectInfo): boolean {
    // Check for coverage tools
    for (const [, indicators] of Object.entries(COVERAGE_INDICATORS)) {
      for (const file of indicators.files) {
        if (this.fileExists(file)) {
          return true;
        }
      }

      if (projectInfo.type === "nodejs" && this.hasDependency(indicators.deps)) {
        return true;
      }

      if (projectInfo.type === "python" && this.pyprojectToml) {
        for (const dep of indicators.deps) {
          if (this.pyprojectToml.includes(dep)) {
            return true;
          }
        }
      }
    }

    // Check package.json scripts for coverage
    if (this.packageJson) {
      const scripts = this.packageJson.scripts as Record<string, string> | undefined;
      if (scripts) {
        for (const script of Object.values(scripts)) {
          if (script.includes("coverage") || script.includes("--coverage")) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // ==========================================================================
  // Entry Point Detection
  // ==========================================================================

  /**
   * Find project entry points
   */
  findEntryPoints(projectInfo: ProjectInfo): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    switch (projectInfo.type) {
      case "nodejs":
        entryPoints.push(...this.findNodeEntryPoints());
        break;
      case "python":
        entryPoints.push(...this.findPythonEntryPoints());
        break;
      case "rust":
        entryPoints.push(...this.findRustEntryPoints());
        break;
      case "go":
        entryPoints.push(...this.findGoEntryPoints());
        break;
      default:
        // Try generic detection
        entryPoints.push(...this.findGenericEntryPoints());
    }

    return entryPoints;
  }

  /**
   * Find Node.js entry points
   */
  private findNodeEntryPoints(): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    if (this.packageJson) {
      // Main entry point
      const main = this.packageJson.main as string | undefined;
      if (main && this.fileExists(main)) {
        entryPoints.push({ path: main, type: "main" });
      }

      // Module entry point (ESM)
      const module = this.packageJson.module as string | undefined;
      if (module && this.fileExists(module)) {
        entryPoints.push({ path: module, type: "module" });
      }

      // Exports field
      const exports = this.packageJson.exports;
      if (exports && typeof exports === "object") {
        const exp = exports as Record<string, unknown>;
        if (typeof exp["."] === "string" && this.fileExists(exp["."])) {
          entryPoints.push({ path: exp["."], type: "module" });
        }
      }

      // Binary entry points
      const bin = this.packageJson.bin;
      if (bin) {
        if (typeof bin === "string") {
          if (this.fileExists(bin)) {
            entryPoints.push({ path: bin, type: "binary" });
          }
        } else if (typeof bin === "object") {
          for (const [name, binPath] of Object.entries(bin as Record<string, string>)) {
            if (this.fileExists(binPath)) {
              entryPoints.push({ path: binPath, type: "binary", name });
            }
          }
        }
      }
    }

    // Common entry points
    const commonEntries = ["src/index.ts", "src/index.js", "index.ts", "index.js", "src/main.ts", "src/main.js"];
    for (const entry of commonEntries) {
      if (this.fileExists(entry) && !entryPoints.some(e => e.path === entry)) {
        entryPoints.push({ path: entry, type: "main" });
      }
    }

    return entryPoints;
  }

  /**
   * Find Python entry points
   */
  private findPythonEntryPoints(): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    // Check pyproject.toml for scripts
    if (this.pyprojectToml) {
      if (this.pyprojectToml.includes("[project.scripts]")) {
        // Parse script entries (simplified)
        const scriptMatch = this.pyprojectToml.match(/\[project\.scripts\]\s*([\s\S]*?)(?=\[|$)/);
        if (scriptMatch) {
          const lines = scriptMatch[1].split("\n");
          for (const line of lines) {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*["']([^"']+)["']/);
            if (match) {
              entryPoints.push({ path: match[2], type: "binary", name: match[1] });
            }
          }
        }
      }
    }

    // Common Python entry points
    const commonEntries = ["main.py", "app.py", "run.py", "__main__.py", "src/__main__.py"];
    for (const entry of commonEntries) {
      if (this.fileExists(entry)) {
        entryPoints.push({ path: entry, type: "main" });
      }
    }

    // Check for src package with __init__.py (library)
    if (this.fileExists("src/__init__.py")) {
      entryPoints.push({ path: "src/__init__.py", type: "library" });
    }

    return entryPoints;
  }

  /**
   * Find Rust entry points
   */
  private findRustEntryPoints(): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    // Main binary
    if (this.fileExists("src/main.rs")) {
      entryPoints.push({ path: "src/main.rs", type: "binary" });
    }

    // Library
    if (this.fileExists("src/lib.rs")) {
      entryPoints.push({ path: "src/lib.rs", type: "library" });
    }

    // Check for bin directory
    if (this.directoryExists("src/bin")) {
      try {
        const bins = fs.readdirSync(path.join(this.projectDir, "src/bin"));
        for (const bin of bins) {
          if (bin.endsWith(".rs")) {
            entryPoints.push({
              path: `src/bin/${bin}`,
              type: "binary",
              name: bin.replace(".rs", ""),
            });
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return entryPoints;
  }

  /**
   * Find Go entry points
   */
  private findGoEntryPoints(): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    // Main package
    if (this.fileExists("main.go")) {
      entryPoints.push({ path: "main.go", type: "binary" });
    }

    // cmd directory (common Go pattern)
    if (this.directoryExists("cmd")) {
      try {
        const cmds = fs.readdirSync(path.join(this.projectDir, "cmd"));
        for (const cmd of cmds) {
          const cmdPath = path.join(this.projectDir, "cmd", cmd);
          if (fs.statSync(cmdPath).isDirectory()) {
            if (fs.existsSync(path.join(cmdPath, "main.go"))) {
              entryPoints.push({
                path: `cmd/${cmd}/main.go`,
                type: "binary",
                name: cmd,
              });
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return entryPoints;
  }

  /**
   * Find generic entry points
   */
  private findGenericEntryPoints(): EntryPoint[] {
    const entryPoints: EntryPoint[] = [];

    // Common entry point names across languages
    const commonNames = ["main", "index", "app", "run", "start"];
    const extensions = [".ts", ".js", ".py", ".go", ".rs", ".java"];

    for (const name of commonNames) {
      for (const ext of extensions) {
        const file = name + ext;
        if (this.fileExists(file)) {
          entryPoints.push({ path: file, type: "main" });
        }
        const srcFile = `src/${file}`;
        if (this.fileExists(srcFile)) {
          entryPoints.push({ path: srcFile, type: "main" });
        }
      }
    }

    return entryPoints;
  }

  // ==========================================================================
  // Source Structure Analysis
  // ==========================================================================

  /**
   * Analyze source structure
   */
  analyzeSourceStructure(projectInfo: ProjectInfo): SourceStructure {
    const srcDirs = this.findSourceDirs(projectInfo);
    const testDirs = this.findTestDirs();
    const docDirs = this.findDocDirs();
    const configFiles = this.findConfigFiles();
    const { isMonorepo, workspacePackages } = this.detectMonorepo();

    return {
      srcDirs,
      testDirs,
      docDirs,
      configFiles,
      isMonorepo,
      workspacePackages,
    };
  }

  /**
   * Find source directories
   */
  private findSourceDirs(projectInfo: ProjectInfo): string[] {
    // Start with dirs from projectInfo
    const srcDirs = [...projectInfo.srcDirs];

    // Add common source directories if they exist
    const commonSrcDirs = ["src", "lib", "app", "packages", "modules"];
    for (const dir of commonSrcDirs) {
      if (this.directoryExists(dir) && !srcDirs.includes(dir)) {
        srcDirs.push(dir);
      }
    }

    return srcDirs;
  }

  /**
   * Find test directories
   */
  private findTestDirs(): string[] {
    const testDirs: string[] = [];
    const candidates = ["test", "tests", "__tests__", "spec", "specs", "e2e", "integration"];

    for (const dir of candidates) {
      if (this.directoryExists(dir)) {
        testDirs.push(dir);
      }
    }

    return testDirs;
  }

  /**
   * Find documentation directories
   */
  private findDocDirs(): string[] {
    const docDirs: string[] = [];

    for (const dir of DOC_DIRECTORIES) {
      if (this.directoryExists(dir)) {
        docDirs.push(dir);
      }
    }

    return docDirs;
  }

  /**
   * Find configuration files
   */
  private findConfigFiles(): string[] {
    const configFiles: string[] = [];

    // Check for common config files
    const patterns = [
      "package.json",
      "tsconfig.json",
      "pyproject.toml",
      "Cargo.toml",
      "go.mod",
      ".eslintrc.js",
      ".eslintrc.json",
      ".eslintrc.cjs",
      "eslint.config.js",
      "eslint.config.mjs",
      ".prettierrc",
      ".prettierrc.js",
      ".prettierrc.json",
      "prettier.config.js",
      "biome.json",
      "vite.config.ts",
      "vite.config.js",
      "webpack.config.js",
      "jest.config.js",
      "jest.config.ts",
      "vitest.config.ts",
      ".gitignore",
      ".dockerignore",
      "Dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      "Makefile",
    ];

    for (const pattern of patterns) {
      if (this.fileExists(pattern)) {
        configFiles.push(pattern);
      }
    }

    // Check for GitHub workflows
    if (this.directoryExists(".github/workflows")) {
      try {
        const workflows = fs.readdirSync(path.join(this.projectDir, ".github/workflows"));
        for (const wf of workflows) {
          if (wf.endsWith(".yml") || wf.endsWith(".yaml")) {
            configFiles.push(`.github/workflows/${wf}`);
          }
        }
      } catch {
        // Ignore errors
      }
    }

    return configFiles;
  }

  /**
   * Detect if project is a monorepo
   */
  private detectMonorepo(): { isMonorepo: boolean; workspacePackages: string[] } {
    const workspacePackages: string[] = [];

    // Check package.json workspaces
    if (this.packageJson?.workspaces) {
      const workspaces = this.packageJson.workspaces;
      if (Array.isArray(workspaces)) {
        workspacePackages.push(...workspaces);
      } else if (typeof workspaces === "object" && Array.isArray((workspaces as Record<string, unknown>).packages)) {
        workspacePackages.push(...(workspaces as { packages: string[] }).packages);
      }
    }

    // Check for pnpm-workspace.yaml
    if (this.fileExists("pnpm-workspace.yaml")) {
      try {
        const content = fs.readFileSync(path.join(this.projectDir, "pnpm-workspace.yaml"), "utf-8");
        const matches = content.match(/packages:\s*([\s\S]*?)(?=\n\S|$)/);
        if (matches) {
          const packages = matches[1].match(/-\s*['"]?([^'"]+)['"]?/g);
          if (packages) {
            workspacePackages.push(...packages.map(p => p.replace(/^-\s*['"]?/, "").replace(/['"]?$/, "")));
          }
        }
      } catch {
        // Ignore errors
      }
    }

    // Check for Cargo workspace
    if (this.cargoToml?.includes("[workspace]")) {
      const membersMatch = this.cargoToml.match(/members\s*=\s*\[([\s\S]*?)\]/);
      if (membersMatch) {
        const members = membersMatch[1].match(/"([^"]+)"/g);
        if (members) {
          workspacePackages.push(...members.map(m => m.replace(/"/g, "")));
        }
      }
    }

    // Check for lerna.json
    if (this.fileExists("lerna.json")) {
      try {
        const lerna = JSON.parse(fs.readFileSync(path.join(this.projectDir, "lerna.json"), "utf-8"));
        if (lerna.packages) {
          workspacePackages.push(...lerna.packages);
        }
      } catch {
        // Ignore errors
      }
    }

    const isMonorepo = workspacePackages.length > 0 ||
      this.directoryExists("packages") ||
      this.directoryExists("apps");

    return { isMonorepo, workspacePackages };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Check if a file exists in the project
   */
  private fileExists(relativePath: string): boolean {
    try {
      const fullPath = path.join(this.projectDir, relativePath);
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory exists in the project
   */
  private directoryExists(relativePath: string): boolean {
    try {
      const fullPath = path.join(this.projectDir, relativePath);
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Check if package.json has any of the specified dependencies
   */
  private hasDependency(deps: string[]): boolean {
    if (!this.packageJson) return false;

    const allDeps = {
      ...(this.packageJson.dependencies as Record<string, string> || {}),
      ...(this.packageJson.devDependencies as Record<string, string> || {}),
    };

    return deps.some(dep => dep in allDeps);
  }

  /**
   * Check if any files match a glob pattern (simplified)
   */
  private hasFilesMatching(pattern: string): boolean {
    // Simplified check for common patterns
    if (pattern.includes("**/*_test.go")) {
      // Check for Go test files
      return this.hasTestFilesInDir(".", "_test.go");
    }
    return false;
  }

  /**
   * Check for test files with a specific suffix in a directory tree
   */
  private hasTestFilesInDir(dir: string, suffix: string): boolean {
    const fullPath = path.join(this.projectDir, dir);
    if (!fs.existsSync(fullPath)) return false;

    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(suffix)) {
          return true;
        }
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          if (this.hasTestFilesInDir(path.join(dir, entry.name), suffix)) {
            return true;
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return false;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Analyze a project for setup needs
 *
 * This is the main entry point for setup analysis.
 *
 * @param projectDir - Path to the project directory
 * @returns SetupAnalysis with CI needs, detected tools, entry points, and source structure
 *
 * @example
 * ```typescript
 * const analysis = await analyzeProjectForSetup("/path/to/my-project");
 *
 * if (analysis.ciNeeds.build) {
 *   console.log("Project needs a build step");
 * }
 *
 * if (analysis.detectedTools.linters.includes("eslint")) {
 *   console.log("ESLint is configured");
 * }
 * ```
 */
export async function analyzeProjectForSetup(projectDir: string): Promise<SetupAnalysis> {
  const analyzer = new SetupAnalyzer(projectDir);
  return analyzer.analyze();
}

/**
 * Quick check if a project needs CI setup
 */
export async function projectNeedsCI(projectDir: string): Promise<boolean> {
  const analysis = await analyzeProjectForSetup(projectDir);
  const { ciNeeds } = analysis;

  // If any CI need is true, the project would benefit from CI
  return ciNeeds.build || ciNeeds.test || ciNeeds.lint || ciNeeds.typecheck;
}

/**
 * Get a summary of detected tools
 */
export function summarizeTools(tools: DetectedTools): string {
  const parts: string[] = [];

  if (tools.linters.length > 0) {
    parts.push(`Linters: ${tools.linters.join(", ")}`);
  }
  if (tools.formatters.length > 0) {
    parts.push(`Formatters: ${tools.formatters.join(", ")}`);
  }
  if (tools.typeCheckers.length > 0) {
    parts.push(`Type Checkers: ${tools.typeCheckers.join(", ")}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "No tools detected";
}
