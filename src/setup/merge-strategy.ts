/**
 * Smart Merge Strategy
 *
 * Provides intelligent merging logic for configuration files:
 * - Markdown: Preserves custom sections by parsing headers
 * - YAML: Deep merges while preserving existing keys
 * - JSON: Deep merges with existing values taking priority on conflicts
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** The merged content as a string */
  content: string;
  /** List of sections/keys that were preserved from the existing content */
  preserved: string[];
  /** List of sections/keys that were added from the generated content */
  added: string[];
}

/**
 * A parsed Markdown section with its header and content
 */
interface MarkdownSection {
  /** The header text (without the # prefix) */
  header: string;
  /** The header level (1-6) */
  level: number;
  /** The raw header line including # prefix */
  rawHeader: string;
  /** The content under this header (until the next header of same or higher level) */
  content: string;
  /** The full text of this section (header + content) */
  fullText: string;
}

// ============================================================================
// Markdown Merge
// ============================================================================

/**
 * Parse Markdown content into sections based on headers
 */
function parseMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split("\n");
  const sections: MarkdownSection[] = [];
  let currentSection: MarkdownSection | null = null;
  let contentLines: string[] = [];

  // Header regex: matches lines starting with 1-6 # symbols followed by space
  const headerRegex = /^(#{1,6})\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(headerRegex);

    if (match) {
      // Save the previous section if it exists
      if (currentSection) {
        currentSection.content = contentLines.join("\n");
        currentSection.fullText =
          currentSection.rawHeader +
          (currentSection.content ? "\n" + currentSection.content : "");
        sections.push(currentSection);
      }

      // Start a new section
      const level = match[1].length;
      const header = match[2].trim();
      currentSection = {
        header,
        level,
        rawHeader: line,
        content: "",
        fullText: "",
      };
      contentLines = [];
    } else {
      contentLines.push(line);
    }
  }

  // Don't forget the last section
  if (currentSection) {
    currentSection.content = contentLines.join("\n");
    currentSection.fullText =
      currentSection.rawHeader +
      (currentSection.content ? "\n" + currentSection.content : "");
    sections.push(currentSection);
  }

  // Handle content before the first header (preamble)
  if (sections.length === 0 && contentLines.length > 0) {
    sections.push({
      header: "__preamble__",
      level: 0,
      rawHeader: "",
      content: contentLines.join("\n"),
      fullText: contentLines.join("\n"),
    });
  } else if (sections.length > 0) {
    // Check for preamble content before first header
    const firstHeaderIndex = content.indexOf(sections[0].rawHeader);
    if (firstHeaderIndex > 0) {
      const preamble = content.substring(0, firstHeaderIndex).trim();
      if (preamble) {
        sections.unshift({
          header: "__preamble__",
          level: 0,
          rawHeader: "",
          content: preamble,
          fullText: preamble,
        });
      }
    }
  }

  return sections;
}

/**
 * Normalize a header for comparison (lowercase, remove special chars)
 */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

/**
 * Check if two headers are semantically similar
 */
function headersMatch(header1: string, header2: string): boolean {
  return normalizeHeader(header1) === normalizeHeader(header2);
}

/**
 * Merge two Markdown documents, preserving custom sections from existing content
 *
 * Strategy:
 * 1. Parse both documents into sections
 * 2. For each section in generated: check if a matching section exists in existing
 * 3. If matching section exists: use existing content (preserve customizations)
 * 4. If no match: add the generated section (new content)
 * 5. Preserve any sections in existing that don't exist in generated (custom sections)
 *
 * @param existing - The existing Markdown content
 * @param generated - The newly generated Markdown content
 * @returns MergeResult with merged content and tracking arrays
 */
export function mergeMarkdown(existing: string, generated: string): MergeResult {
  const preserved: string[] = [];
  const added: string[] = [];

  // Handle edge cases
  if (!existing || existing.trim() === "") {
    const genSections = parseMarkdownSections(generated);
    for (const section of genSections) {
      if (section.header !== "__preamble__") {
        added.push(section.header);
      }
    }
    return { content: generated, preserved, added };
  }

  if (!generated || generated.trim() === "") {
    const existSections = parseMarkdownSections(existing);
    for (const section of existSections) {
      if (section.header !== "__preamble__") {
        preserved.push(section.header);
      }
    }
    return { content: existing, preserved, added };
  }

  const existingSections = parseMarkdownSections(existing);
  const generatedSections = parseMarkdownSections(generated);

  // Build a map of existing sections by normalized header
  const existingByHeader = new Map<string, MarkdownSection>();
  for (const section of existingSections) {
    existingByHeader.set(normalizeHeader(section.header), section);
  }

  // Track which existing sections we've used
  const usedExistingHeaders = new Set<string>();

  // Build the merged content
  const mergedSections: string[] = [];

  // First, process generated sections in order
  for (const genSection of generatedSections) {
    const normalizedHeader = normalizeHeader(genSection.header);
    const existingSection = existingByHeader.get(normalizedHeader);

    if (existingSection) {
      // Use existing content (preserve customizations)
      mergedSections.push(existingSection.fullText);
      if (existingSection.header !== "__preamble__") {
        preserved.push(existingSection.header);
      }
      usedExistingHeaders.add(normalizedHeader);
    } else {
      // Add new generated content
      mergedSections.push(genSection.fullText);
      if (genSection.header !== "__preamble__") {
        added.push(genSection.header);
      }
    }
  }

  // Then, append any custom sections from existing that weren't in generated
  for (const existSection of existingSections) {
    const normalizedHeader = normalizeHeader(existSection.header);
    if (
      !usedExistingHeaders.has(normalizedHeader) &&
      existSection.header !== "__preamble__"
    ) {
      mergedSections.push(existSection.fullText);
      preserved.push(existSection.header);
    }
  }

  // Join sections with double newlines for readability
  const content = mergedSections.join("\n\n").trim() + "\n";

  return { content, preserved, added };
}

// ============================================================================
// YAML Merge
// ============================================================================

/**
 * Simple YAML parser for common structures
 * Handles basic key-value pairs, nested objects, and arrays
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");
  const stack: { indent: number; obj: Record<string, unknown>; key?: string }[] = [
    { indent: -1, obj: result },
  ];

  let currentArrayKey: string | null = null;
  let currentArray: unknown[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    // Calculate indentation
    const indent = line.search(/\S/);
    const trimmedLine = line.trim();

    // Handle array items
    if (trimmedLine.startsWith("- ")) {
      const value = trimmedLine.substring(2).trim();

      // Find the parent object at the right indentation level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        // Save any pending array
        if (currentArrayKey && currentArray.length > 0) {
          const parent = stack[stack.length - 1].obj;
          parent[currentArrayKey] = currentArray;
          currentArrayKey = null;
          currentArray = [];
        }
        stack.pop();
      }

      const parent = stack[stack.length - 1];
      if (parent.key) {
        if (!Array.isArray(parent.obj[parent.key])) {
          parent.obj[parent.key] = [];
        }
        (parent.obj[parent.key] as unknown[]).push(parseYamlValue(value));
      }
      continue;
    }

    // Handle key-value pairs
    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmedLine.substring(0, colonIndex).trim();
      const valueStr = trimmedLine.substring(colonIndex + 1).trim();

      // Pop back to the right level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const parent = stack[stack.length - 1].obj;

      if (valueStr === "" || valueStr === "|" || valueStr === ">") {
        // Nested object or multiline string - create new level
        const newObj: Record<string, unknown> = {};
        parent[key] = newObj;
        stack.push({ indent, obj: newObj, key });
      } else {
        // Simple value
        parent[key] = parseYamlValue(valueStr);
      }
    }
  }

  return result;
}

/**
 * Parse a YAML value string into the appropriate type
 */
function parseYamlValue(value: string): unknown {
  // Remove quotes if present
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === "true" || value === "True" || value === "TRUE") return true;
  if (value === "false" || value === "False" || value === "FALSE") return false;

  // Null
  if (value === "null" || value === "~" || value === "") return null;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;

  // String
  return value;
}

/**
 * Stringify an object to YAML format
 */
function stringifyYaml(obj: unknown, indent: number = 0): string {
  const spaces = "  ".repeat(indent);
  const lines: string[] = [];

  if (obj === null || obj === undefined) {
    return "null";
  }

  if (typeof obj !== "object") {
    return formatYamlValue(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    for (const item of obj) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length > 0) {
          lines.push(`${spaces}- ${entries[0][0]}: ${formatYamlValue(entries[0][1])}`);
          for (let i = 1; i < entries.length; i++) {
            lines.push(`${spaces}  ${entries[i][0]}: ${formatYamlValue(entries[i][1])}`);
          }
        } else {
          lines.push(`${spaces}- {}`);
        }
      } else {
        lines.push(`${spaces}- ${formatYamlValue(item)}`);
      }
    }
    return lines.join("\n");
  }

  const record = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${spaces}${key}: []`);
        } else {
          lines.push(`${spaces}${key}:`);
          lines.push(stringifyYaml(value, indent + 1));
        }
      } else {
        const nested = stringifyYaml(value, indent + 1);
        if (nested.includes("\n") || Object.keys(value).length > 0) {
          lines.push(`${spaces}${key}:`);
          lines.push(nested);
        } else {
          lines.push(`${spaces}${key}: {}`);
        }
      }
    } else {
      lines.push(`${spaces}${key}: ${formatYamlValue(value)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a primitive value for YAML output
 */
function formatYamlValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // Check if we need to quote the string
    if (
      value.includes(":") ||
      value.includes("#") ||
      value.includes("\n") ||
      value.startsWith(" ") ||
      value.endsWith(" ") ||
      value === "" ||
      /^[{[]/.test(value)
    ) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}

/**
 * Deep merge two objects, with existing values taking priority
 */
function deepMergePreserveExisting(
  existing: Record<string, unknown>,
  generated: Record<string, unknown>,
  path: string = "",
  preserved: string[],
  added: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing };

  for (const key of Object.keys(generated)) {
    const fullPath = path ? `${path}.${key}` : key;

    if (!(key in existing)) {
      // New key from generated - add it
      result[key] = generated[key];
      added.push(fullPath);
    } else if (
      typeof existing[key] === "object" &&
      existing[key] !== null &&
      !Array.isArray(existing[key]) &&
      typeof generated[key] === "object" &&
      generated[key] !== null &&
      !Array.isArray(generated[key])
    ) {
      // Both are objects - recurse
      result[key] = deepMergePreserveExisting(
        existing[key] as Record<string, unknown>,
        generated[key] as Record<string, unknown>,
        fullPath,
        preserved,
        added
      );
    } else {
      // Existing value takes priority (preserve it)
      result[key] = existing[key];
      preserved.push(fullPath);
    }
  }

  // Mark remaining existing keys as preserved
  for (const key of Object.keys(existing)) {
    if (!(key in generated)) {
      const fullPath = path ? `${path}.${key}` : key;
      preserved.push(fullPath);
    }
  }

  return result;
}

/**
 * Merge two YAML documents, preserving existing keys and deep merging nested structures
 *
 * Strategy:
 * 1. Parse both documents into objects
 * 2. Deep merge with existing values taking priority on conflicts
 * 3. Add new keys from generated content
 * 4. Preserve all existing keys
 *
 * @param existing - The existing YAML content
 * @param generated - The newly generated YAML content
 * @returns MergeResult with merged content and tracking arrays
 */
export function mergeYaml(existing: string, generated: string): MergeResult {
  const preserved: string[] = [];
  const added: string[] = [];

  // Handle edge cases
  if (!existing || existing.trim() === "") {
    const genObj = parseSimpleYaml(generated);
    collectKeys(genObj, "", added);
    return { content: generated.trim() + "\n", preserved, added };
  }

  if (!generated || generated.trim() === "") {
    const existObj = parseSimpleYaml(existing);
    collectKeys(existObj, "", preserved);
    return { content: existing.trim() + "\n", preserved, added };
  }

  const existingObj = parseSimpleYaml(existing);
  const generatedObj = parseSimpleYaml(generated);

  const merged = deepMergePreserveExisting(
    existingObj,
    generatedObj,
    "",
    preserved,
    added
  );

  // Remove duplicates from preserved (can happen with nested structures)
  const uniquePreserved = [...new Set(preserved)];
  const uniqueAdded = [...new Set(added)];

  const content = stringifyYaml(merged) + "\n";

  return { content, preserved: uniquePreserved, added: uniqueAdded };
}

/**
 * Collect all keys from an object into an array
 */
function collectKeys(obj: unknown, path: string, keys: string[]): void {
  if (typeof obj !== "object" || obj === null) return;

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const fullPath = path ? `${path}.${key}` : key;
    keys.push(fullPath);
    if (typeof record[key] === "object" && record[key] !== null && !Array.isArray(record[key])) {
      collectKeys(record[key], fullPath, keys);
    }
  }
}

// ============================================================================
// JSON Merge
// ============================================================================

/**
 * Deep merge two objects, with existing values taking priority on conflicts
 */
function deepMergeJson(
  existing: Record<string, unknown>,
  generated: Record<string, unknown>,
  path: string,
  preserved: string[],
  added: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // First, add all existing keys
  for (const key of Object.keys(existing)) {
    const fullPath = path ? `${path}.${key}` : key;

    if (!(key in generated)) {
      // Key only in existing - preserve it
      result[key] = existing[key];
      preserved.push(fullPath);
    } else if (
      typeof existing[key] === "object" &&
      existing[key] !== null &&
      !Array.isArray(existing[key]) &&
      typeof generated[key] === "object" &&
      generated[key] !== null &&
      !Array.isArray(generated[key])
    ) {
      // Both are objects - recurse
      result[key] = deepMergeJson(
        existing[key] as Record<string, unknown>,
        generated[key] as Record<string, unknown>,
        fullPath,
        preserved,
        added
      );
    } else {
      // Both have the key - existing takes priority
      result[key] = existing[key];
      preserved.push(fullPath);
    }
  }

  // Then, add new keys from generated
  for (const key of Object.keys(generated)) {
    if (!(key in existing)) {
      const fullPath = path ? `${path}.${key}` : key;
      result[key] = generated[key];
      added.push(fullPath);
    }
  }

  return result;
}

/**
 * Merge two JSON documents, favoring existing values on conflict
 *
 * Strategy:
 * 1. Parse both documents into objects
 * 2. Deep merge with existing values taking priority on conflicts
 * 3. Add new keys from generated content
 * 4. Preserve all existing keys
 *
 * @param existing - The existing JSON content
 * @param generated - The newly generated JSON content
 * @returns MergeResult with merged content and tracking arrays
 */
export function mergeJson(existing: string, generated: string): MergeResult {
  const preserved: string[] = [];
  const added: string[] = [];

  // Handle edge cases
  if (!existing || existing.trim() === "") {
    try {
      const genObj = JSON.parse(generated);
      collectKeys(genObj, "", added);
      return { content: JSON.stringify(genObj, null, 2) + "\n", preserved, added };
    } catch {
      return { content: generated, preserved, added };
    }
  }

  if (!generated || generated.trim() === "") {
    try {
      const existObj = JSON.parse(existing);
      collectKeys(existObj, "", preserved);
      return { content: JSON.stringify(existObj, null, 2) + "\n", preserved, added };
    } catch {
      return { content: existing, preserved, added };
    }
  }

  try {
    const existingObj = JSON.parse(existing);
    const generatedObj = JSON.parse(generated);

    // Handle non-object JSON (arrays, primitives)
    if (
      typeof existingObj !== "object" ||
      existingObj === null ||
      Array.isArray(existingObj)
    ) {
      // For non-objects, existing takes full priority
      preserved.push("(root)");
      return { content: JSON.stringify(existingObj, null, 2) + "\n", preserved, added };
    }

    if (
      typeof generatedObj !== "object" ||
      generatedObj === null ||
      Array.isArray(generatedObj)
    ) {
      // Generated is non-object but existing is object - keep existing
      collectKeys(existingObj, "", preserved);
      return { content: JSON.stringify(existingObj, null, 2) + "\n", preserved, added };
    }

    const merged = deepMergeJson(
      existingObj as Record<string, unknown>,
      generatedObj as Record<string, unknown>,
      "",
      preserved,
      added
    );

    const content = JSON.stringify(merged, null, 2) + "\n";

    return { content, preserved, added };
  } catch {
    // If parsing fails, return existing content
    return { content: existing, preserved: ["(parse error - kept existing)"], added };
  }
}
